# PrivGuard Sentinel

> **PrivGuard Sentinel is an intelligent, portable GitHub Action that checks every Pull Request for code quality, security, privacy, compliance, prompt injection, and hidden backdoors. It posts inline feedback and a Unified Risk Intelligence Panel directly on your PR.**

PrivGuard Sentinel bridges the gap between static analysis and agentic reasoning. Instead of logging into external dashboards, developers get inline code review comments on the exact lines that introduce risk, powered by a rule-based engine and an LLM.

---

## 🚀 Features

- **Privacy Compliance**: Detects PII logging, data leaks, and GDPR/CCPA violations.
- **Security Risk Detection**: Flags insecure HTTP, hardcoded secrets, and weak authentication.
- **Insider Threat Detection**: Scans for obfuscated payloads, reverse shells, and backdoor logic.
- **Prompt Injection Defense**: Defends against adversarial prompts in code logic.
- **Strict Mode Enforcement**: Optionally fail the GitHub PR check if a CRITICAL risk is introduced.
- **Unified Risk Panel**: A beautiful Markdown-based summary table posted as a PR comment and Action Job Summary.

---

## 🛠 Getting Started

PrivGuard Sentinel is a standalone GitHub Action. You can drop it into any repository to instantly get AI-powered security reviews on every Pull Request.

### Prerequisites

Create a repository secret containing your LLM API Key (e.g., OpenAI API Key).
- **Settings -> Secrets and variables -> Actions -> New repository secret**
- Name it `LLM_API_KEY`

### Usage

Create a new file in your repository: `.github/workflows/privguard.yml` and paste the following:

```yaml
name: PrivGuard Sentinel Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  sentinel:
    name: AI Security Review
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write # Required for inline comments
      contents: read       # Required to checkout the code

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Run PrivGuard Sentinel
        uses: varadrane7/privguard-sentinel@v1.0.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-api-url: 'https://api.openai.com'
          llm-api-key: ${{ secrets.LLM_API_KEY }}
          llm-model: 'gpt-4o-mini'
          strict-mode: 'true'
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | Yes | N/A | The GitHub token (use `${{ secrets.GITHUB_TOKEN }}`) |
| `llm-api-url` | No | `''` | Base URL of an OpenAI-compatible LLM API |
| `llm-api-key` | No | `''` | The API Key for the LLM Provider |
| `llm-model` | No | `'llama3:8b'` | Model name to use for reasoning |
| `strict-mode` | No | `'false'` | If `'true'`, fails the PR check when risks are detected |

---

## 🗂 Architecture

PrivGuard Sentinel acts strictly on **Pull Request Diffs**.
1. **Diff Parsing**: Uses the Octokit API to fetch the `.patch` of files changed in a PR.
2. **Hybrid Scanning**: Runs rapid rule-based checks locally within the action runner. If issues are found, the offending snippets are sent to the LLM for deep reasoning.
3. **Structured Outputs**: The LLM responds natively with strict JSON structure enforcing correct formatting.
4. **Feedback loop**: The action translates the JSON into GitHub PR Review Inline Comments positioned exactly at the modified lines.
