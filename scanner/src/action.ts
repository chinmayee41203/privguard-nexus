#!/usr/bin/env node
import * as core from '@actions/core';
import * as github from '@actions/github';
import { parsePatch, buildSnippet, ParsedFile } from './diff';
import { scanLineContent } from './rules';
import { buildChunks, reviewChunk } from './review';
import { calculateScores, makeDecision } from './scorer';
import { fetchPRFiles, postReview, buildRiskPanel, buildInlineComment } from './github';
import { buildReport, sendToDashboard } from './report';
import { Finding, Severity } from './types';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const llmApiUrl   = core.getInput('llm-api-url');
    const llmApiKey   = core.getInput('llm-api-key');
    const llmModel    = core.getInput('llm-model') || 'llama3:8b';
    const strictMode  = core.getInput('strict-mode') === 'true';
    const minSeverityInput = (core.getInput('min-severity') || 'LOW').toUpperCase();
    const minSeverity = (minSeverityInput in SEVERITY_ORDER ? minSeverityInput : 'LOW') as Severity;
    const maxChunkChars = Math.max(2000, parseInt(core.getInput('max-chunk-chars') || '12000', 10) || 12000);
    const dashboardUrl   = core.getInput('dashboard-url');
    const dashboardToken = core.getInput('dashboard-token');

    const { payload, repo } = github.context;
    const pullRequest = payload.pull_request;

    if (!pullRequest) {
      core.info('PrivGuard Nexus: no pull_request in event payload — skipping.');
      return;
    }

    const pullNumber: number = pullRequest.number as number;
    const commitSha: string  = (pullRequest.head as { sha: string }).sha;
    const { owner, repo: repoName } = repo;

    core.info(`[PrivGuard Nexus] PR #${pullNumber} — ${owner}/${repoName} @ ${commitSha.slice(0, 7)}`);

    const octokit = github.getOctokit(githubToken);

    // ── Stage 1: fetch diff ────────────────────────────────────────────────
    const prFiles = await fetchPRFiles(octokit, owner, repoName, pullNumber);
    core.info(`  ${prFiles.length} file(s) in diff`);

    // ── Stage 2: rule-based scan over added lines ──────────────────────────
    const allFindings: Finding[] = [];
    const parsedFiles: ParsedFile[] = [];

    for (const prFile of prFiles) {
      if (prFile.status === 'removed' || !prFile.patch) continue;

      const parsed   = parsePatch(prFile.filename, prFile.patch);
      const addedLines = parsed.hunkLines.filter(l => l.type === 'add');
      if (addedLines.length === 0) continue;
      parsedFiles.push(parsed);

      core.info(`  Scanning: ${prFile.filename} (${addedLines.length} added line(s))`);

      for (const line of addedLines) {
        const snippet      = buildSnippet(parsed.hunkLines, line.newLineNo);
        const lineFindings = scanLineContent(prFile.filename, line.newLineNo, line.content, snippet);
        if (lineFindings.length > 0) {
          core.info(`    [!] ${lineFindings.length} finding(s) at line ${line.newLineNo}`);
        }
        allFindings.push(...lineFindings);
      }
    }

    core.info(`  Rule scan complete: ${allFindings.length} finding(s)`);

    // ── Stage 3: AI review pass (one LLM call per diff chunk) ─────────────
    // Gives a verdict on each rule flag AND reports issues the rules missed.
    // If the LLM is down or out of quota, that chunk keeps its rule results.
    const ruleCount = allFindings.length;
    let llmDismissed = 0;
    let chunksReviewed = 0;
    let chunksFailed = 0;
    const aiFindings: Finding[] = [];

    if (llmApiUrl) {
      const cfg = { model: llmModel, url: llmApiUrl, key: llmApiKey };
      const chunks = parsedFiles.flatMap(p => buildChunks(p, maxChunkChars));
      core.info(`  AI review (model: ${llmModel}): ${chunks.length} chunk(s) of up to ${maxChunkChars} chars`);

      for (const chunk of chunks) {
        const flags = allFindings.filter(
          f => f.file === chunk.file && chunk.addedLines.has(f.line)
        );
        const result = await reviewChunk(chunk, flags, cfg);
        if (!result) {
          chunksFailed++;
          core.warning(`AI review unavailable for ${chunk.file}:${chunk.firstLine}-${chunk.lastLine}; using rule results only.`);
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

    const scoredFindings = [
      ...allFindings.filter(f => f.llmConfirmed !== false),
      ...aiFindings,
    ];

    // ── Stage 4: scoring ───────────────────────────────────────────────────
    const scores   = calculateScores(scoredFindings);
    const decision = makeDecision(scores, scoredFindings);

    core.info(`  Decision: ${decision} | Overall: ${scores.overall}/100`);

    // ── Stage 5: post GitHub PR review ────────────────────────────────────
    // min-severity only hides low-priority inline comments; scores and the
    // decision above still count every finding.
    const visibleFindings = scoredFindings.filter(
      f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[minSeverity]
    );
    // Rule findings first, AI-review findings last; each group most severe first.
    // The 50-comment cap keeps the most critical findings from both groups.
    const bySeverity = (a: Finding, b: Finding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    const ruleVisible = visibleFindings.filter(f => f.source !== 'ai').sort(bySeverity);
    const aiVisible   = visibleFindings.filter(f => f.source === 'ai').sort(bySeverity);
    const aiSlots     = Math.min(aiVisible.length, Math.max(10, 50 - ruleVisible.length));
    const sortedFindings = [...ruleVisible.slice(0, 50 - aiSlots), ...aiVisible.slice(0, aiSlots)];

    const inlineComments = sortedFindings.map(f => ({
      path: f.file,
      line: f.line,
      side: 'RIGHT' as const,
      body: buildInlineComment(f),
    }));

    const riskPanel = buildRiskPanel(scores, decision, scoredFindings, {
      ruleFlags: ruleCount,
      dismissed: llmDismissed,
      aiFound: aiFindings.length,
      aiUsed: Boolean(llmApiUrl) && chunksReviewed > 0,
      aiPartial: chunksFailed > 0,
      hidden: scoredFindings.length - visibleFindings.length,
      minSeverity,
    });

    await postReview(octokit, owner, repoName, pullNumber, commitSha, riskPanel, inlineComments);
    core.info(`  Posted review with ${inlineComments.length} inline comment(s)`);

    // ── Stage 6: GitHub Actions job summary ───────────────────────────────
    await core.summary.addRaw(riskPanel).write();

    // ── Stage 6b: optional dashboard ──────────────────────────────────────
    if (dashboardUrl && dashboardToken) {
      const report = buildReport({
        scannedDirectory: `${owner}/${repoName}#${pullNumber}`,
        totalFiles: parsedFiles.length,
        findings: scoredFindings,
        scores,
        decision,
        extra: {
          source: 'action',
          pr: {
            repo: `${owner}/${repoName}`,
            number: pullNumber,
            title: String(pullRequest.title ?? ''),
            url: String(pullRequest.html_url ?? ''),
            commitSha,
            author: String((pullRequest.user as { login?: string } | undefined)?.login ?? ''),
          },
          pipeline: {
            ruleFlags: ruleCount,
            aiDismissed: llmDismissed,
            aiFound: aiFindings.length,
            aiUsed: Boolean(llmApiUrl) && chunksReviewed > 0,
            model: llmApiUrl ? llmModel : undefined,
          },
        },
      });
      const sent = await sendToDashboard(dashboardUrl, dashboardToken, report);
      if (sent.ok) core.info(`  Sent report to dashboard (${sent.message.split(' ')[1] ?? 'ok'})`);
      else core.warning(`Could not send report to dashboard: ${sent.message}`);
    }

    // ── Stage 7: action outputs and optional failure ───────────────────────
    core.setOutput('decision', decision);
    core.setOutput('overall-score', String(scores.overall));

    if (strictMode && decision !== 'Safe to Merge') {
      const critCount = scoredFindings.filter(f => f.severity === 'CRITICAL').length;
      const totalCount = scoredFindings.length;
      core.setFailed(
        `PrivGuard Nexus: ${decision} — ${totalCount} finding(s) detected (including ${critCount} critical). Review inline comments for details.`
      );
    }
  } catch (err) {
    core.setFailed(`PrivGuard Nexus error: ${(err as Error).message}`);
  }
}

run();
