import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DecisionType, Finding, FindingType, PrivGuardReport } from "@/lib/reportTypes";

export const dynamic = "force-dynamic";

const MAX_FINDINGS = 200;
const str = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** Only the PrivGuard Action (holding DASHBOARD_TOKEN) may save reports. */
function authorized(req: NextRequest): boolean {
  const expected = process.env.DASHBOARD_TOKEN ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Partial<PrivGuardReport>;
    const { scores, summary, overallDecision } = body;
    if (!scores || !summary || !overallDecision || !Array.isArray(body.findings)) {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
    const findings = body.findings.slice(0, MAX_FINDINGS);

    const report = await prisma.report.create({
      data: {
        timestamp: str(body.timestamp, 40) || new Date().toISOString(),
        scannedDirectory: str(body.scannedDirectory, 300),
        overallDecision: str(overallDecision, 20),
        overallScore: int(scores.overall),
        privacyScore: int(scores.privacy),
        securityScore: int(scores.security),
        aiSafetyScore: int(scores.aiSafety),
        backdoorRiskScore: int(scores.backdoorRisk),
        confidenceScore: int(scores.confidence),
        totalFiles: int(summary.totalFiles),
        totalFindings: int(summary.totalFindings),
        criticalCount: int(summary.criticalCount),
        highCount: int(summary.highCount),
        mediumCount: int(summary.mediumCount),
        lowCount: int(summary.lowCount),
        qualityCount: int(summary.byCategory?.quality),
        securityCount: int(summary.byCategory?.security),
        privacyCount: int(summary.byCategory?.privacy),
        aiSafetyCount: int(summary.byCategory?.ai_safety),
        backdoorCount: int(summary.byCategory?.backdoor),
        privacyDiffJson: body.privacyDiff ? JSON.stringify(body.privacyDiff).slice(0, 5000) : null,
        source: body.source === "action" ? "action" : "cli",
        repo: body.pr ? str(body.pr.repo, 200) : null,
        prNumber: body.pr ? int(body.pr.number) : null,
        prTitle: body.pr ? str(body.pr.title, 300) : null,
        prUrl: body.pr && /^https:\/\/github\.com\//.test(String(body.pr.url)) ? str(body.pr.url, 300) : null,
        commitSha: body.pr ? str(body.pr.commitSha, 40) : null,
        prAuthor: body.pr ? str(body.pr.author, 100) : null,
        ruleFlags: body.pipeline ? int(body.pipeline.ruleFlags) : null,
        aiDismissed: body.pipeline ? int(body.pipeline.aiDismissed) : null,
        aiFound: body.pipeline ? int(body.pipeline.aiFound) : null,
        aiUsed: Boolean(body.pipeline?.aiUsed),
        model: body.pipeline?.model ? str(body.pipeline.model, 100) : null,
        findings: {
          create: findings.map((f: Finding) => ({
            findingId: str(f.id, 64),
            type: str(f.type, 20),
            severity: str(f.severity, 10),
            file: str(f.file, 300),
            line: int(f.line),
            snippet: str(f.snippet, 1500),
            ruleId: str(f.ruleId, 20),
            ruleTriggered: str(f.ruleTriggered, 200),
            recommendation: str(f.recommendation, 1000),
            whyItMatters: str(f.whyItMatters, 1000),
            llmReason: f.llmReason ? str(f.llmReason, 1000) : null,
            llmFix: f.llmFix ? str(f.llmFix, 1000) : null,
            llmIntent: f.llmIntent ? str(f.llmIntent, 20) : null,
            source: f.source === "ai" ? "ai" : "rule",
          })),
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, reportId: report.id }, { status: 201 });
  } catch (err) {
    console.error("[API /reports POST]", err);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}

/** Public, read-only: the latest reviews, already in the dashboard's report shape. */
export async function GET() {
  try {
    const rows = await prisma.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { findings: true },
    });

    const reports: PrivGuardReport[] = rows.map((r) => ({
      version: "2.0",
      timestamp: r.timestamp,
      scannedDirectory: r.scannedDirectory,
      overallDecision: r.overallDecision as DecisionType,
      scores: {
        overall: r.overallScore,
        privacy: r.privacyScore,
        security: r.securityScore,
        aiSafety: r.aiSafetyScore,
        backdoorRisk: r.backdoorRiskScore,
        confidence: r.confidenceScore,
      },
      findings: r.findings.map((f) => ({
        id: f.findingId,
        type: f.type as FindingType,
        severity: f.severity as Finding["severity"],
        file: f.file,
        line: f.line,
        snippet: f.snippet,
        ruleId: f.ruleId,
        ruleTriggered: f.ruleTriggered,
        recommendation: f.recommendation,
        whyItMatters: f.whyItMatters,
        llmReason: f.llmReason ?? undefined,
        llmFix: f.llmFix ?? undefined,
        llmIntent: f.llmIntent ?? undefined,
        source: f.source === "ai" ? "ai" : "rule",
      })),
      privacyDiff: r.privacyDiffJson
        ? JSON.parse(r.privacyDiffJson)
        : {
            before: { piiFields: [], thirdParties: [], loggingRisk: "none" },
            after: { piiFields: [], thirdParties: [], loggingRisk: "none" },
            riskChangePct: 0,
          },
      summary: {
        totalFiles: r.totalFiles,
        totalFindings: r.totalFindings,
        criticalCount: r.criticalCount,
        highCount: r.highCount,
        mediumCount: r.mediumCount,
        lowCount: r.lowCount,
        byCategory: {
          quality: r.qualityCount,
          security: r.securityCount,
          privacy: r.privacyCount,
          ai_safety: r.aiSafetyCount,
          backdoor: r.backdoorCount,
        },
      },
      source: r.source === "action" ? "action" : "cli",
      pr:
        r.repo && r.prNumber != null
          ? {
              repo: r.repo,
              number: r.prNumber,
              title: r.prTitle ?? "",
              url: r.prUrl ?? "",
              commitSha: r.commitSha ?? "",
              author: r.prAuthor ?? "",
            }
          : undefined,
      pipeline:
        r.ruleFlags != null
          ? {
              ruleFlags: r.ruleFlags,
              aiDismissed: r.aiDismissed ?? 0,
              aiFound: r.aiFound ?? 0,
              aiUsed: r.aiUsed,
              model: r.model ?? undefined,
            }
          : undefined,
    }));

    return NextResponse.json(reports);
  } catch (err) {
    console.error("[API /reports GET]", err);
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 });
  }
}
