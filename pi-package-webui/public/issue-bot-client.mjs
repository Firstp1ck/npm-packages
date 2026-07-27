const DEFAULT_POLL_AFTER_MS = 2_500;
const MIN_POLL_AFTER_MS = 500;
const MAX_POLL_AFTER_MS = 10_000;
const DEFAULT_MAX_POLL_DURATION_MS = 120_000;
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_ID = "piWebuiIssueBotTurnstile";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{22}$/u;
const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export const ISSUE_BOT_PUBLIC_STATUSES = Object.freeze(["queued", "checking", "created", "rejected", "review", "unavailable", "unknown"]);
export const ISSUE_BOT_SAFE_REASON_CODES = Object.freeze([
  "invalid_submission", "sensitive_content", "rate_limited", "not_accepted", "manual_review", "admission_disabled", "unavailable", "unknown",
]);

/** This public configuration intentionally contains no credential and is disabled by default. */
export const ISSUE_BOT_DEFAULT_RUNTIME_CONFIG = Object.freeze({
  enabled: false,
  gatewayBaseUrl: "",
  turnstileSiteKey: "",
  privateSecurityReportUrl: "",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeHttpsUrl(value, { allowPath = true } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (!allowPath && url.pathname !== "/") return "";
    return url.href.replace(/\/$/u, "");
  } catch {
    return "";
  }
}

/**
 * Read only an explicit, pre-app-load public configuration object. Query strings,
 * storage, and server credentials are deliberately not configuration channels.
 */
export function readIssueBotRuntimeConfig(value = globalThis.__PI_WEBUI_ISSUE_BOT_CONFIG__) {
  const source = isPlainObject(value) ? value : ISSUE_BOT_DEFAULT_RUNTIME_CONFIG;
  const gatewayBaseUrl = safeHttpsUrl(source.gatewayBaseUrl);
  const privateSecurityReportUrl = safeHttpsUrl(source.privateSecurityReportUrl);
  const turnstileSiteKey = typeof source.turnstileSiteKey === "string" && /^[A-Za-z0-9_-]{1,2048}$/u.test(source.turnstileSiteKey)
    ? source.turnstileSiteKey
    : "";
  const enabled = source.enabled === true && !!gatewayBaseUrl && !!turnstileSiteKey;
  return Object.freeze({ enabled, gatewayBaseUrl, turnstileSiteKey, privateSecurityReportUrl });
}

function abortError() {
  return new DOMException("Issue bot request aborted.", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function waitForDelay(delayMs, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function safeIssue(issue) {
  if (!isPlainObject(issue) || !isPlainObject(issue.fields)) return null;
  const identifiers = ["categoryId", "componentId", "templateId"];
  const output = {};
  for (const key of identifiers) {
    if (typeof issue[key] !== "string" || !issue[key] || issue[key].length > 128) return null;
    output[key] = issue[key];
  }
  if (typeof issue.summary !== "string" || !issue.summary || issue.summary.length > 160) return null;
  const fields = {};
  for (const [key, value] of Object.entries(issue.fields)) {
    if (!key || key.length > 128 || typeof value !== "string" || !value || value.length > 4_000) return null;
    fields[key] = value;
  }
  return { ...output, summary: issue.summary, fields };
}

function safePollAfterMs(value) {
  return Number.isInteger(value) && value >= MIN_POLL_AFTER_MS && value <= 60_000 ? value : null;
}

function safeSubmissionId(value) {
  return typeof value === "string" && SUBMISSION_ID.test(value) ? value : "";
}

function safeReasonCode(value) {
  return typeof value === "string" && ISSUE_BOT_SAFE_REASON_CODES.includes(value) ? value : "";
}

function safeGithubIssue(value, number) {
  if (!Number.isSafeInteger(number) || number < 1) return "";
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) return "";
    const match = url.pathname.match(/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/([1-9]\d*)$/u);
    if (!match || Number(match[1]) !== number) return "";
    return url.href;
  } catch {
    return "";
  }
}

function parseStatusEnvelope(value, { admission = false } = {}) {
  const extra = admission ? ["statusToken"] : [];
  const inFlightKeys = ["ok", "status", "submissionId", "pollAfterMs", ...extra];
  const createdKeys = ["ok", "status", "submissionId", "issueUrl", "issueNumber", ...extra];
  const terminalKeys = ["ok", "status", "submissionId", "reasonCode", ...extra];
  if (!isPlainObject(value) || value.ok !== true || !safeSubmissionId(value.submissionId)) return null;
  if (admission && (typeof value.statusToken !== "string" || !STATUS_TOKEN.test(value.statusToken))) return null;
  if (value.status === "queued" || value.status === "checking") {
    const pollAfterMs = safePollAfterMs(value.pollAfterMs);
    if (!exactObject(value, inFlightKeys) || pollAfterMs === null) return null;
    return Object.freeze({ ok: true, status: value.status, submissionId: value.submissionId, pollAfterMs });
  }
  if (value.status === "created") {
    const issueUrl = safeGithubIssue(value.issueUrl, value.issueNumber);
    if (!exactObject(value, createdKeys) || !issueUrl) return null;
    return Object.freeze({ ok: true, status: "created", submissionId: value.submissionId, issueUrl, issueNumber: value.issueNumber });
  }
  if (["rejected", "review", "unavailable", "unknown"].includes(value.status)) {
    const reasonCode = safeReasonCode(value.reasonCode);
    if (!exactObject(value, terminalKeys) || !reasonCode) return null;
    return Object.freeze({ ok: true, status: value.status, submissionId: value.submissionId, reasonCode });
  }
  return null;
}

function unavailableResult() {
  return Object.freeze({ ok: false, status: "unavailable", reasonCode: "unavailable" });
}

function isInFlight(result) {
  return result?.status === "queued" || result?.status === "checking";
}

function endpoint(baseUrl, path) {
  return `${baseUrl}${path}`;
}

async function parseJsonResponse(response) {
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

let turnstileApiPromise = null;

function loadTurnstileApi(documentRef) {
  if (globalThis.turnstile?.render) return Promise.resolve(globalThis.turnstile);
  if (turnstileApiPromise) return turnstileApiPromise;
  turnstileApiPromise = new Promise((resolve, reject) => {
    const existing = documentRef.getElementById(TURNSTILE_SCRIPT_ID);
    const script = existing || documentRef.createElement("script");
    const finish = () => globalThis.turnstile?.render ? resolve(globalThis.turnstile) : reject(new Error("Turnstile did not initialize."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), { once: true });
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      documentRef.head.append(script);
    }
  }).catch((error) => {
    turnstileApiPromise = null;
    throw error;
  });
  return turnstileApiPromise;
}

/** Acquire one non-persisted Turnstile token for the current dialog submission. */
export async function getIssueBotTurnstileToken({ siteKey, idempotencyKey, container, signal, documentRef = globalThis.document } = {}) {
  throwIfAborted(signal);
  if (!documentRef || !container || typeof siteKey !== "string" || !siteKey || typeof idempotencyKey !== "string" || !UUID_V4.test(idempotencyKey)) {
    throw new Error("Turnstile is unavailable.");
  }
  const api = await loadTurnstileApi(documentRef);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let widgetId;
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      if (widgetId !== undefined) {
        try { api.remove?.(widgetId); } catch { /* Turnstile cleanup is best effort. */ }
      }
      container.replaceChildren();
    };
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = finish(() => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        action: "issue_bot_submit",
        cData: idempotencyKey,
        size: "invisible",
        callback: finish((token) => typeof token === "string" && token ? resolve(token) : reject(new Error("Turnstile returned no token."))),
        "error-callback": finish(() => reject(new Error("Turnstile verification failed."))),
        "expired-callback": finish(() => reject(new Error("Turnstile token expired."))),
        "timeout-callback": finish(() => reject(new Error("Turnstile timed out."))),
      });
      api.execute?.(widgetId);
    } catch (error) {
      finish(() => reject(error))();
    }
  });
}

