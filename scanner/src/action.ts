#!/usr/bin/env node
import * as core from '@actions/core';
import * as github from '@actions/github';
import { parsePatch, buildSnippet, buildNumberedSnippet, ParsedFile } from './diff';
import { scanLineContent } from './rules';
import { buildChunks, reviewChunk } from './review';
import { calculateScores, makeDecision } from './scorer';
import {
  PRFile,
  fetchPRFiles,
  fetchPushFiles,
  findMergedPullRequest,
  postReview,
  postCommitComment,
  buildRiskPanel,
  buildInlineComment,
  buildFindingsTable,
  ReviewStats,
} from './github';
import { makeIgnoreMatcher } from './ignore';
import { buildReport, sendToDashboard } from './report';
import { DecisionType, Finding, PrivGuardReport, Scores, Severity } from './types';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

interface Settings {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  strictMode: boolean;
  minSeverity: Severity;
  maxChunkChars: number;
  dashboardUrl: string;
  dashboardToken: string;
  isIgnored: (path: string) => boolean;
}

interface ReviewResult {
  parsedFiles: ParsedFile[];
  scoredFindings: Finding[];
  visibleFindings: Finding[]; // at or above min-severity, comment order (rules first, then AI)
  scores: Scores;
  decision: DecisionType;
  stats: ReviewStats;
  aiUsed: boolean;
}

function readSettings(): Settings {
  const minSeverityInput = (core.getInput('min-severity') || 'LOW').toUpperCase();
  return {
    llmApiUrl: core.getInput('llm-api-url'),
    llmApiKey: core.getInput('llm-api-key'),
    llmModel: core.getInput('llm-model') || 'llama3:8b',
    strictMode: core.getInput('strict-mode') === 'true',
    minSeverity: (minSeverityInput in SEVERITY_ORDER ? minSeverityInput : 'LOW') as Severity,
    maxChunkChars: Math.max(2000, parseInt(core.getInput('max-chunk-chars') || '12000', 10) || 12000),
    dashboardUrl: core.getInput('dashboard-url'),
    dashboardToken: core.getInput('dashboard-token'),
    isIgnored: makeIgnoreMatcher(core.getInput('ignore-paths')),
  };
}

