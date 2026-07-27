export interface TurnstileConfig {
  secretKey: string;
  expectedAction?: string;
  expectedCdata?: string;
  remoteIp?: string;
  allowedHostnames?: readonly string[];
  endpoint?: string;
}

interface TurnstileReply { success?: unknown; action?: unknown; hostname?: unknown; cdata?: unknown }

/** Verify server-side only; neither tokens nor upstream response bodies are logged or returned. */
export async function verifyTurnstile(token: string, config: TurnstileConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!config.secretKey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const body = new URLSearchParams({ secret: config.secretKey, response: token });
    if (config.remoteIp) body.set("remoteip", config.remoteIp);
    if (config.expectedCdata) body.set("idempotency_key", config.expectedCdata);
    const response = await fetcher(config.endpoint ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body, signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    if (!response.ok) return false;
    const reply = await response.json() as TurnstileReply;
    if (reply.success !== true) return false;
    if (config.expectedAction && reply.action !== config.expectedAction) return false;
    if (config.expectedCdata && reply.cdata !== config.expectedCdata) return false;
    if (config.allowedHostnames?.length && (typeof reply.hostname !== "string" || !config.allowedHostnames.includes(reply.hostname))) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
