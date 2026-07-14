export const DOCX_ERROR_CODES = [
  "SOURCE_CHANGED", "DESTINATION_CHANGED", "DESTINATION_EXISTS", "UNSUPPORTED_FEATURE",
  "LOSSY_OPERATION", "SIGNED_DOCUMENT", "ACTIVE_CONTENT_BLOCKED", "INVALID_PACKAGE",
  "VALIDATION_FAILED", "RENDER_FAILED", "DEPENDENCY_MISSING", "ENCRYPTED_PACKAGE",
  "LIMIT_EXCEEDED", "INVALID_ARGUMENT", "SELECTOR_NOT_FOUND", "AMBIGUOUS_SELECTOR",
  "REVISION_NOT_FOUND", "REVISION_STALE", "PERMISSION_DENIED", "CANCELLED",
  "PROTOCOL_ERROR", "TIMEOUT"
] as const;

export type DocxErrorCode = typeof DOCX_ERROR_CODES[number];

const SENSITIVE_RE = /(password|passwd|pwd|secret|token)(\s*[=:]\s*)([^\s,;]+)/gi;
export function redact(value: string): string {
  return value.replace(SENSITIVE_RE, "$1$2[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

export class DocxError extends Error {
  readonly code: DocxErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: DocxErrorCode, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${redact(message)}`);
    this.name = "DocxError";
    this.code = code;
    this.details = details;
  }
  override toString(): string {
    return JSON.stringify({ code: this.code, message: this.message.replace(`${this.code}: `, ""), details: this.details });
  }
}

export function fail(code: DocxErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new DocxError(code, message, details);
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("CANCELLED", "DOCX operation was cancelled.");
}

export function asDocxError(error: unknown, fallback: DocxErrorCode = "VALIDATION_FAILED"): DocxError {
  if (error instanceof DocxError) return error;
  return new DocxError(fallback, error instanceof Error ? error.message : String(error));
}
