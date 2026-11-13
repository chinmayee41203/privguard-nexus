import { DecisionType, Finding, FindingType, PrivacyDiff, PrivGuardReport, Scores } from "./types";

/** Shared by the CLI and the GitHub Action, so the dashboard gets one report format. */

const CATEGORIES: FindingType[] = ["quality", "security", "privacy", "ai_safety", "backdoor"];

export function buildPrivacyDiff(findings: Finding[]): PrivacyDiff {
  const piiFields = new Set<string>();
  const thirdParties = new Set<string>();
  let loggingFindings = 0;

  for (const f of findings) {
    if (f.type !== "privacy") continue;
    if (f.ruleId === "P001" || f.ruleId === "P002" || f.ruleId === "P003") loggingFindings++;
    if (f.ruleId === "P006") piiFields.add("credit_card");
    if (f.ruleId === "P007") piiFields.add("location/IP");
    const urlMatch = f.snippet.match(/https?:\/\/([a-zA-Z0-9.\-]+)/);
    if (urlMatch && f.ruleId === "P004") thirdParties.add(urlMatch[1]);
  }

  const loggingRisk = loggingFindings >= 2 ? "high" : loggingFindings === 1 ? "medium" : "low";

  return {
    before: { piiFields: [], thirdParties: [], loggingRisk: "none" },
    after: {
      piiFields: Array.from(piiFields),
      thirdParties: Array.from(thirdParties),
      loggingRisk,
    },
    riskChangePct: Math.min(100, findings.filter((f) => f.type === "privacy").length * 12),
  };
}

export function buildReport(args: {
  scannedDirectory: string;
  totalFiles: number;
  findings: Finding[];
  scores: Scores;
  decision: DecisionType;
  extra?: Pick<PrivGuardReport, "source" | "trigger" | "pr" | "push" | "pipeline">;
}): PrivGuardReport {
  const { findings } = args;
  const count = (sev: Finding["severity"]) => findings.filter((f) => f.severity === sev).length;
  const byCategory = CATEGORIES.reduce(
    (acc, c) => ({ ...acc, [c]: findings.filter((f) => f.type === c).length }),
    {} as Record<FindingType, number>
  );

  return {
    version: "2.0",
    timestamp: new Date().toISOString(),
    scannedDirectory: args.scannedDirectory,
    overallDecision: args.decision,
    scores: args.scores,
    findings,
    privacyDiff: buildPrivacyDiff(findings),
    summary: {
      totalFiles: args.totalFiles,
      totalFindings: findings.length,
      criticalCount: count("CRITICAL"),
      highCount: count("HIGH"),
      mediumCount: count("MEDIUM"),
      lowCount: count("LOW"),
      byCategory,
    },
    ...args.extra,
  };
}

/** Sends a report to a PrivGuard dashboard. Never throws: a dashboard outage must not fail a review. */
export async function sendToDashboard(
  url: string,
  token: string,
  report: PrivGuardReport
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    });
    const text = await res.text();
    return { ok: res.ok, message: `HTTP ${res.status} ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
