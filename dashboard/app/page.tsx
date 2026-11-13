"use client";

import { useState, useEffect, useCallback } from "react";
import { PrivGuardReport, Finding, FindingType, DecisionType } from "@/lib/reportTypes";
import { DEMO_SCENARIOS } from "@/lib/demoData";

// ── Helpers ──────────────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score <= 30) return "#10b981";
  if (score <= 60) return "#f59e0b";
  if (score <= 80) return "#f97316";
  return "#f43f5e";
}

function riskGaugeClass(score: number): string {
  if (score <= 30) return "gauge-safe";
  if (score <= 60) return "gauge-warn";
  if (score <= 80) return "gauge-high";
  return "gauge-crit";
}

const DECISION_STYLE: Record<DecisionType, { cls: string; icon: string }> = {
  "Safe to Merge": { cls: "decision-safe",   icon: "✅" },
  "Needs Review":  { cls: "decision-review", icon: "⚠️" },
  "Do Not Merge":  { cls: "decision-block",  icon: "🚫" },
};

const CAT_LABELS: Record<FindingType, string> = {
  privacy:   "Privacy",
  security:  "Security",
  quality:   "Quality",
  ai_safety: "AI Safety",
  backdoor:  "Backdoor",
};

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const REPO_URL = "https://github.com/chinmayee41203/privguard-nexus";
const DEMO_PR_URL = `${REPO_URL}/pull/2`;

function reviewLabel(r: PrivGuardReport): string {
  return r.pr ? `${r.pr.repo} #${r.pr.number}` : r.scannedDirectory;
}

// ── PullRequestCard ───────────────────────────────────────────────────────────

function PullRequestCard({ r }: { r: PrivGuardReport }) {
  if (!r.pr) return null;
  const { pr } = r;
  return (
    <div className="glass p-4 flex items-center justify-between flex-wrap gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Pull request reviewed</p>
        <p className="text-sm font-semibold text-gray-100 truncate">{pr.title || `PR #${pr.number}`}</p>
        <p className="text-xs text-gray-500 font-mono mt-0.5">
          {pr.repo} #{pr.number}
          {pr.commitSha && <> · {pr.commitSha.slice(0, 7)}</>}
          {pr.author && <> · by {pr.author}</>}
          {" · "}{new Date(r.timestamp).toLocaleString()}
        </p>
      </div>
      {pr.url && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition-colors shrink-0"
        >
          View on GitHub ↗
        </a>
      )}
    </div>
  );
}

// ── PipelineStrip ─────────────────────────────────────────────────────────────

