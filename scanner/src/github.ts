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

/**
 * Files changed by a push. Compares the previous tip with the new one; for a
 * brand-new branch (no previous tip) it uses the pushed commit's own changes.
 */
export async function fetchPushFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  before: string,
  after: string
): Promise<PRFile[]> {
  const isNewBranch = !before || /^0+$/.test(before);
  const files = isNewBranch
    ? (await octokit.rest.repos.getCommit({ owner, repo, ref: after })).data.files ?? []
    : (await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${before}...${after}` })).data.files ?? [];
  return files.map(f => ({ filename: f.filename, patch: f.patch, status: f.status }));
}

/** If this commit is the result of merging a pull request, returns that PR's number. */
export async function findMergedPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<number | null> {
  try {
    const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: sha });
    const merged = data.find(pr => pr.merged_at && pr.merge_commit_sha === sha);
    return merged ? merged.number : null;
  } catch {
    return null;
  }
}

export async function postCommitComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  body: string
): Promise<void> {
  await octokit.rest.repos.createCommitComment({ owner, repo, commit_sha: sha, body });
}

/** Markdown table of findings for a push, each linked to its line at that commit. */
export function buildFindingsTable(findings: Finding[], owner: string, repo: string, sha: string): string {
  const sevEmoji: Record<string, string> = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = findings.map(f => {
    const link = `https://github.com/${owner}/${repo}/blob/${sha}/${f.file}#L${f.line}`;
    const what = f.source === 'ai' ? `🤖 ${esc(f.ruleTriggered)}` : `\`${f.ruleId}\` ${esc(f.ruleTriggered)}`;
    const fix = esc(f.llmFix || f.recommendation);
    return `| ${sevEmoji[f.severity] ?? '⚠️'} ${f.severity} | [${esc(f.file)}:${f.line}](${link}) | ${what} | ${fix} |`;
  });
  return ['| Severity | Where | Finding | Suggested fix |', '|---|---|---|---|', ...rows].join('\n');
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

export interface ReviewStats {
  ruleFlags: number;
  dismissed: number;
  aiFound: number;
  aiUsed: boolean;
  aiPartial: boolean;
  hidden: number;
  minSeverity: string;
}

export function buildRiskPanel(
  scores: Scores,
  decision: DecisionType,
  findings: Finding[],
  stats?: ReviewStats
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

  const pipeline: string[] = [];
  if (stats) {
    pipeline.push('', '| Review pipeline | Result |', '|----------|-------|');
    pipeline.push(`| Rule engine flags | ${stats.ruleFlags} |`);
    if (stats.aiUsed) {
      pipeline.push(`| Dismissed by AI as false positives | ${stats.dismissed} |`);
      pipeline.push(`| New issues found by AI review | ${stats.aiFound} |`);
    } else {
      pipeline.push('| AI review | not run (rules only) |');
    }
    if (stats.aiPartial) pipeline.push('| Note | AI unavailable for part of the diff; rule results used there |');
    if (stats.hidden > 0) {
      pipeline.push(`| Hidden below min-severity (${stats.minSeverity}) | ${stats.hidden} |`);
    }
  }

  return [
    '## PrivGuard Nexus — Risk Intelligence Panel',
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
    ...pipeline,
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

  if (finding.source === 'ai') {
    const ai = [
      `${emoji} **PrivGuard Nexus** — 🤖 AI review (${finding.severity.toLowerCase()}): ${finding.ruleTriggered}`,
      '',
      `**Why it matters:** ${finding.whyItMatters}`,
      '',
      `**Suggested fix:** ${finding.recommendation}`,
    ];
    if (finding.llmIntent) ai.push('', `**Intent:** \`${finding.llmIntent}\``);
    ai.push('', '_Not covered by the rule engine; found by the AI review pass._');
    return ai.join('\n');
  }

  const lines = [
    `${emoji} **PrivGuard Nexus** — \`${finding.ruleId}\`: ${finding.ruleTriggered}`,
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
