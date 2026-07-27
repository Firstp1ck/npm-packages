const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

export function randomBase64Url(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64Url(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value))));
}

export async function createStatusCapability(statusTokenKey: string, submissionId: string, nonce: string): Promise<{ token: string; hash: string }> {
  const token = await hmacSha256Base64Url(statusTokenKey, `pi-webui-issue-bot:v1:${submissionId}:${nonce}`);
  return { token, hash: await sha256Hex(token) };
}

export async function createIpBucket(ipHashKey: string, ip: string, now: Date): Promise<string> {
  // The UTC day rotates stored identifiers without retaining the source address.
  const day = now.toISOString().slice(0, 10);
  return hmacSha256Base64Url(ipHashKey, `pi-webui-issue-bot:ip:v1:${day}:${ip}`);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