/**
 * Dependency-injected browser adapter. It owns network protocol validation and never
 * persists the status capability; callers retain only an opaque in-memory refresh handle.
 */
export function createIssueBotClient({
  config = readIssueBotRuntimeConfig(),
  fetchImpl = globalThis.fetch?.bind(globalThis),
  getTurnstileToken = getIssueBotTurnstileToken,
  uuidFactory = () => globalThis.crypto?.randomUUID?.(),
  now = () => Date.now(),
  sleep = waitForDelay,
  maxPollDurationMs = DEFAULT_MAX_POLL_DURATION_MS,
  turnstileContainer = null,
} = {}) {
  const runtimeConfig = readIssueBotRuntimeConfig(config);
  const available = runtimeConfig.enabled && typeof fetchImpl === "function" && typeof getTurnstileToken === "function" && typeof uuidFactory === "function";

  async function requestAdmission(issue, signal) {
    const idempotencyKey = uuidFactory();
    if (typeof idempotencyKey !== "string" || !UUID_V4.test(idempotencyKey)) return null;
    const turnstileToken = await getTurnstileToken({ siteKey: runtimeConfig.turnstileSiteKey, idempotencyKey, container: turnstileContainer, signal });
    throwIfAborted(signal);
    if (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2_048) return null;
    const response = await fetchImpl(endpoint(runtimeConfig.gatewayBaseUrl, "/v1/submissions"), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, idempotencyKey, turnstileToken, issue }),
    });
    const body = await parseJsonResponse(response);
    const envelope = parseStatusEnvelope(body, { admission: true });
    if (!envelope || typeof body?.statusToken !== "string" || !STATUS_TOKEN.test(body.statusToken)) return null;
    return { envelope, statusToken: body.statusToken };
  }

  async function requestStatus(submissionId, statusToken, signal) {
    const response = await fetchImpl(endpoint(runtimeConfig.gatewayBaseUrl, `/v1/submissions/${submissionId}`), {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal,
      headers: { authorization: `Bearer ${statusToken}` },
    });
    return parseStatusEnvelope(await parseJsonResponse(response));
  }

  function createRefreshHandle(admission, statusToken) {
    let latest = admission;
    const poll = async ({ signal, onStatus } = {}) => {
      if (!isInFlight(latest)) return latest;
      const startedAt = now();
      let delayMs = latest.pollAfterMs;
      onStatus?.(latest);
      while (isInFlight(latest)) {
        throwIfAborted(signal);
        const elapsed = now() - startedAt;
        if (!Number.isFinite(elapsed) || elapsed >= maxPollDurationMs) return Object.freeze({ ...latest, timedOut: true });
        await sleep(Math.min(delayMs, Math.max(0, maxPollDurationMs - elapsed)), signal);
        throwIfAborted(signal);
        let next;
        try { next = await requestStatus(latest.submissionId, statusToken, signal); } catch (error) {
          if (error?.name === "AbortError") throw error;
          latest = unavailableResult();
          onStatus?.(latest);
          return latest;
        }
        if (!next || next.submissionId !== latest.submissionId) {
          latest = unavailableResult();
          onStatus?.(latest);
          return latest;
        }
        latest = next;
        onStatus?.(latest);
        delayMs = Math.min(MAX_POLL_AFTER_MS, Math.max(delayMs * 2, latest.pollAfterMs || DEFAULT_POLL_AFTER_MS));
      }
      return latest;
    };
    return Object.freeze({ refresh: poll });
  }

  return Object.freeze({
    available,
    runtimeConfig,
    async submit({ issue, signal, onStatus } = {}) {
      if (!available) return Object.freeze({ result: unavailableResult(), handle: null });
      const structuredIssue = safeIssue(issue);
      if (!structuredIssue) return Object.freeze({ result: unavailableResult(), handle: null });
      let admission;
      try { admission = await requestAdmission(structuredIssue, signal); } catch (error) {
        if (error?.name === "AbortError") throw error;
        return Object.freeze({ result: unavailableResult(), handle: null });
      }
      if (!admission) return Object.freeze({ result: unavailableResult(), handle: null });
      const { envelope, statusToken } = admission;
      onStatus?.(envelope);
      if (!isInFlight(envelope)) return Object.freeze({ result: envelope, handle: null });
      const handle = createRefreshHandle(envelope, statusToken);
      const result = await handle.refresh({ signal, onStatus });
      return Object.freeze({ result, handle });
    },
  });
}
