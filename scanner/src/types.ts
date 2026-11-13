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

export interface PrivGuardReport {
  version: "2.0";
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
}
