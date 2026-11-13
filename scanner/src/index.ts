#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
import { Command } from "commander";
import { traverseDirectory, readFile } from "./traversal";
import { scanFileContent } from "./rules";
import { calculateScores, makeDecision } from "./scorer";
import { analyzeWithLLM } from "./llm";
import { buildPrivacyDiff } from "./report";
import { Finding, FindingType, PrivGuardReport } from "./types";

const program = new Command();

program
  .name("privguard")
  .description("PrivGuard Nexus — Unified AI code review for privacy, security, and insider threats")
  .version("2.0.0")
  .argument("<target>", "Directory or file to scan")
  .option("-o, --output <file>", "Write JSON report to file", "privguard-report.json")
  .option("--no-report", "Skip writing JSON report to disk")
  .option("--fail-on-block", "Exit with code 1 if decision is Do Not Merge")
  .option("--llm", "Enable LLM reasoning agent (uses LLM_API_URL env var, defaults to local Ollama)")
  .option("--llm-model <model>", "Model name", "llama3:8b")
  .option("--llm-url <url>", "LLM base URL (overrides LLM_API_URL env var)")
  .parse(process.argv);

const [target] = program.args;
const opts = program.opts();

const CATEGORY_LABELS: Record<FindingType, string> = {
  privacy: "Privacy",
  security: "Security",
  quality: "Quality",
  ai_safety: "AI Safety",
  backdoor: "Backdoor",
};

async function run() {
  const resolvedTarget = path.resolve(target);

  if (!fs.existsSync(resolvedTarget)) {
    console.error(`[PrivGuard] ERROR: Target not found: ${resolvedTarget}`);
    process.exit(2);
  }

  const isFile = fs.statSync(resolvedTarget).isFile();
  const files = isFile ? [resolvedTarget] : traverseDirectory(resolvedTarget);

  console.log(`\n[PrivGuard Nexus] Scanning ${files.length} file(s) in: ${resolvedTarget}\n`);

  const allFindings: Finding[] = [];

  for (const file of files) {
    const relativePath = path.relative(resolvedTarget, file);
    console.log(`  Scanning: ${relativePath || path.basename(file)}`);
    try {
      const content = readFile(file);
      const findings = scanFileContent(file, content);
      if (findings.length > 0) {
        console.log(`    [!] ${findings.length} finding(s)`);
      }
      allFindings.push(...findings);
    } catch {
      console.warn(`    [WARN] Could not read file: ${file}`);
    }
  }

  // Stage 2: LLM reasoning agent
  let llmDismissed = 0;
  if (opts.llm) {
    const llmUrl = opts.llmUrl ?? process.env.LLM_API_URL ?? "http://localhost:11434";
    console.log(`\n[PrivGuard] LLM Reasoning Agent (model: ${opts.llmModel}, url: ${llmUrl})...\n`);
    for (const finding of allFindings) {
      process.stdout.write(`  Reasoning: ${path.basename(finding.file)}:${finding.line} ... `);
      const result = await analyzeWithLLM(
        path.basename(finding.file),
        finding.line,
        finding.snippet,
        opts.llmModel,
        llmUrl
      );
      if (result.unavailable) {
        console.log(`LLM UNAVAILABLE — keeping rule result (${result.reason.slice(0, 70)})`);
        continue;
      }
      finding.llmConfirmed = result.isViolation;
      finding.llmViolationType = result.type;
      finding.llmReason = result.reason;
      finding.llmFix = result.fix;
      finding.llmIntent = result.intent;
      if (!result.isViolation) {
        llmDismissed++;
        console.log(`DISMISSED — ${result.reason.slice(0, 70)}`);
      } else {
        console.log(`CONFIRMED [${result.type}] intent=${result.intent}`);
      }
    }
    console.log(`\n  Confirmed: ${allFindings.length - llmDismissed} | Dismissed: ${llmDismissed}\n`);
  }

  const scoredFindings = opts.llm
    ? allFindings.filter((f) => f.llmConfirmed !== false)
    : allFindings;

  const scores = calculateScores(scoredFindings);
  const decision = makeDecision(scores, scoredFindings);
  const privacyDiff = buildPrivacyDiff(scoredFindings);

  const byCategory = (["quality", "security", "privacy", "ai_safety", "backdoor"] as FindingType[]).reduce(
    (acc, t) => ({ ...acc, [t]: scoredFindings.filter((f) => f.type === t).length }),
    {} as Record<FindingType, number>
  );

  const severityCounts = {
    criticalCount: scoredFindings.filter((f) => f.severity === "CRITICAL").length,
    highCount: scoredFindings.filter((f) => f.severity === "HIGH").length,
    mediumCount: scoredFindings.filter((f) => f.severity === "MEDIUM").length,
    lowCount: scoredFindings.filter((f) => f.severity === "LOW").length,
  };

  const report: PrivGuardReport = {
    version: "2.0",
    timestamp: new Date().toISOString(),
    scannedDirectory: resolvedTarget,
    source: "cli",
    overallDecision: decision,
    scores,
    findings: allFindings,
    privacyDiff,
    summary: {
      totalFiles: files.length,
      totalFindings: scoredFindings.length,
      ...severityCounts,
      byCategory,
    },
  };

  // Console output
  const decisionColor = decision === "Safe to Merge" ? "✅" : decision === "Needs Review" ? "⚠️ " : "🚫";
  console.log("\n" + "═".repeat(64));
  console.log("  PrivGuard Nexus — Scan Results");
  console.log("═".repeat(64));
  console.log(`  Decision     : ${decisionColor} ${decision}`);
  console.log(`  Overall Risk : ${scores.overall}/100`);
  console.log(`  Privacy      : ${scores.privacy}/100`);
  console.log(`  Security     : ${scores.security}/100`);
  console.log(`  AI Safety    : ${scores.aiSafety}/100`);
  console.log(`  Backdoor     : ${scores.backdoorRisk}/100`);
  console.log(`  Confidence   : ${scores.confidence}%`);
  console.log(`  Findings     : ${scoredFindings.length} total (${severityCounts.criticalCount} critical, ${severityCounts.highCount} high)`);
  if (byCategory.quality) console.log(`  Quality      : ${byCategory.quality} issue(s)`);
  if (opts.llm && llmDismissed > 0) console.log(`  LLM dismissed: ${llmDismissed} false positive(s)`);
  console.log("═".repeat(64));

  if (scoredFindings.length > 0) {
    console.log("\n  Findings:\n");
    for (const f of scoredFindings) {
      console.log(`  [${f.severity}] [${CATEGORY_LABELS[f.type]}] ${f.ruleTriggered} (${f.ruleId})`);
      console.log(`     File  : ${path.relative(resolvedTarget, f.file)} (line ${f.line})`);
      console.log(`     Why   : ${f.whyItMatters.slice(0, 100)}`);
      if (f.llmReason) console.log(`     LLM   : ${f.llmReason.slice(0, 100)}`);
      console.log(`     Fix   : ${f.recommendation}`);
      console.log();
    }
  }

  if (opts.report !== false) {
    const outputPath = path.resolve(opts.output);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`  Report → ${outputPath}\n`);
  }

  if (opts.failOnBlock && decision === "Do Not Merge") {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[PrivGuard] Fatal error:", err);
  process.exit(2);
});
