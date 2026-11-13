export type DecisionType = "Safe to Merge" | "Needs Review" | "Do Not Merge";
export type FindingType = "quality" | "security" | "privacy" | "ai_safety" | "backdoor";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

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
  llmReason?: string;
  llmFix?: string;
  llmIntent?: string;
  /** "rule" (regex rule engine) or "ai" (found only by the AI review pass). */
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
  before: { piiFields: string[]; thirdParties: string[]; loggingRisk: string };
  after: { piiFields: string[]; thirdParties: string[]; loggingRisk: string };
  riskChangePct: number;
}

export interface PullRequestInfo {
  repo: string;
  number: number;
  title: string;
  url: string;
  commitSha: string;
  author: string;
}

export interface PipelineStats {
  ruleFlags: number;
  aiDismissed: number;
  aiFound: number;
  aiUsed: boolean;
  model?: string;
}

export interface PrivGuardReport {
  version: string;
  timestamp: string;
  scannedDirectory: string;
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
  source?: "action" | "cli";
  pr?: PullRequestInfo;
  pipeline?: PipelineStats;
}
