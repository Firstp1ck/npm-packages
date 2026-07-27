import type { QueueMessage } from "../shared/schemas.js";
import { githubRetryAfter, type GithubTarget } from "./github-app.js";

const REQUEST_TIMEOUT_MS = 15_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,200}$/u;

export interface GithubIssue { number: number; url: string; requestId: string | null }
export type ReconciliationResult =
  | { kind: "found"; issue: GithubIssue }
  | { kind: "missing" }
  | { kind: "retry"; retryAfterSeconds: number | null }
  | { kind: "unavailable" };
export type CreateResult =
  | { kind: "created"; issue: GithubIssue }
  | { kind: "rate_limited"; requestId: string | null; retryAfterSeconds: number | null }
  | { kind: "known_failure"; requestId: string | null }
  | { kind: "ambiguous"; requestId: string | null };

function issueUrl(target: GithubTarget, number: number): string {
  // Construct from the allowlisted target rather than trusting an upstream URL.
  return `https://github.com/${target.owner}/${target.repository}/issues/${number}`;
}

function githubRequestId(response: Response): string | null {
  const value = response.headers.get("x-github-request-id");
  return value && SAFE_REQUEST_ID.test(value) ? value : null;
}

function markerInIssue(value: unknown, marker: string, appBotLogin: string): GithubIssue | null {
  if (typeof value !== "object" || value === null) return null;
  const issue = value as { number?: unknown; body?: unknown; pull_request?: unknown; user?: { login?: unknown; type?: unknown } };
  if (issue.pull_request !== undefined || !Number.isSafeInteger(issue.number) || (issue.number as number) <= 0 || typeof issue.body !== "string") return null;
  if (issue.user?.type !== "Bot" || issue.user.login !== appBotLogin || !issue.body.includes(marker)) return null;
  return { number: issue.number as number, url: "", requestId: null };
}

function boundedPageCount(value: string | undefined): number {
  const parsed = Number(value ?? "3");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 3;
}

async function githubFetch(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetcher(url, { ...init, signal: controller.signal }); } catch { return null; } finally { clearTimeout(timeout); }
}

export function issueMarker(message: QueueMessage): string {
  return `<!-- pi-webui-issue-bot:v1:${message.submission_id}:${message.payload_digest.slice(0, 16)} -->`;
}

/**
 * Checks GitHub issue bodies for the literal marker, never a fuzzy title/body match.
 * It runs before creation and again after every ambiguous mutation/redelivery.
 */
export async function reconcileIssueMarker(
  message: QueueMessage,
  target: GithubTarget,
  installationToken: string,
  fetcher: typeof fetch,
  maxPages?: string,
): Promise<ReconciliationResult> {
  const marker = issueMarker(message);
  for (let page = 1; page <= boundedPageCount(maxPages); page += 1) {
    const url = `${target.apiUrl}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/issues?state=all&per_page=100&page=${page}&sort=created&direction=desc`;
    const response = await githubFetch(fetcher, url, {
      method: "GET",
      headers: { "authorization": `Bearer ${installationToken}`, "accept": "application/vnd.github+json" },
    });
    if (!response) return { kind: "retry", retryAfterSeconds: null };
    if (response.status === 429 || response.status >= 500) return { kind: "retry", retryAfterSeconds: githubRetryAfter(response.headers) };
    if (!response.ok) return { kind: "unavailable" };
    let payload: unknown;
    try { payload = await response.json(); } catch { return { kind: "unavailable" }; }
    if (!Array.isArray(payload)) return { kind: "unavailable" };
    for (const entry of payload) {
      const found = markerInIssue(entry, marker, target.appBotLogin);
      if (found) return { kind: "found", issue: { ...found, url: issueUrl(target, found.number), requestId: githubRequestId(response) } };
    }
    // A short page cannot have a later result in the same descending listing.
    if (payload.length < 100) return { kind: "missing" };
  }
  // Bounded reconciliation cannot prove absence beyond its configured horizon. This is
  // safe for a fresh mutation attempt, but an ambiguous mutation caller must stop.
  return { kind: "missing" };
}

function labelsFromConfig(value: string | undefined): string[] | null {
  if (!value) return [];
  const labels = value.split(",").map((label) => label.trim()).filter(Boolean);
  if (labels.length > 10 || new Set(labels).size !== labels.length || labels.some((label) => label.length > 100 || /[\u0000-\u001F\u007F]/u.test(label))) return null;
  return labels;
}

/** Uses only canonical queue content, fixed labels, and the server-authored marker. */
export async function createIssue(
  message: QueueMessage,
  target: GithubTarget,
  installationToken: string,
  labelsConfig: string | undefined,
  fetcher: typeof fetch,
): Promise<CreateResult> {
  const labels = labelsFromConfig(labelsConfig);
  if (!labels) return { kind: "known_failure", requestId: null };
  const response = await githubFetch(fetcher, `${target.apiUrl}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/issues`, {
    method: "POST",
    headers: { "authorization": `Bearer ${installationToken}`, "accept": "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({
      title: message.issue.title,
      body: `${message.issue.body}\n\n${issueMarker(message)}`,
      ...(labels.length ? { labels } : {}),
    }),
  });
  if (!response) return { kind: "ambiguous", requestId: null };
  const requestId = githubRequestId(response);
  if (response.status !== 201) {
    // A completed rate-limit response is definitive non-mutation and may clear the
    // mutation barrier before a delayed retry. Other 4xx responses are terminal.
    if (response.status === 429 || (response.status === 403 && (response.headers.has("retry-after") || response.headers.has("x-ratelimit-reset")))) {
      return { kind: "rate_limited", requestId, retryAfterSeconds: githubRetryAfter(response.headers) };
    }
    if (response.status >= 400 && response.status < 500) return { kind: "known_failure", requestId };
    return { kind: "ambiguous", requestId };
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { return { kind: "ambiguous", requestId }; }
  if (typeof payload !== "object" || payload === null || !Number.isSafeInteger((payload as { number?: unknown }).number) || ((payload as { number: number }).number <= 0)) {
    return { kind: "ambiguous", requestId };
  }
  const number = (payload as { number: number }).number;
  return { kind: "created", issue: { number, url: issueUrl(target, number), requestId } };
}