/** The shared pipeline: rule engine → AI review pass → scoring. Used for PRs and pushes. */
async function reviewFiles(files: PRFile[], s: Settings): Promise<ReviewResult> {
  // ── Stage 2: rule-based scan over added lines ──────────────────────────
  const allFindings: Finding[] = [];
  const parsedFiles: ParsedFile[] = [];
  let skipped = 0;

  for (const file of files) {
    if (file.status === 'removed' || !file.patch) continue;
    if (s.isIgnored(file.filename)) {
      skipped++;
      continue;
    }

    const parsed = parsePatch(file.filename, file.patch);
    const addedLines = parsed.hunkLines.filter(l => l.type === 'add');
    if (addedLines.length === 0) continue;
    parsedFiles.push(parsed);

    core.info(`  Scanning: ${file.filename} (${addedLines.length} added line(s))`);
    for (const line of addedLines) {
      const snippet = buildSnippet(parsed.hunkLines, line.newLineNo);
      const lineFindings = scanLineContent(file.filename, line.newLineNo, line.content, snippet);
      if (lineFindings.length > 0) core.info(`    [!] ${lineFindings.length} finding(s) at line ${line.newLineNo}`);
      allFindings.push(...lineFindings);
    }
  }
  if (skipped) core.info(`  Skipped ${skipped} generated/ignored file(s)`);
  core.info(`  Rule scan complete: ${allFindings.length} finding(s)`);

  // ── Stage 3: AI review pass (one LLM call per diff chunk) ─────────────
  // Gives a verdict on each rule flag AND reports issues the rules missed.
  // If the LLM is down or out of quota, that chunk keeps its rule results.
  const ruleCount = allFindings.length;
  let llmDismissed = 0;
  let chunksReviewed = 0;
  let chunksFailed = 0;
  const aiFindings: Finding[] = [];

  if (s.llmApiUrl) {
    const cfg = { model: s.llmModel, url: s.llmApiUrl, key: s.llmApiKey };
    const chunks = parsedFiles.flatMap(p => buildChunks(p, s.maxChunkChars));
    core.info(`  AI review (model: ${s.llmModel}): ${chunks.length} chunk(s) of up to ${s.maxChunkChars} chars`);

    for (const chunk of chunks) {
      const flags = allFindings.filter(f => f.file === chunk.file && chunk.addedLines.has(f.line));
      const result = await reviewChunk(chunk, flags, cfg);
      if ('error' in result) {
        chunksFailed++;
        core.warning(
          `AI review unavailable for ${chunk.file}:${chunk.firstLine}-${chunk.lastLine}; using rule results only. Reason: ${result.error}`
        );
        continue;
      }
      chunksReviewed++;
      llmDismissed += result.dismissed;
      aiFindings.push(...result.newFindings);
    }
    core.info(
      `  AI review: ${chunksReviewed}/${chunks.length} chunk(s) reviewed, ` +
        `${llmDismissed} rule flag(s) dismissed, ${aiFindings.length} new issue(s) found`
    );
  }

  // Give AI findings the same code context the rule findings carry.
  for (const f of aiFindings) {
    const parsed = parsedFiles.find(p => p.path === f.file);
    if (parsed) f.snippet = buildSnippet(parsed.hunkLines, f.line);
  }

  const scoredFindings = [...allFindings.filter(f => f.llmConfirmed !== false), ...aiFindings];

  // ── Stage 4: scoring ───────────────────────────────────────────────────
  const scores = calculateScores(scoredFindings);
  const decision = makeDecision(scores, scoredFindings);
  core.info(`  Decision: ${decision} | Overall: ${scores.overall}/100`);

  // min-severity only hides low-priority comments; scores and the decision
  // above still count every finding. Rule findings first, AI findings last;
  // each group most severe first. The 50-item cap keeps the most critical.
  const bySeverity = (a: Finding, b: Finding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  const shown = scoredFindings.filter(f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[s.minSeverity]);
  const ruleVisible = shown.filter(f => f.source !== 'ai').sort(bySeverity);
  const aiVisible = shown.filter(f => f.source === 'ai').sort(bySeverity);
  const aiSlots = Math.min(aiVisible.length, Math.max(10, 50 - ruleVisible.length));
  const visibleFindings = [...ruleVisible.slice(0, 50 - aiSlots), ...aiVisible.slice(0, aiSlots)];

  const aiUsed = Boolean(s.llmApiUrl) && chunksReviewed > 0;
  return {
    parsedFiles,
    scoredFindings,
    visibleFindings,
    scores,
    decision,
    aiUsed,
    stats: {
      ruleFlags: ruleCount,
      dismissed: llmDismissed,
      aiFound: aiFindings.length,
      aiUsed,
      aiPartial: chunksFailed > 0,
      hidden: scoredFindings.length - shown.length,
      minSeverity: s.minSeverity,
    },
  };
}

/** Sends the review to the dashboard, if one is configured. Never fails the run. */
async function report(
  s: Settings,
  r: ReviewResult,
  scannedDirectory: string,
  extra: Pick<PrivGuardReport, 'trigger' | 'pr' | 'push'>
): Promise<void> {
  if (!s.dashboardUrl || !s.dashboardToken) return;
  // Dashboard evidence: a few numbered lines centred on each finding.
  const findings = r.scoredFindings.map(f => {
    const parsed = r.parsedFiles.find(p => p.path === f.file);
    const numbered = parsed ? buildNumberedSnippet(parsed.hunkLines, f.line) : '';
    return { ...f, snippet: numbered || f.snippet };
  });
  const rep = buildReport({
    scannedDirectory,
    totalFiles: r.parsedFiles.length,
    findings,
    scores: r.scores,
    decision: r.decision,
    extra: {
      source: 'action',
      ...extra,
      pipeline: {
        ruleFlags: r.stats.ruleFlags,
        aiDismissed: r.stats.dismissed,
        aiFound: r.stats.aiFound,
        aiUsed: r.aiUsed,
        model: s.llmApiUrl ? s.llmModel : undefined,
      },
    },
  });
  const sent = await sendToDashboard(s.dashboardUrl, s.dashboardToken, rep);
  if (sent.ok) core.info(`  Sent report to dashboard (${sent.message.split(' ')[1] ?? 'ok'})`);
  else core.warning(`Could not send report to dashboard: ${sent.message}`);
}

function finish(s: Settings, r: ReviewResult, where: string): void {
  core.setOutput('decision', r.decision);
  core.setOutput('overall-score', String(r.scores.overall));
  if (s.strictMode && r.decision !== 'Safe to Merge') {
    const crit = r.scoredFindings.filter(f => f.severity === 'CRITICAL').length;
    core.setFailed(
      `PrivGuard Nexus: ${r.decision} — ${r.scoredFindings.length} finding(s) detected (including ${crit} critical). ${where}`
    );
  }
}

// ── Pull request mode: review before merging ─────────────────────────────
async function runPullRequest(s: Settings, octokit: ReturnType<typeof github.getOctokit>): Promise<void> {
  const { payload, repo } = github.context;
  const pr = payload.pull_request!;
  const pullNumber = pr.number as number;
  const commitSha = (pr.head as { sha: string }).sha;
  const { owner, repo: repoName } = repo;
  core.info(`[PrivGuard Nexus] PR #${pullNumber} — ${owner}/${repoName} @ ${commitSha.slice(0, 7)}`);

  const files = await fetchPRFiles(octokit, owner, repoName, pullNumber);
  core.info(`  ${files.length} file(s) in diff`);
  const r = await reviewFiles(files, s);

  const comments = r.visibleFindings.map(f => ({
    path: f.file,
    line: f.line,
    side: 'RIGHT' as const,
    body: buildInlineComment(f),
  }));
  const panel = buildRiskPanel(r.scores, r.decision, r.scoredFindings, r.stats);
  await postReview(octokit, owner, repoName, pullNumber, commitSha, panel, comments);
  core.info(`  Posted review with ${comments.length} inline comment(s)`);
  await core.summary.addRaw(panel).write();

  await report(s, r, `${owner}/${repoName}#${pullNumber}`, {
    trigger: 'pull_request',
    pr: {
      repo: `${owner}/${repoName}`,
      number: pullNumber,
      title: String(pr.title ?? ''),
      url: String(pr.html_url ?? ''),
      commitSha,
      author: String((pr.user as { login?: string } | undefined)?.login ?? ''),
    },
  });
  finish(s, r, 'Review inline comments for details.');
}

// ── Push mode: review what a push to the branch changed ──────────────────
async function runPush(s: Settings, octokit: ReturnType<typeof github.getOctokit>): Promise<void> {
  const { payload, repo } = github.context;
  const { owner, repo: repoName } = repo;
  const after = String(payload.after ?? github.context.sha);
  const before = String(payload.before ?? '');
  const branch = String(payload.ref ?? '').replace(/^refs\/heads\//, '');

  if (payload.deleted || /^0+$/.test(after)) {
    core.info('PrivGuard Nexus: branch deleted — nothing to review.');
    return;
  }
  core.info(`[PrivGuard Nexus] Push to ${branch} — ${owner}/${repoName} @ ${after.slice(0, 7)}`);

  // A merged pull request was already reviewed in PR mode; don't review it twice.
  const mergedPr = await findMergedPullRequest(octokit, owner, repoName, after);
  if (mergedPr) {
    core.info(`  This push merges PR #${mergedPr}, which PrivGuard already reviewed — skipping.`);
    return;
  }

  const files = await fetchPushFiles(octokit, owner, repoName, before, after);
  core.info(`  ${files.length} file(s) changed by this push`);
  const r = await reviewFiles(files, s);

  const head = (payload.head_commit ?? {}) as { message?: string; url?: string; author?: { username?: string; name?: string } };
  const commitCount = Array.isArray(payload.commits) ? payload.commits.length : 1;
  const panel = buildRiskPanel(r.scores, r.decision, r.scoredFindings, r.stats);

  // One summary comment on the pushed commit (skipped when there's nothing to report).
  if (r.scoredFindings.length > 0) {
    const body = [
      panel,
      '',
      `> This push is already on \`${branch}\`. Fix these in a follow-up commit, or use a pull request next time to catch them before they land.`,
      '',
      r.visibleFindings.length
        ? buildFindingsTable(r.visibleFindings, owner, repoName, after)
        : `_All findings are below the ${s.minSeverity} threshold._`,
    ].join('\n');
    await postCommitComment(octokit, owner, repoName, after, body);
    core.info(`  Posted a commit comment with ${r.visibleFindings.length} finding(s)`);
  } else {
    core.info('  No findings — no commit comment needed.');
  }
  await core.summary.addRaw(panel).write();

  await report(s, r, `${owner}/${repoName}@${branch}`, {
    trigger: 'push',
    push: {
      repo: `${owner}/${repoName}`,
      branch,
      commitSha: after,
      url: head.url || `https://github.com/${owner}/${repoName}/commit/${after}`,
      message: String(head.message ?? '').split('\n')[0].slice(0, 300),
      author: String(head.author?.username || head.author?.name || payload.pusher?.name || ''),
      commitCount,
    },
  });
  finish(s, r, 'See the comment on the commit for details.');
}

async function run(): Promise<void> {
  try {
    const s = readSettings();
    const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
    const event = github.context.eventName;

    if (github.context.payload.pull_request) {
      await runPullRequest(s, octokit);
    } else if (event === 'push') {
      await runPush(s, octokit);
    } else {
      core.info(`PrivGuard Nexus: "${event}" events aren't reviewed (use pull_request or push) — skipping.`);
    }
  } catch (err) {
    core.setFailed(`PrivGuard Nexus error: ${(err as Error).message}`);
  }
}

run();
