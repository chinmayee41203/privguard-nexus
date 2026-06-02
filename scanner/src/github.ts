import * as github from '@actions/github';
import { Finding, Scores, DecisionType } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface PRFile {
  filename: string;
  patch?: string;
  status: string;
}

export async function fetchPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PRFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return files.map(f => ({
    filename: f.filename,
    patch: f.patch,
    status: f.status,
  }));
}

interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  bodyMarkdown: string,
  comments: ReviewComment[]
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitSha,
    body: bodyMarkdown,
    event: 'COMMENT',
    comments: comments.map(c => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
    })),
  });
}

export function buildRiskPanel(
  scores: Scores,
  decision: DecisionType,
  findings: Finding[]
): string {
  const decisionEmoji =
    decision === 'Safe to Merge' ? '✅' :
    decision === 'Needs Review'  ? '⚠️' : '🚫';

  const sevCounts = {
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    high:     findings.filter(f => f.severity === 'HIGH').length,
    medium:   findings.filter(f => f.severity === 'MEDIUM').length,
    low:      findings.filter(f => f.severity === 'LOW').length,
  };

  return [
    '## PrivGuard Sentinel — Risk Intelligence Panel',
    '',
    `**Decision: ${decisionEmoji} ${decision}**`,
    '',
    '| Metric | Score |',
    '|--------|-------|',
    `| Overall Risk  | ${scores.overall}/100 |`,
    `| Privacy       | ${scores.privacy}/100 |`,
    `| Security      | ${scores.security}/100 |`,
    `| AI Safety     | ${scores.aiSafety}/100 |`,
    `| Backdoor Risk | ${scores.backdoorRisk}/100 |`,
    `| Confidence    | ${scores.confidence}% |`,
    '',
    '| Severity | Count |',
    '|----------|-------|',
    `| 🔴 Critical | ${sevCounts.critical} |`,
    `| 🟠 High     | ${sevCounts.high} |`,
    `| 🟡 Medium   | ${sevCounts.medium} |`,
    `| 🟢 Low      | ${sevCounts.low} |`,
    '',
    `*${findings.length} total finding(s) detected in this PR's diff.*`,
  ].join('\n');
}

export function buildInlineComment(finding: Finding): string {
  const sevEmoji: Record<string, string> = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🟢',
  };
  const emoji = sevEmoji[finding.severity] ?? '⚠️';

  const lines = [
    `${emoji} **PrivGuard Sentinel** — \`${finding.ruleId}\`: ${finding.ruleTriggered}`,
    '',
    `**Why it matters:** ${finding.whyItMatters}`,
    '',
    `**Recommendation:** ${finding.recommendation}`,
  ];

  if (finding.llmReason) lines.push('', `**AI Analysis:** ${finding.llmReason}`);
  if (finding.llmFix)    lines.push('', `**Suggested fix:** ${finding.llmFix}`);
  if (finding.llmIntent) lines.push('', `**Intent:** \`${finding.llmIntent}\``);

  return lines.join('\n');
}
