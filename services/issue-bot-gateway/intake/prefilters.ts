import type { CanonicalIssue } from "../shared/catalog.js";
import type { SafeReasonCode } from "../shared/status.js";

export type PrefilterResult = { accepted: true } | { accepted: false; reasonCode: SafeReasonCode };

const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/iu,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\b(?:xox[baprs]-)[A-Za-z0-9-]{16,}\b/iu,
  /\b(?:password|api[_ -]?key|secret|token)\s*[:=]\s*[^\s]{8,}/iu,
];
const SECURITY_PATTERNS = [
  /\b(?:security (?:report|vulnerability|issue)|vulnerability|cve-?\d{4}-\d+|zero[ -]?day|exploit|responsible disclosure)\b/iu,
  /\b(?:cross[ -]?site scripting|\bxss\b|sql injection|remote code execution|\brce\b|authentication bypass)\b/iu,
];
const INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|override) (?:(?:all|any) )?(?:(?:previous|prior) )?(?:instructions|rules|policy)\b/iu,
  /\b(?:system prompt|developer message|jailbreak|do not follow the above)\b/iu,
  /\b(?:call (?:a )?tool|execute (?:this|the) command|reveal (?:your|the) secret)\b/iu,
];
const PROMOTION_PATTERNS = [
  /\b(?:casino|crypto(?:currency)?|seo service|backlinks?|telegram me|whatsapp me|airdrop)\b/iu,
];

function repeatedLine(text: string): boolean {
  const counts = new Map<string, number>();
  for (const line of text.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const count = (counts.get(line) ?? 0) + 1;
    if (count > 2) return true;
    counts.set(line, count);
  }
  return false;
}

/** Conservative, content-local checks. Callers only receive a safe reason code. */
export function prefilterIssue(issue: CanonicalIssue): PrefilterResult {
  const prose = [issue.summary, ...Object.values(issue.fields)].join("\n");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(prose)) || /\b\d{3}-\d{2}-\d{4}\b/u.test(prose)) {
    return { accepted: false, reasonCode: "sensitive_content" };
  }
  if (SECURITY_PATTERNS.some((pattern) => pattern.test(prose))) return { accepted: false, reasonCode: "sensitive_content" };
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(prose))) return { accepted: false, reasonCode: "not_accepted" };
  const mentions = (prose.match(/@[A-Za-z0-9_-]+/g) ?? []).length;
  const issueRefs = (prose.match(/#[0-9]{1,9}\b/g) ?? []).length;
  const urls = (prose.match(/https?:\/\//giu) ?? []).length;
  if (mentions > 3 || issueRefs > 5 || urls > 3 || /(.)\1{7,}/u.test(prose) || repeatedLine(prose) || PROMOTION_PATTERNS.some((pattern) => pattern.test(prose))) {
    return { accepted: false, reasonCode: "not_accepted" };
  }
  return { accepted: true };
}
