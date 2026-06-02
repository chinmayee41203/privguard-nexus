import { Finding, FindingType, Severity } from "./types";
import * as crypto from "crypto";

interface Rule {
  id: string;
  name: string;
  type: FindingType;
  severity: Severity;
  pattern: RegExp;
  recommendation: string;
  whyItMatters: string;
}

const RULES: Rule[] = [
  // ── PRIVACY ──────────────────────────────────────────────────────────────
  {
    id: "P001",
    name: "Sensitive Data Logged - Password",
    type: "privacy",
    severity: "CRITICAL",
    pattern: /(?:console\.log|logger\.(info|debug|warn|error)|log\.Printf?|print)\s*\(.*(?:password|passwd|pwd|secret)\b/i,
    recommendation: "Never log passwords or secrets. Remove this log statement entirely.",
    whyItMatters: "Logged passwords end up in log files accessible to ops teams and log aggregators, creating major credential exposure risk violating GDPR/CCPA.",
  },
  {
    id: "P002",
    name: "Sensitive Data Logged - Email/PII",
    type: "privacy",
    severity: "HIGH",
    pattern: /(?:console\.log|logger\.(info|debug|warn|error)|log\.Printf?|print)\s*\(.*(?:email|ssn|social.?security|credit.?card|phone)/i,
    recommendation: "Avoid logging PII. Use masked or anonymized identifiers for debugging.",
    whyItMatters: "Logging PII exposes user data to anyone with log access and creates GDPR audit trail violations.",
  },
  {
    id: "P003",
    name: "Sensitive Data Logged - SSN",
    type: "privacy",
    severity: "CRITICAL",
    pattern: /(?:console\.log|logger\.(info|debug|warn|error)|log\.Printf?|print)\s*\(.*(?:ssn|getSsn|social_security)/i,
    recommendation: "Never log SSN or national ID numbers. This violates GDPR and CCPA.",
    whyItMatters: "SSNs are the highest-value PII for identity theft. Exposure violates multiple national regulations.",
  },
  {
    id: "P004",
    name: "Unauthorized Third-Party Data Transfer",
    type: "privacy",
    severity: "CRITICAL",
    pattern: /(?:fetch|axios\.post|axios\.get|requests\.post|http\.Post|HttpRequest)\s*\(?\s*['"`]https?:\/\/(?!(?:localhost|127\.0\.0\.1|your-api|internal))[^'"`\s]+['"`]/i,
    recommendation: "Audit all outbound HTTP calls. Ensure external endpoints are approved and PII is not transmitted without consent.",
    whyItMatters: "Sending user data to unapproved third parties is a direct GDPR violation and potential data breach.",
  },
  {
    id: "P005",
    name: "Missing Consent Verification",
    type: "privacy",
    severity: "MEDIUM",
    pattern: /marketing_opt_in\s*[=:]\s*(?:true|1|yes)\b(?![\s\S]{0,200}consent)/i,
    recommendation: "Before setting marketing_opt_in, verify explicit user consent was collected via UI.",
    whyItMatters: "Setting marketing preferences without verified consent violates GDPR Article 7 and CCPA opt-in requirements.",
  },
  {
    id: "P006",
    name: "Credit Card Data Handling",
    type: "privacy",
    severity: "HIGH",
    pattern: /credit.?card|cc_number|card_number|cvv|cvc\b/i,
    recommendation: "Credit card data should only flow through PCI-DSS compliant processors. Do not store or log card data.",
    whyItMatters: "Handling raw card data outside PCI-DSS scope creates massive financial and legal liability.",
  },
  {
    id: "P007",
    name: "Location / IP Data Collection",
    type: "privacy",
    severity: "MEDIUM",
    pattern: /(?:req\.|request\.)(?:ip\b|connection\.remoteAddress)|user\.(?:gps|location|coordinates|lat\b|lng\b|latitude|longitude)/i,
    recommendation: "Location and IP data are PII under GDPR. Ensure collection is disclosed and minimized.",
    whyItMatters: "Location data is sensitive PII under GDPR and CCPA. Undisclosed collection is a compliance violation.",
  },
  {
    id: "P008",
    name: "Analytics Tracking Without Disclosure",
    type: "privacy",
    severity: "MEDIUM",
    pattern: /(?:gtag\s*\(|fbq\s*\(|mixpanel\.track|amplitude\.track|segment\.track|analytics\.identify)\s*\(/i,
    recommendation: "Ensure analytics tracking is disclosed in privacy policy and covered by a consent mechanism.",
    whyItMatters: "Undisclosed behavioral tracking violates GDPR ePrivacy requirements and can result in regulatory fines.",
  },

  // ── SECURITY ─────────────────────────────────────────────────────────────
  {
    id: "S001",
    name: "Insecure HTTP Endpoint",
    type: "security",
    severity: "HIGH",
    pattern: /(?:fetch|axios\.(?:get|post|put)|requests\.(?:get|post)|http\.(?:get|post))\s*\(?\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1)[^'"`\s]+['"`]/i,
    recommendation: "Replace http:// with https:// for all external communications to prevent MITM attacks.",
    whyItMatters: "Unencrypted HTTP exposes data in transit to network interception attacks.",
  },
  {
    id: "S002",
    name: "SQL Injection via String Concatenation",
    type: "security",
    severity: "CRITICAL",
    pattern: /(?:query|sql|execute|SELECT|INSERT|UPDATE|DELETE).*[+].*(?:req\.|request\.|params\.|query\.|body\.|input|user)/i,
    recommendation: "Use parameterized queries or an ORM instead of string concatenation for database queries.",
    whyItMatters: "SQL injection is the #1 web vulnerability, allowing full database compromise and data exfiltration.",
  },
  {
    id: "S003",
    name: "Weak Authentication Pattern",
    type: "security",
    severity: "HIGH",
    pattern: /(?:password|passwd)\s*===?\s*(?:req\.|body\.|params\.)?(?:password|passwd)|\.md5\(|MD5\s*\(|new\s+MD5/i,
    recommendation: "Use bcrypt, argon2, or scrypt for password hashing. Never compare plain-text passwords.",
    whyItMatters: "Weak auth allows credential stuffing and brute-force attacks that compromise user accounts.",
  },
  {
    id: "S004",
    name: "CORS Wildcard Misconfiguration",
    type: "security",
    severity: "HIGH",
    pattern: /Access-Control-Allow-Origin[^=\n]*=\s*['"`]\*['"`]/i,
    recommendation: "Restrict CORS to specific trusted origins instead of using a wildcard.",
    whyItMatters: "Wildcard CORS allows any website to make authenticated requests to your API on behalf of users.",
  },
  {
    id: "S005",
    name: "Unsafe Deserialization",
    type: "security",
    severity: "HIGH",
    pattern: /pickle\.loads\s*\(|yaml\.load\s*\([^)]*[^a-zA-Z](?!safe_load)|unserialize\s*\(|marshal\.loads\s*\(/i,
    recommendation: "Use safe deserialization methods (yaml.safe_load). Avoid pickle from untrusted sources.",
    whyItMatters: "Deserializing untrusted data can execute arbitrary code on the server.",
  },
  {
    id: "S006",
    name: "Stack Trace Exposed to Client",
    type: "security",
    severity: "MEDIUM",
    pattern: /(?:res\.(?:send|json)|response\.json)\s*\([^)]*(?:err\.stack|error\.stack|e\.stack)/i,
    recommendation: "Never expose stack traces to clients. Log server-side and return a generic error message.",
    whyItMatters: "Stack traces reveal internal architecture and file paths useful to attackers.",
  },
  {
    id: "S007",
    name: "Prototype Pollution Risk",
    type: "security",
    severity: "HIGH",
    pattern: /__proto__\s*[=[]|constructor\s*\[\s*['"`]prototype['"`]\s*\]/i,
    recommendation: "Never allow user input to modify __proto__. Use Object.create(null) for dict-style objects.",
    whyItMatters: "Prototype pollution can override built-in object properties leading to RCE or privilege escalation.",
  },

  // ── CODE QUALITY ──────────────────────────────────────────────────────────
  {
    id: "Q001",
    name: "Dangerous eval() Usage",
    type: "quality",
    severity: "CRITICAL",
    pattern: /\beval\s*\(/i,
    recommendation: "Replace eval() with JSON.parse for data or dynamic imports for modules.",
    whyItMatters: "eval() executes arbitrary strings as code, creating XSS and code injection vulnerabilities.",
  },
  {
    id: "Q002",
    name: "Empty Catch Block",
    type: "quality",
    severity: "MEDIUM",
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    recommendation: "Handle errors explicitly. Never silently swallow exceptions.",
    whyItMatters: "Silent error swallowing hides bugs and can mask active security incidents.",
  },
  {
    id: "Q003",
    name: "TODO/FIXME/HACK in Code",
    type: "quality",
    severity: "LOW",
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG)\b/i,
    recommendation: "Track technical debt in your issue tracker. Remove before merging to main.",
    whyItMatters: "TODOs indicate incomplete implementations that may have security or reliability implications.",
  },
  {
    id: "Q004",
    name: "Synchronous File I/O in Server Code",
    type: "quality",
    severity: "MEDIUM",
    pattern: /\bfs\.(?:readFileSync|writeFileSync|appendFileSync)\s*\(/i,
    recommendation: "Use async fs.promises API to avoid blocking the event loop.",
    whyItMatters: "Synchronous I/O blocks the Node.js event loop, causing denial of service under concurrent load.",
  },

  // ── AI SAFETY / PROMPT INJECTION ─────────────────────────────────────────
  {
    id: "PI001",
    name: "Prompt Injection - Override Instructions",
    type: "ai_safety",
    severity: "CRITICAL",
    pattern: /ignore\s+(?:previous|all|the\s+above)\s+instructions?|disregard\s+(?:system\s+prompt|previous|all)/i,
    recommendation: "Sanitize all user-controlled input before passing to LLM. Require human review.",
    whyItMatters: "Prompt injection overrides AI system behavior, potentially leaking secrets or bypassing AI safety guardrails.",
  },
  {
    id: "PI002",
    name: "Prompt Injection - Approval Manipulation",
    type: "ai_safety",
    severity: "CRITICAL",
    pattern: /(?:approve\s+this\s+(?:pr|pull.?request|merge)|do\s+not\s+report|bypass\s+(?:policy|review|check|scan))/i,
    recommendation: "Block auto-merge. Require mandatory human review when AI approval manipulation is detected.",
    whyItMatters: "AI code review can be manipulated into approving malicious PRs via crafted comments.",
  },
  {
    id: "PI003",
    name: "Prompt Injection - Secret Extraction Attempt",
    type: "ai_safety",
    severity: "CRITICAL",
    pattern: /(?:reveal\s+(?:hidden\s+prompt|system\s+prompt|secrets?|api.?keys?)|send\s+all\s+secrets?|print\s+(?:all\s+)?env(?:ironment)?\s+vars?)/i,
    recommendation: "Flag for immediate security review. Do not pass this content to any LLM unsanitized.",
    whyItMatters: "Prompt injection attempting to extract secrets is an active attack vector against AI-assisted pipelines.",
  },
  {
    id: "PI004",
    name: "Prompt Injection - Role Switching",
    type: "ai_safety",
    severity: "HIGH",
    pattern: /(?:you\s+are\s+now\s+(?:a\s+)?|act\s+as\s+(?:a\s+)?(?:admin|root|superuser|developer|jailbreak))/i,
    recommendation: "Treat this content as adversarial. Do not process through LLM pipelines without strict sandboxing.",
    whyItMatters: "Role-switching injection attempts to alter LLM identity and bypass content policies.",
  },
  {
    id: "PI005",
    name: "Prompt Injection Payload in String Literal",
    type: "ai_safety",
    severity: "HIGH",
    pattern: /['"`][\s\S]{0,80}(?:jailbreak|DAN\s+mode|developer\s+mode\s+enabled|ignore\s+all\s+instructions)[\s\S]{0,80}['"`]/i,
    recommendation: "Audit string literals containing AI manipulation phrases. Sanitize before any LLM usage.",
    whyItMatters: "Embedding injection payloads in string literals can target AI systems that process code or comments.",
  },
  {
    id: "PI006",
    name: "User Input Directly in LLM Prompt",
    type: "ai_safety",
    severity: "HIGH",
    pattern: /(?:prompt|systemPrompt|userPrompt|messages)\s*[=:+]\s*[`'"][^'"`]*\$\{[^}]*(?:req\.|body\.|user\.|input|query)/i,
    recommendation: "Never directly interpolate user input into LLM prompts. Use structured message arrays with sanitization.",
    whyItMatters: "Direct user input in prompts is the primary vector for prompt injection attacks.",
  },

  // ── BACKDOOR / INSIDER THREAT ─────────────────────────────────────────────
  {
    id: "B001",
    name: "Hardcoded Admin Bypass",
    type: "backdoor",
    severity: "CRITICAL",
    pattern: /(?:(?:x-bypass|x-admin[-_]?key|bypass[-_]?token|X-Bypass[-_]?Token?)[^=\n\r]{0,40}(?:===?|==)\s*['"`][^'"`\s]{3,}['"`]|\bbypass\s*(?:==|===)\s*['"`][^'"`\s]{3,}['"`])/i,
    recommendation: "Remove all hardcoded bypass tokens. Enforce RBAC and proper role-based access control.",
    whyItMatters: "Hardcoded bypasses create a backdoor persisting across all deployments, granting unlimited privileged access.",
  },
  {
    id: "B002",
    name: "Hardcoded Secret/Credential",
    type: "backdoor",
    severity: "CRITICAL",
    pattern: /(?:(?:password|secret|api_key|apikey|token|key)\s*[=:]\s*['"`][A-Za-z0-9_\-]{6,}['"`])|(?:['"`][A-Za-z0-9_]{4,}_[A-Za-z0-9_\-]{4,}['"`]\.equals\s*\([^)]{1,30}\))/i,
    recommendation: "Move secrets to environment variables or a secrets manager. Never hardcode credentials.",
    whyItMatters: "Hardcoded secrets are exposed to everyone with repo access and persist in git history forever.",
  },
  {
    id: "B003",
    name: "Remote Code Execution via exec/system",
    type: "backdoor",
    severity: "CRITICAL",
    pattern: /\b(?:exec\s*\(|os\.system\s*\(|exec\.Command\s*\(|subprocess\.(run|call|Popen)\s*\()/i,
    recommendation: "Avoid exec/system with any user-controlled input. Use strict allowlists or remove entirely.",
    whyItMatters: "Executing system commands with user input allows complete server compromise.",
  },
  {
    id: "B004",
    name: "Shell Command Injection Risk",
    type: "backdoor",
    severity: "HIGH",
    pattern: /exec\.Command\s*\([^)]*(?:req\.|request\.|r\.|query|param|input|cmd|run)\b/i,
    recommendation: "Never pass user-supplied input to shell commands. Validate and allowlist all inputs.",
    whyItMatters: "User-controlled shell commands allow attackers to execute arbitrary code on the server.",
  },
  {
    id: "B005",
    name: "Obfuscated Base64 Payload",
    type: "backdoor",
    severity: "HIGH",
    pattern: /(?:base64\.StdEncoding\.DecodeString|Buffer\.from|atob|base64_decode)\s*\(\s*['"`][A-Za-z0-9+/]{20,}={0,2}['"`]/i,
    recommendation: "Investigate base64-encoded strings. Decode and verify they do not contain hidden commands.",
    whyItMatters: "Obfuscated payloads are a classic insider threat technique to hide malicious commands from reviewers.",
  },
  {
    id: "B006",
    name: "Data Exfiltration to Suspicious Domain",
    type: "backdoor",
    severity: "CRITICAL",
    pattern: /https?:\/\/(?:sketchy|evil|exfil|malware|backdoor|c2|command|phish|dark|shadow)[a-z0-9.\-]*/i,
    recommendation: "Suspicious domain detected. Block merge immediately and initiate security incident review.",
    whyItMatters: "Exfiltration to suspicious domains indicates an active insider threat or supply chain compromise.",
  },
  {
    id: "B007",
    name: "Hardcoded Privileged Email (Backdoor Account)",
    type: "backdoor",
    severity: "CRITICAL",
    pattern: /(?:user\.email|email|username)\s*===?\s*['"`][a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}['"`]/i,
    recommendation: "Remove hardcoded email checks. Use role-based permissions from your auth system.",
    whyItMatters: "Hardcoded email checks create hidden privileged accounts outside the normal authentication system.",
  },
  {
    id: "B008",
    name: "Debug/Test Bypass Left in Production",
    type: "backdoor",
    severity: "HIGH",
    pattern: /(?:debugMode|isDebug|TEST_MODE|BYPASS_AUTH|SKIP_AUTH)\s*[=:]\s*(?:true|1|'true')/i,
    recommendation: "Remove all debug flags and test access bypasses before merging to production branches.",
    whyItMatters: "Debug flags in production can disable authentication/authorization entirely.",
  },
];

function extractSnippet(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 10);
  const end = Math.min(lines.length - 1, lineIndex + 10);
  return lines.slice(start, end + 1).join("\n").trim().slice(0, 1500);
}

/**
 * Scans a single line of content (from a diff's added lines) against all rules.
 * snippet should be the pre-built hunk context around this line.
 */
export function scanLineContent(
  filePath: string,
  lineNo: number,
  lineContent: string,
  snippet: string
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(lineContent)) {
      rule.pattern.lastIndex = 0;
      findings.push({
        id: crypto.randomUUID(),
        type: rule.type,
        severity: rule.severity,
        file: filePath,
        line: lineNo,
        snippet,
        ruleId: rule.id,
        ruleTriggered: rule.name,
        recommendation: rule.recommendation,
        whyItMatters: rule.whyItMatters,
      });
    }
  }
  return findings;
}

export function scanFileContent(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        findings.push({
          id: crypto.randomUUID(),
          type: rule.type,
          severity: rule.severity,
          file: filePath,
          line: i + 1,
          snippet: extractSnippet(lines, i),
          ruleId: rule.id,
          ruleTriggered: rule.name,
          recommendation: rule.recommendation,
          whyItMatters: rule.whyItMatters,
        });
        rule.pattern.lastIndex = 0;
      }
    }
  }

  return findings;
}
