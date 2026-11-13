export type DecisionType = "Safe to Merge" | "Needs Review" | "Do Not Merge";
export type FindingType = "quality" | "security" | "privacy" | "ai_safety" | "backdoor";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Intent = "accidental" | "negligent" | "suspicious" | "malicious";

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  file: string;
  line: number;
  snippet: string;
  ruleId: string;
  ruleTriggered: string;
  recommendation: string;
  whyItMatters: string;
  llmConfirmed?: boolean;
  llmViolationType?: string;
  llmReason?: string;
  llmFix?: string;
  llmIntent?: Intent;
  confidence?: number;
  /** Where the finding came from: the regex rule engine (default) or the AI review pass. */
  source?: "rule" | "ai";
}

export interface Scores {
  overall: number;
  privacy: number;
  security: number;
  aiSafety: number;
  backdoorRisk: number;
  confidence: number;
}

export interface PrivacyDiff {
  before: {
    piiFields: string[];
    thirdParties: string[];
    loggingRisk: "none" | "low" | "medium" | "high";
  };
  after: {
    piiFields: string[];
    thirdParties: string[];
    loggingRisk: "none" | "low" | "medium" | "high";
  };
  riskChangePct: number;
}

export interface PullRequestInfo {
  repo: string;      // owner/name
  number: number;
  title: string;
  url: string;
  commitSha: string;
  author: string;
}

export interface PushInfo {
  repo: string;        // owner/name
  branch: string;
  commitSha: string;   // the pushed tip
  url: string;         // link to the commit
  message: string;     // first line of the tip commit's message
  author: string;
  commitCount: number;
}

export interface PipelineStats {
  ruleFlags: number;   // findings raised by the rule engine
  aiDismissed: number; // rule flags the AI judged false positives
  aiFound: number;     // new issues found only by the AI review pass
  aiUsed: boolean;     // false when the review ran rules-only
  model?: string;
}

export interface PrivGuardReport {
  version: "2.0";
  timestamp: string;
  scannedDirectory: string;
  /** "action" for pull-request reviews, "cli" for local folder scans. */
  source?: "action" | "cli";
  /** What the Action reviewed: a pull request or a push to a branch. */
  trigger?: "pull_request" | "push";
  pr?: PullRequestInfo;
  push?: PushInfo;
  pipeline?: PipelineStats;
  overallDecision: DecisionType;
  scores: Scores;
  findings: Finding[];
  privacyDiff: PrivacyDiff;
  summary: {
    totalFiles: number;
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    byCategory: Record<FindingType, number>;
  };
}