function PipelineStrip({ r }: { r: PrivGuardReport }) {
  if (!r.pipeline) return null;
  const p = r.pipeline;
  const steps = p.aiUsed
    ? [
        { label: "Rule engine flags", value: p.ruleFlags, cls: "text-gray-100" },
        { label: "Dismissed by AI as false positives", value: p.aiDismissed, cls: "text-amber-300" },
        { label: "New issues found by AI review", value: p.aiFound, cls: "text-indigo-300" },
        { label: "Findings reported", value: r.summary.totalFindings, cls: "text-rose-300" },
      ]
    : [
        { label: "Rule engine flags", value: p.ruleFlags, cls: "text-gray-100" },
        { label: "Findings reported", value: r.summary.totalFindings, cls: "text-rose-300" },
      ];

  return (
    <div className="glass p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Review pipeline</p>
        <span className="text-xs text-gray-500 font-mono">
          {p.aiUsed ? `rules → AI review (${p.model ?? "LLM"}) → score` : "rules only (AI review not run)"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <div key={s.label} className="rounded-xl bg-white/3 border border-white/5 p-3 relative">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            {i < steps.length - 1 && (
              <span className="hidden md:block absolute -right-2.5 top-1/2 -translate-y-1/2 text-gray-600">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ScoreGauge ────────────────────────────────────────────────────────────────

function ScoreGauge({ label, score }: { label: string; score: number }) {
  const R = 38;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - score / 100);
  const color = riskColor(score);

  return (
    <div className="flex flex-col items-center gap-1 group">
      <div className={`relative ${riskGaugeClass(score)}`}>
        <svg viewBox="0 0 100 100" className="w-24 h-24 -rotate-90 transition-all duration-700">
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke={color} strokeWidth="7"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">{label}</span>
    </div>
  );
}

// ── IssueCard ────────────────────────────────────────────────────────────────

function IssueCard({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const sevCls = `badge-${f.severity.toLowerCase()}`;
  const catCls = `cat-${f.type}`;

  return (
    <div
      className="glass card-hover cursor-pointer overflow-hidden"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col items-start gap-2 min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sevCls}`}>{f.severity}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${catCls}`}>{CAT_LABELS[f.type]}</span>
            {f.source === "ai" ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                🤖 Found by AI review
              </span>
            ) : (
              <span className="text-xs text-gray-500 font-mono">{f.ruleId}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-100">{f.ruleTriggered}</p>
          <p className="text-xs text-gray-400 font-mono">
            {f.file.split("/").slice(-2).join("/")} · line {f.line}
          </p>
        </div>
        <span className={`text-gray-500 text-sm transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▼</span>
      </div>

      {open && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-3">
          {f.snippet && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Evidence</p>
              <div className="snippet">{f.snippet.slice(0, 400)}</div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Why it matters</p>
            <p className="text-sm text-gray-300">{f.whyItMatters || f.recommendation}</p>
          </div>
          {f.llmReason && (
            <div>
              <p className="text-xs font-semibold text-yellow-500/70 uppercase tracking-wide mb-1">🤖 AI Analysis</p>
              <p className="text-sm text-yellow-200/80">{f.llmReason}</p>
              {f.llmIntent && (
                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  f.llmIntent === "malicious" ? "badge-critical" :
                  f.llmIntent === "suspicious" ? "badge-high" :
                  f.llmIntent === "negligent" ? "badge-medium" : "badge-low"
                }`}>Intent: {f.llmIntent}</span>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-emerald-500/70 uppercase tracking-wide mb-1">Suggested Fix</p>
            {f.llmFix ? (
              <p className="text-sm text-emerald-300/80">{f.llmFix}</p>
            ) : (
              <p className="text-sm text-gray-300">{f.recommendation}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PrivacyDiffTimeline ───────────────────────────────────────────────────────

function PrivacyDiffTimeline({ diff }: { report: PrivGuardReport; diff: PrivGuardReport["privacyDiff"] }) {
  const hasChanges = diff.riskChangePct > 0 ||
    JSON.stringify(diff.before) !== JSON.stringify(diff.after);

  const loggingColor: Record<string, string> = {
    none: "text-emerald-400", low: "text-yellow-400",
    medium: "text-orange-400", high: "text-rose-400",
  };

  return (
    <div className="glass p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">Privacy Impact Timeline</h2>
        {diff.riskChangePct > 0 ? (
          <span className="text-rose-400 font-bold text-sm">+{diff.riskChangePct}% risk change</span>
        ) : (
          <span className="text-emerald-400 font-bold text-sm">No change</span>
        )}
      </div>

      {!hasChanges ? (
        <p className="text-sm text-gray-500">This PR does not change the privacy risk profile.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {(["before", "after"] as const).map((phase) => (
            <div key={phase} className={`rounded-xl p-4 space-y-2 border ${
              phase === "before"
                ? "bg-white/3 border-white/5"
                : "bg-rose-500/5 border-rose-500/20"
            }`}>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                {phase === "before" ? "Before PR" : "After PR"}
              </p>
              <div>
                <p className="text-xs text-gray-500 mb-1">PII Collected</p>
                {diff[phase].piiFields.length === 0
                  ? <p className="text-xs text-emerald-400">None</p>
                  : diff[phase].piiFields.map((f) => (
                      <span key={f} className="inline-block text-xs bg-white/5 px-2 py-0.5 rounded-full mr-1 mb-1">{f}</span>
                    ))
                }
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Third Parties</p>
                {diff[phase].thirdParties.length === 0
                  ? <p className="text-xs text-emerald-400">None</p>
                  : diff[phase].thirdParties.map((t) => (
                      <span key={t} className="inline-block text-xs bg-rose-500/10 text-rose-300 px-2 py-0.5 rounded-full mr-1">{t}</span>
                    ))
                }
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Logging Risk</p>
                <p className={`text-xs font-semibold capitalize ${loggingColor[diff[phase].loggingRisk] ?? "text-gray-400"}`}>
                  {diff[phase].loggingRisk}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [report, setReport] = useState<PrivGuardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDemo, setActiveDemo] = useState<string | null>(null);
  const [filter, setFilter] = useState<FindingType | "all">("all");
  const [history, setHistory] = useState<PrivGuardReport[]>([]);

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      if (!res.ok) return;
      const data: PrivGuardReport[] = await res.json();
      if (!Array.isArray(data) || data.length === 0) return;

      setHistory(data);
      setReport(data[0]);
    } catch {
      // API unavailable — no-op, demo mode still works
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const selectDemo = (key: string) => {
    setActiveDemo(key);
    setReport(DEMO_SCENARIOS[key].report);
    setFilter("all");
  };

  const clearDemo = () => {
    setActiveDemo(null);
    if (history.length > 0) setReport(history[0]);
    else setReport(null);
  };

  const displayed = report;
  const filteredFindings = (displayed?.findings ?? [])
    .filter((f) => filter === "all" || f.type === filter)
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  const catCounts = (displayed?.summary.byCategory) ?? { quality: 0, security: 0, privacy: 0, ai_safety: 0, backdoor: 0 };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-2 border-indigo-500/40 border-t-indigo-500 rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading PrivGuard Nexus...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              PrivGuard Nexus
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              AI code review for pull requests · every review from the GitHub Action lands here
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors">
              GitHub ↗
            </a>
            <a href={DEMO_PR_URL} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors">
              Demo PR ↗
            </a>
            {activeDemo && (
              <button onClick={clearDemo} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors">
                ✕ Exit Demo
              </button>
            )}
            <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${activeDemo ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"}`}>
              {activeDemo ? "DEMO MODE" : history.length > 0 ? "LIVE" : "NO DATA"}
            </span>
          </div>
        </div>

        {/* ── Demo Buttons ──────────────────────────────────────────────── */}
        <div className="glass p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Try a demo scenario {history.length > 0 && <span className="normal-case tracking-normal text-gray-600">· or exit demo to see the latest live review</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(DEMO_SCENARIOS).map(([key, s]) => (
              <button
                key={key}
                onClick={() => selectDemo(key)}
                className={`group text-left px-4 py-2 rounded-xl border transition-all duration-200 ${
                  activeDemo === key
                    ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-200"
                    : "border-white/8 bg-white/3 text-gray-400 hover:border-white/20 hover:text-gray-200 hover:bg-white/6"
                }`}
              >
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{s.description}</p>
              </button>
            ))}
          </div>
        </div>

        {!displayed ? (
          /* ── Empty State ────────────────────────────────────────────── */
          <div className="glass p-12 text-center space-y-4">
            <div className="text-5xl">🔍</div>
            <h2 className="text-xl font-bold text-gray-200">No reviews yet</h2>
            <p className="text-gray-400 text-sm max-w-lg mx-auto">
              Reviews appear here automatically when the PrivGuard Nexus GitHub Action checks a pull request
              (with <code className="text-indigo-300">dashboard-url</code> and <code className="text-indigo-300">dashboard-token</code> set).
              Meanwhile, pick a demo scenario above.
            </p>
          </div>
        ) : (
          <>
            {/* ── Pull request context (live reviews) ─────────────────────── */}
            {!activeDemo && <PullRequestCard r={displayed} />}

            {/* ── Decision Banner ─────────────────────────────────────────── */}
            <div className={`glass p-6 flex items-center justify-between flex-wrap gap-4 ${DECISION_STYLE[displayed.overallDecision].cls}`}>
              <div className="flex items-center gap-4">
                <span className="text-4xl">{DECISION_STYLE[displayed.overallDecision].icon}</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest opacity-70">Merge Recommendation</p>
                  <h2 className="text-2xl font-extrabold">{displayed.overallDecision}</h2>
                </div>
              </div>
              <div className="flex gap-6 text-sm">
                <div className="text-center">
                  <p className="text-2xl font-bold">{displayed.summary.totalFiles}</p>
                  <p className="text-xs opacity-60">files</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{displayed.summary.totalFindings}</p>
                  <p className="text-xs opacity-60">findings</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{displayed.summary.criticalCount}</p>
                  <p className="text-xs opacity-60">critical</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{displayed.scores.confidence}%</p>
                  <p className="text-xs opacity-60">confidence</p>
                </div>
              </div>
            </div>

            {/* ── 5 Score Gauges ───────────────────────────────────────────── */}
            <div className="glass p-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-5">Risk Intelligence Scores</p>
              <div className="flex justify-around flex-wrap gap-6">
                <ScoreGauge label="Overall Risk"  score={displayed.scores.overall} />
                <ScoreGauge label="Privacy"       score={displayed.scores.privacy} />
                <ScoreGauge label="Security"      score={displayed.scores.security} />
                <ScoreGauge label="AI Safety"     score={displayed.scores.aiSafety} />
                <ScoreGauge label="Backdoor Risk" score={displayed.scores.backdoorRisk} />
              </div>
              {/* Severity breakdown */}
              <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap gap-3">
                {[
                  { label: "Critical", count: displayed.summary.criticalCount, cls: "badge-critical" },
                  { label: "High",     count: displayed.summary.highCount,     cls: "badge-high" },
                  { label: "Medium",   count: displayed.summary.mediumCount,   cls: "badge-medium" },
                  { label: "Low",      count: displayed.summary.lowCount,      cls: "badge-low" },
                ].map(({ label, count, cls }) => (
                  <span key={label} className={`text-xs font-semibold px-3 py-1 rounded-full ${cls}`}>
                    {count} {label}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Review pipeline (rules → AI review) ──────────────────────── */}
            {!activeDemo && <PipelineStrip r={displayed} />}

            {/* ── Privacy Diff Timeline ─────────────────────────────────────── */}
            <PrivacyDiffTimeline report={displayed} diff={displayed.privacyDiff} />

            {/* ── Findings ─────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                  Findings ({filteredFindings.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilter("all")}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filter === "all" ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-200" : "border-white/8 text-gray-400 hover:text-gray-200 hover:border-white/20"}`}
                  >
                    All {displayed.summary.totalFindings}
                  </button>
                  {(Object.entries(catCounts) as [FindingType, number][])
                    .filter(([, c]) => c > 0)
                    .map(([type, count]) => (
                      <button
                        key={type}
                        onClick={() => setFilter(type)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors cat-${type} ${filter === type ? "opacity-100" : "opacity-60 hover:opacity-80"}`}
                      >
                        {CAT_LABELS[type]} {count}
                      </button>
                    ))}
                </div>
              </div>

              {filteredFindings.length === 0 ? (
                <div className="glass p-8 text-center">
                  <p className="text-emerald-400 text-4xl mb-2">✅</p>
                  <p className="text-gray-300 font-semibold">
                    {filter === "all" ? "No findings detected" : `No ${CAT_LABELS[filter as FindingType]} issues found`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredFindings.map((f) => <IssueCard key={f.id} f={f} />)}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Scan History ─────────────────────────────────────────────── */}
        {history.length > 1 && !activeDemo && (
          <div className="glass p-5 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Review history</p>
            <div className="space-y-2">
              {history.map((r, i) => {
                const ds = DECISION_STYLE[r.overallDecision];
                return (
                  <button
                    key={i}
                    onClick={() => { setReport(r); setFilter("all"); }}
                    className={`w-full glass card-hover text-left p-3 flex items-center justify-between gap-4 ${
                      report === r ? "ring-1 ring-indigo-500/40" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{ds.icon}</span>
                      <div>
                        <p className={`text-sm font-semibold ${ds.cls.replace("decision-", "text-")}`}>
                          {r.overallDecision}
                        </p>
                        <p className="text-xs text-gray-500">
                          {reviewLabel(r)}
                          {r.pr?.title && <span className="text-gray-600"> · {r.pr.title}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
                      <span>{r.summary.totalFindings} findings</span>
                      {r.pipeline?.aiUsed && <span className="text-indigo-300">{r.pipeline.aiFound} by AI</span>}
                      <span>{new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-600">
            PrivGuard Nexus v1 · AI code review for pull requests ·{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-gray-400">source on GitHub</a>
          </p>
        </div>
      </div>
    </div>
  );
}
