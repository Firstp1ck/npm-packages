const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

export interface GithubAppEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  ISSUE_BOT_GITHUB_API_URL?: string;
  ISSUE_BOT_ALLOW_INSECURE_GITHUB_API?: string;
  ISSUE_BOT_GITHUB_OWNER?: string;
  ISSUE_BOT_GITHUB_REPOSITORY?: string;
  ISSUE_BOT_GITHUB_APP_SLUG?: string;
}

export interface GithubTarget { apiUrl: string; owner: string; repository: string; appBotLogin: string }
export type GithubTokenResult =
  | { kind: "token"; token: string }
  | { kind: "retry"; retryAfterSeconds: number | null }
  | { kind: "unavailable" };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const APP_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u;
const NUMERIC_ID = /^\d{1,20}$/u;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function textBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: readonly number[] | Uint8Array): number[] {
  return [tag, ...derLength(content.length), ...content];
}

function pkcs8FromPkcs1(pkcs1: Uint8Array): Uint8Array {
  const rsaAlgorithm = der(0x30, [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return Uint8Array.from(der(0x30, [...der(0x02, [0x00]), ...rsaAlgorithm, ...der(0x04, pkcs1)]));
}

function pemBytes(pem: string): Uint8Array | null {
  const isPkcs1 = pem.includes("-----BEGIN RSA PRIVATE KEY-----");
  const isPkcs8 = pem.includes("-----BEGIN PRIVATE KEY-----");
  if (isPkcs1 === isPkcs8) return null;
  const label = isPkcs1 ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const body = pem.replace(`-----BEGIN ${label}-----`, "").replace(`-----END ${label}-----`, "").replace(/\s+/gu, "");
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/u.test(body)) return null;
  try {
    const binary = atob(body);
    const decoded = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return isPkcs1 ? pkcs8FromPkcs1(decoded) : decoded;
  } catch { return null; }
}

/** Creates a short-lived RS256 GitHub App JWT without a Node-only crypto dependency. */
export async function createGithubAppJwt(appId: string, privateKeyPem: string, now = Date.now()): Promise<string | null> {
  if (!NUMERIC_ID.test(appId)) return null;
  const keyBytes = pemBytes(privateKeyPem);
  if (!keyBytes) return null;
  try {
    // Copy into an ArrayBuffer-backed view: TypeScript's WebCrypto overload rejects
    // a generic ArrayBufferLike even though the decoded PEM is ordinary bytes.
    const keyMaterial = new Uint8Array(keyBytes.byteLength);
    keyMaterial.set(keyBytes);
    const key = await crypto.subtle.importKey("pkcs8", keyMaterial.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const issuedAt = Math.floor(now / 1_000) - 60;
    const header = textBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = textBase64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }));
    const signingInput = `${header}.${claims}`;
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
  } catch { return null; }
}

export function githubTarget(env: GithubAppEnv): GithubTarget | null {
  const owner = env.ISSUE_BOT_GITHUB_OWNER ?? "";
  const repository = env.ISSUE_BOT_GITHUB_REPOSITORY ?? "";
  const appSlug = env.ISSUE_BOT_GITHUB_APP_SLUG ?? "";
  if (!IDENTIFIER.test(owner) || !IDENTIFIER.test(repository) || !APP_SLUG.test(appSlug)) return null;
  let apiUrl: URL;
  try { apiUrl = new URL(env.ISSUE_BOT_GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL); } catch { return null; }
  const localInsecure = (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") && env.ISSUE_BOT_ALLOW_INSECURE_GITHUB_API === "true";
  if (apiUrl.protocol !== "https:" && !localInsecure) return null;
  return { apiUrl: apiUrl.toString().replace(/\/$/u, ""), owner, repository, appBotLogin: `${appSlug}[bot]` };
}

export function githubRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && /^\d{1,6}$/u.test(retryAfter)) return Math.min(3_600, Math.max(1, Number(retryAfter)));
  const reset = headers.get("x-ratelimit-reset");
  if (reset && /^\d{10,13}$/u.test(reset)) {
    const resetMs = Number(reset.length === 10 ? `${reset}000` : reset);
    return Math.min(3_600, Math.max(1, Math.ceil((resetMs - Date.now()) / 1_000)));
  }
  return null;
}

/** Mints a fresh installation token narrowed to the configured single repository and Issues: write. */
export async function mintInstallationToken(env: GithubAppEnv, target: GithubTarget, fetcher: typeof fetch): Promise<GithubTokenResult> {
  const jwt = await createGithubAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  if (!jwt || !NUMERIC_ID.test(env.GITHUB_APP_INSTALLATION_ID)) return { kind: "unavailable" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${target.apiUrl}/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, {
      method: "POST",
      headers: { "authorization": `Bearer ${jwt}`, "accept": "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ repositories: [target.repository], permissions: { issues: "write" } }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return { kind: "retry", retryAfterSeconds: null };
  }
  clearTimeout(timeout);
  if (response.status === 429 || response.status >= 500) return { kind: "retry", retryAfterSeconds: githubRetryAfter(response.headers) };
  if (!response.ok) return { kind: "unavailable" };
  let payload: unknown;
  try { payload = await response.json(); } catch { return { kind: "unavailable" }; }
  const token = typeof payload === "object" && payload !== null ? (payload as { token?: unknown }).token : null;
  // Installation tokens are opaque bearer values; validate only a conservative shape
  // and never include them in state, responses, or logs.
  if (typeof token !== "string" || token.length < 20 || token.length > 1_024 || /[\s\u0000]/u.test(token)) return { kind: "unavailable" };
  return { kind: "token", token };
}
