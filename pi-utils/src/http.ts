export type FetchJsonResult<T = unknown> = {
  ok: boolean;
  status: number;
  body?: T;
  error?: unknown;
};

export type FetchJsonWithTimeoutOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  headers?: HeadersInit;
};

export function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(Math.max(0, timeoutMs));
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function mergeHeaders(defaultHeaders: HeadersInit | undefined, requestHeaders: HeadersInit | undefined): HeadersInit | undefined {
  if (!defaultHeaders && !requestHeaders) return undefined;
  const headers = new Headers(defaultHeaders);
  if (requestHeaders) new Headers(requestHeaders).forEach((value, key) => headers.set(key, value));
  return headers;
}

function mergeSignals(timeoutMs: number, requestSignal?: AbortSignal | null, optionSignal?: AbortSignal): AbortSignal {
  const signals = [requestSignal, optionSignal].filter((signal): signal is AbortSignal => !!signal);
  return combinedSignal(timeoutMs, signals.length > 0 ? AbortSignal.any(signals) : undefined);
}

export async function fetchJsonWithTimeout<T = unknown>(
  url: string | URL,
  init: RequestInit = {},
  options: FetchJsonWithTimeoutOptions = {},
): Promise<FetchJsonResult<T>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const timeoutMs = options.timeoutMs ?? 1500;
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: mergeHeaders(options.headers, init.headers),
      signal: mergeSignals(timeoutMs, init.signal, options.signal),
    });
    const body = await response.json().catch(() => undefined) as T | undefined;
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error };
  }
}

export async function fetchJson<T = unknown>(
  url: string | URL,
  init: RequestInit = {},
  options: FetchJsonWithTimeoutOptions = {},
): Promise<T> {
  const result = await fetchJsonWithTimeout<T>(url, init, options);
  if (!result.ok) {
    const error = result.error instanceof Error ? result.error : new Error(result.status ? `HTTP ${result.status}` : "Fetch failed");
    throw error;
  }
  return result.body as T;
}
