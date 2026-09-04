import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { IMAGE_ATTACHMENT_TYPES, LIMITS, ProtocolError, boundedString } from "./protocol.mjs";
import { resolveInsideWorkspace } from "./workspace.mjs";

// Composer attachments live in backend memory until a prompt consumes them. Files are read
// once, validated by size, type, and workspace confinement, and never re-read when the prompt is
// sent, so a file edited between attaching and sending cannot change what the user reviewed.

const IMAGE_SIGNATURES = [
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

function detectImageType(buffer) {
  for (const signature of IMAGE_SIGNATURES) {
    if (buffer.length >= signature.bytes.length && signature.bytes.every((byte, index) => buffer[index] === byte)) return signature.mimeType;
  }
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function decodeText(buffer) {
  if (buffer.includes(0)) throw new ProtocolError("rejected", "binary files cannot be attached as text");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(buffer);
  } catch {
    throw new ProtocolError("rejected", "text attachments must be valid UTF-8");
  }
}

export function createAttachmentStore({ workspaceRoot, now = () => Date.now() }) {
  const attachments = new Map();

  function list({ metadataOnly = false } = {}) {
    return [...attachments.values()].map(attachment => publicView(attachment, metadataOnly));
  }

  function publicView(attachment, metadataOnly = false) {
    return {
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
      path: attachment.path,
      ...(metadataOnly ? {} : { text: attachment.kind === "text" ? attachment.text : "" }),
      revision: attachment.revision || 0,
      edited: attachment.edited,
    };
  }

  function preflightChange(id, prospective, { metadataOnly = false, preflight = () => {} } = {}) {
    const next = new Map(attachments);
    if (prospective) next.set(id, prospective);
    else next.delete(id);
    const result = { ...(prospective ? { attachment: publicView(prospective, metadataOnly) } : {}), attachments: [...next.values()].map(entry => publicView(entry, metadataOnly)) };
    preflight(result);
    return result;
  }

  function add({ path: requested, granted = false }, options = {}) {
    if (attachments.size >= LIMITS.maxAttachments) throw new ProtocolError("limit_exceeded", `At most ${LIMITS.maxAttachments} attachments can be added`);
    let resolved;
    try {
      resolved = realpathSync(requested);
    } catch (error) {
      throw new ProtocolError("rejected", error.code === "ENOENT" ? "The file does not exist" : `Cannot read the file: ${error.message}`);
    }
    if (!granted && !resolveInsideWorkspace(workspaceRoot, resolved)) {
      throw new ProtocolError("rejected", "Files outside the workspace can only be attached through the file picker");
    }
    let stats;
    try {
      stats = statSync(resolved);
    } catch (error) {
      throw new ProtocolError("rejected", `Cannot read the file: ${error.message}`);
    }
    if (!stats.isFile()) throw new ProtocolError("rejected", "Only regular files can be attached");
    const extension = path.extname(resolved).slice(1).toLowerCase();
    const expectedImageType = IMAGE_ATTACHMENT_TYPES[extension] ?? null;
    const limit = expectedImageType ? LIMITS.maxImageAttachmentBytes : LIMITS.maxTextAttachmentBytes;
    if (stats.size > limit) throw new ProtocolError("limit_exceeded", `${expectedImageType ? "Images" : "Text files"} larger than ${Math.round(limit / 1024)} KiB cannot be attached`);
    let buffer;
    let fd;
    try {
      fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(fd).isFile()) throw new Error("Only regular files can be attached");
      const storage = Buffer.alloc(limit + 1);
      let count = 0;
      while (count < storage.length) {
        const read = readSync(fd, storage, count, storage.length - count, null);
        if (read === 0) break;
        count += read;
      }
      if (count > limit) throw new ProtocolError("limit_exceeded", "The attachment grew beyond its byte limit");
      buffer = storage.subarray(0, count);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError("rejected", `Cannot read the file: ${error.message}`);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    const id = `att-${randomBytes(6).toString("hex")}`;
    const name = boundedString(path.basename(resolved), LIMITS.maxAttachmentNameCharacters);
    let attachment;
    if (expectedImageType) {
      const detected = detectImageType(buffer);
      if (detected !== expectedImageType) throw new ProtocolError("rejected", `The file is not a valid ${expectedImageType} image`);
      attachment = { id, name, kind: "image", mimeType: detected, size: buffer.length, path: resolved, data: buffer.toString("base64"), edited: false, addedAt: now() };
    } else {
      const text = decodeText(buffer);
      attachment = { id, name, kind: "text", mimeType: "text/plain", size: buffer.length, path: resolved, text, edited: false, addedAt: now() };
    }
    preflightChange(id, attachment, options);
    attachments.set(id, attachment);
    return publicView(attachment, options.metadataOnly);
  }

  function update(id, text, options = {}) {
    const attachment = attachments.get(id);
    if (!attachment) throw new ProtocolError("stale_request", "That attachment no longer exists");
    if (attachment.kind !== "text") throw new ProtocolError("invalid_request", "Only text attachments can be edited");
    const size = Buffer.byteLength(text, "utf8");
    if (size > LIMITS.maxTextAttachmentBytes) throw new ProtocolError("limit_exceeded", "Text attachment exceeds its UTF-8 byte limit");
    const next = { ...attachment, text, size, edited: true, revision: (attachment.revision || 0) + 1 };
    preflightChange(id, next, options);
    attachments.set(id, next);
    return publicView(next, options.metadataOnly);
  }

  function readText(id, offset = 0, revision) {
    const attachment = attachments.get(id);
    if (!attachment) throw new ProtocolError("stale_request", "That attachment no longer exists");
    if (attachment.kind !== "text") throw new ProtocolError("invalid_request", "Only text attachments can be read");
    if (revision !== undefined && revision !== (attachment.revision || 0)) throw new ProtocolError("stale_request", "Attachment changed during reading");
    const text = attachment.text.slice(offset, offset + LIMITS.maxAttachmentReadCharacters);
    return { attachmentId: id, text, revision: attachment.revision || 0, size: attachment.size, nextOffset: offset + text.length < attachment.text.length ? offset + text.length : null };
  }

  function remove(id, options = {}) {
    if (!attachments.has(id)) throw new ProtocolError("stale_request", "That attachment no longer exists");
    preflightChange(id, null, options);
    attachments.delete(id);
    return { removed: id, remaining: attachments.size };
  }

  // Consumes the named attachments for one prompt. Unknown ids fail closed so the user never
  // sends a prompt believing a removed file is still attached.
  function take(ids) {
    const chosen = [];
    for (const id of ids) {
      const attachment = attachments.get(id);
      if (!attachment) throw new ProtocolError("stale_request", `Attachment ${id} is no longer available`);
      chosen.push(attachment);
    }
    for (const attachment of chosen) attachments.delete(attachment.id);
    return {
      images: chosen.filter((attachment) => attachment.kind === "image").map((attachment) => ({ type: "image", data: attachment.data, mimeType: attachment.mimeType })),
      texts: chosen.filter((attachment) => attachment.kind === "text").map((attachment) => ({ name: attachment.name, text: attachment.text })),
      names: chosen.map((attachment) => attachment.name),
    };
  }

  function clear() {
    attachments.clear();
  }

  return { list, add, update, remove, readText, take, clear, get size() { return attachments.size; } };
}

// The message Pi receives: the prompt text followed by every text attachment as a labelled
// fenced block. Images travel separately in the RPC `images` field.
export function composeMessageWithTexts(message, texts) {
  if (texts.length === 0) return message;
  const blocks = texts.map(({ name, text }) => {
    const fence = text.includes("````") ? "`````" : "````";
    return `Attached file: ${name}\n${fence}\n${text}\n${fence}`;
  });
  return `${message}\n\n${blocks.join("\n\n")}`;
}
