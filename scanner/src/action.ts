#!/usr/bin/env node
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'path';
import { parsePatch, buildSnippet } from './diff';
import { scanLineContent } from './rules';
import { analyzeWithLLM } from './llm';
import { calculateScores, makeDecision } from './scorer';
import { fetchPRFiles, postReview, buildRiskPanel, buildInlineComment } from './github';
import { Finding } from './types';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const llmApiUrl   = core.getInput('llm-api-url');
    const llmApiKey   = core.getInput('llm-api-key');
    const llmModel    = core.getInput('llm-model') || 'llama3:8b';
    const strictMode  = core.getInput('strict-mode') === 'true';

    const { payload, repo } = github.context;
    const pullRequest = payload.pull_request;

    if (!pullRequest) {
      core.info('PrivGuard Sentinel: no pull_request in event payload — skipping.');
      return;
    }

    const pullNumber: number = pullRequest.number as number;
    const commitSha: string  = (pullRequest.head as { sha: string }).sha;
    const { owner, repo: repoName } = repo;

    core.info(`[PrivGuard Sentinel] PR #${pullNumber} — ${owner}/${repoName} @ ${commitSha.slice(0, 7)}`);

    const octokit = github.getOctokit(githubToken);

    // ── Stage 1: fetch diff ────────────────────────────────────────────────
    const prFiles = await fetchPRFiles(octokit, owner, repoName, pullNumber);
    core.info(`  ${prFiles.length} file(s) in diff`);

    // ── Stage 2: rule-based scan over added lines ──────────────────────────
    const allFindings: Finding[] = [];

    for (const prFile of prFiles) {
      if (prFile.status === 'removed' || !prFile.patch) continue;

      const parsed   = parsePatch(prFile.filename, prFile.patch);
      const addedLines = parsed.hunkLines.filter(l => l.type === 'add');
      if (addedLines.length === 0) continue;

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

    // ── Stage 3: optional LLM reasoning ───────────────────────────────────
    let llmDismissed = 0;

    if (llmApiUrl) {
      core.info(`  LLM reasoning (model: ${llmModel}, url: ${llmApiUrl})...`);
      for (const finding of allFindings) {
        const result = await analyzeWithLLM(
          path.basename(finding.file),
          finding.line,
          finding.snippet,
          llmModel,
          llmApiUrl,
          llmApiKey
        );
        finding.llmConfirmed    = result.isViolation;
        finding.llmViolationType = result.type;
        finding.llmReason       = result.reason;
        finding.llmFix          = result.fix;
        finding.llmIntent       = result.intent;
        if (!result.isViolation) llmDismissed++;
      }
      core.info(`  LLM: ${allFindings.length - llmDismissed} confirmed, ${llmDismissed} dismissed`);
    }

    const scoredFindings = llmApiUrl
      ? allFindings.filter(f => f.llmConfirmed !== false)
      : allFindings;

    // ── Stage 4: scoring ───────────────────────────────────────────────────
    const scores   = calculateScores(scoredFindings);
    const decision = makeDecision(scores, scoredFindings);

    core.info(`  Decision: ${decision} | Overall: ${scores.overall}/100`);

    // ── Stage 5: post GitHub PR review ────────────────────────────────────
    // Sort by severity so the 50-comment cap keeps the most critical findings
    const sortedFindings = [...scoredFindings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    const inlineComments = sortedFindings.slice(0, 50).map(f => ({
      path: f.file,
      line: f.line,
      side: 'RIGHT' as const,
      body: buildInlineComment(f),
    }));

    const riskPanel = buildRiskPanel(scores, decision, scoredFindings);

    await postReview(octokit, owner, repoName, pullNumber, commitSha, riskPanel, inlineComments);
    core.info(`  Posted review with ${inlineComments.length} inline comment(s)`);

    // ── Stage 6: GitHub Actions job summary ───────────────────────────────
    await core.summary.addRaw(riskPanel).write();

    // ── Stage 7: action outputs and optional failure ───────────────────────
    core.setOutput('decision', decision);
    core.setOutput('overall-score', String(scores.overall));

    if (strictMode && decision !== 'Safe to Merge') {
      const critCount = scoredFindings.filter(f => f.severity === 'CRITICAL').length;
      const totalCount = scoredFindings.length;
      core.setFailed(
        `PrivGuard Sentinel: ${decision} — ${totalCount} finding(s) detected (including ${critCount} critical). Review inline comments for details.`
      );
    }
  } catch (err) {
    core.setFailed(`PrivGuard Sentinel error: ${(err as Error).message}`);
  }
}

run();
