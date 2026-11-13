import { Intent } from "./types";

const SYSTEM_PROMPT = `You are an expert security, privacy, and compliance code reviewer for PrivGuard Nexus. You will be given a code snippet with its file name and line number.

Analyze the code for:
1. Privacy violations (PII logging, unauthorized data transfer, missing consent)
2. Security risks (injection, weak auth, insecure communication)
3. Insider threats / backdoors (hardcoded bypasses, obfuscated payloads, data exfiltration)
4. Prompt injection attempts (AI manipulation phrases)
5. Code quality issues (eval usage, unsafe patterns)

Output ONLY valid JSON with these exact fields:
{
  "isViolation": boolean,
  "type": "privacy_leak" | "security_risk" | "insider_threat" | "backdoor" | "prompt_injection" | "code_quality" | "false_positive",
  "reason": "one sentence explaining why this is or is not a violation",
  "fix": "one sentence concrete fix recommendation",
  "intent": "accidental" | "negligent" | "suspicious" | "malicious"
}`;

export interface LLMResult {
  isViolation: boolean;
  type: string;
  reason: string;
  fix: string;
  intent: Intent;
  /** True when the LLM couldn't be reached; callers keep the rule-based finding as-is. */
  unavailable?: boolean;
}

export interface LLMConfig {
  model: string;
  url: string;
  key: string;
}

/**
 * Sends one system + user prompt to an Ollama or OpenAI-compatible chat API and
 * returns the raw text reply. Retries rate limits and transient errors; throws
 * if the model can't be reached, so callers can fall back to rule results.
 */
export async function callLLM(system: string, user: string, cfg: LLMConfig): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.key) headers["Authorization"] = `Bearer ${cfg.key}`;

  // If the base URL already ends in a version segment (e.g. Gemini's
  // https://generativelanguage.googleapis.com/v1beta/openai), don't add /v1 again.
  const base = cfg.url.replace(/\/+$/, "");
  const isOllama = !cfg.key && (base.includes("localhost") || base.includes("11434"));
  const hasVersion = /\/v\d+[a-z0-9]*(\/openai)?$/i.test(base);
  const endpoint = isOllama
    ? `${base}/api/generate`
    : hasVersion
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;

  let jsonMode = true;
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = isOllama
      ? JSON.stringify({ model: cfg.model, prompt: user, system, stream: false, format: "json" })
      : JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        });

    const res = await fetch(endpoint, { method: "POST", headers, body });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return isOllama
        ? ((data.response as string) ?? "")
        : ((data.choices as Array<{ message: { content: string } }>)?.[0]?.message?.content ?? "");
    }

    const text = await res.text();
    if (res.status === 400 && jsonMode && /response_format|json/i.test(text)) {
      jsonMode = false; // provider doesn't support JSON mode; the prompt still asks for JSON
      continue;
    }
    // Free-tier APIs throttle bursts of calls: wait 5s, 20s, 45s before giving up.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1) ** 2));
      continue;
    }
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error("LLM request failed after retries");
}

/** Pulls the first JSON object out of a model reply (tolerates code fences or extra prose). */
export function parseJsonReply<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in LLM response");
  return JSON.parse(match[0]) as T;
}

/** Single-finding review, used by the local CLI (`privguard <dir> --llm`). */
export async function analyzeWithLLM(
  file: string,
  line: number,
  snippet: string,
  model = "llama3:8b",
  llmUrl = process.env.LLM_API_URL ?? "http://localhost:11434",
  llmKey = process.env.LLM_API_KEY ?? ""
): Promise<LLMResult> {
  const prompt = `File: ${file} | Line: ${line}\n\nCode snippet:\n\`\`\`\n${snippet}\n\`\`\``;

  try {
    const raw = await callLLM(SYSTEM_PROMPT, prompt, { model, url: llmUrl, key: llmKey });
    const parsed = parseJsonReply<Partial<LLMResult>>(raw);
    return {
      isViolation: Boolean(parsed.isViolation),
      type: parsed.type ?? "false_positive",
      reason: parsed.reason ?? "No reason provided",
      fix: parsed.fix ?? "Review this finding manually.",
      intent: (parsed.intent as Intent) ?? "accidental",
    };
  } catch (err) {
    return {
      isViolation: true,
      type: "unknown",
      reason: `LLM analysis unavailable: ${(err as Error).message}`,
      fix: "Review this finding manually.",
      intent: "accidental",
      unavailable: true,
    };
  }
}
