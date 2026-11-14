"use client";

import { useMemo, useState } from "react";

const REPO_URL = "https://github.com/chinmayee41203/privguard-nexus";
const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

/** Accepts "owner/repo", "github.com/owner/repo" or a full GitHub URL (with or without .git / extra path). */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "");
  const m = cleaned.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

export function buildWorkflow(branch: string, pushMode: boolean): string {
  return [
    "name: PrivGuard Nexus",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize, reopened]",
    ...(pushMode ? ["  push:", `    branches: [${branch}]`] : []),
    "",
    "jobs:",
    "  review:",
    "    name: AI Security Review",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      pull-requests: write",
    `      contents: ${pushMode ? "write" : "read"}`,
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: chinmayee41203/privguard-nexus@v1",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          llm-api-url: 'https://generativelanguage.googleapis.com/v1beta/openai'",
    "          llm-api-key: ${{ secrets.LLM_API_KEY }}",
    "          llm-model: 'gemini-2.5-flash'",
    "          min-severity: 'MEDIUM'",
    "          strict-mode: 'true'",
    "",
  ].join("\n");
}

/** GitHub's "create new file" page, pre-filled with the workflow. */
export function newFileUrl(owner: string, repo: string, branch: string, content: string): string {
  const params = new URLSearchParams({ filename: ".github/workflows/privguard.yml", value: content });
  return `https://github.com/${owner}/${repo}/new/${encodeURIComponent(branch).replace(/%2F/g, "/")}?${params.toString()}`;
}

export function InstallPanel({ onClose }: { onClose?: () => void }) {
  const [repoInput, setRepoInput] = useState("");
  const [branch, setBranch] = useState("main");
  const [pushMode, setPushMode] = useState(true);
  const [copied, setCopied] = useState<"idle" | "copied" | "select">("idle");

  const parsed = parseRepo(repoInput);
  const branchOk = BRANCH_RE.test(branch.trim());
  const ready = Boolean(parsed && branchOk);
  const workflow = useMemo(() => buildWorkflow(branch.trim() || "main", pushMode), [branch, pushMode]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workflow);
      setCopied("copied");
    } catch {
      setCopied("select");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  const step = "flex gap-3";
  const num = "flex size-6 shrink-0 items-center justify-center rounded-full border border-indigo-500/40 bg-indigo-500/15 text-xs font-semibold text-indigo-300";
  const btn = (enabled: boolean) =>
    `inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
      enabled
        ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30"
        : "border-white/8 text-gray-600 cursor-not-allowed pointer-events-none"
    }`;

  return (
    <section id="install" aria-labelledby="install-title" className="glass p-5 space-y-5 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="install-title" className="text-sm font-bold text-gray-100 uppercase tracking-widest">
            Add PrivGuard to your repo
          </h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            About 2 minutes. After this, every pull request{pushMode ? " and every push" : ""} in your repo gets reviewed
            automatically, with comments on the exact lines.
          </p>
        </div>
        {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20"
          aria-label="Close setup panel"
        >
          ✕
        </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="space-y-1">
          <span className="text-xs text-gray-400">Your repository</span>
          <input
            id="install-repo"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="owner/repo or https://github.com/owner/repo"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 font-mono focus:outline-none focus:border-indigo-500/60"
          />
          {repoInput && !parsed && (
            <span className="text-xs text-amber-300/80">Use the form owner/repo, e.g. octocat/hello-world</span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-400">Main branch</span>
          <input
            id="install-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:border-indigo-500/60"
          />
          {!branchOk && <span className="text-xs text-amber-300/80">Enter a branch name</span>}
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-300 w-fit cursor-pointer">
        <input
          id="install-push"
          type="checkbox"
          checked={pushMode}
          onChange={(e) => setPushMode(e.target.checked)}
          className="accent-indigo-500"
        />
        Also review direct pushes to {branch.trim() || "main"} (push mode)
      </label>

      <ol className="space-y-4">
        <li className={step}>
          <span className={num}>1</span>
          <div className="space-y-2 min-w-0">
            <p className="text-sm text-gray-200">Get a free Gemini API key</p>
            <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer" className={btn(true)}>
              Open Google AI Studio ↗
            </a>
          </div>
        </li>
        <li className={step}>
          <span className={num}>2</span>
          <div className="space-y-2 min-w-0">
            <p className="text-sm text-gray-200">
              Save it in your repo as a secret named <code className="text-indigo-300">LLM_API_KEY</code>
            </p>
            <a
              href={parsed ? `https://github.com/${parsed.owner}/${parsed.repo}/settings/secrets/actions/new` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!parsed}
              className={btn(Boolean(parsed))}
            >
              Add the secret on GitHub ↗
            </a>
          </div>
        </li>
        <li className={step}>
          <span className={num}>3</span>
          <div className="space-y-2 min-w-0 w-full">
            <p className="text-sm text-gray-200">
              Add the workflow file. GitHub opens with it filled in: just click <b>Commit changes</b>.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={ready ? newFileUrl(parsed!.owner, parsed!.repo, branch.trim(), workflow) : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!ready}
                className={btn(ready)}
              >
                Add workflow on GitHub ↗
              </a>
              <button
                type="button"
                onClick={copy}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20"
              >
                {copied === "copied" ? "Copied" : copied === "select" ? "Select the text below to copy" : "Copy workflow"}
              </button>
            </div>
            <details className="group">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 w-fit">
                Show .github/workflows/privguard.yml
              </summary>
              <pre className="snippet mt-2 max-h-72 overflow-auto text-xs">{workflow}</pre>
            </details>
          </div>
        </li>
        <li className={step}>
          <span className={num}>4</span>
          <div className="space-y-1 min-w-0">
            <p className="text-sm text-gray-200">Open a pull request{pushMode ? " or push a commit" : ""}</p>
            <p className="text-xs text-gray-500">
              PrivGuard reviews it within a minute or two. Results appear on your pull request{pushMode ? " or commit" : ""}.
            </p>
          </div>
        </li>
      </ol>

      <p className="text-xs text-gray-500 border-t border-white/5 pt-3">
        Uses the published action <code className="text-gray-400">chinmayee41203/privguard-nexus@v1</code>. More options
        (other AI providers, ignored paths, your own dashboard) are in the{" "}
        <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
          README
        </a>
        .
      </p>
    </section>
  );
}
