import { StringDecoder } from "node:string_decoder";

// Strict JSON-lines reader: LF is the only record delimiter, one trailing CR is stripped,
// and any record longer than maxFrameBytes is rejected without being buffered further.
// Node's readline is intentionally not used because it also splits on U+2028/U+2029.
export function createJsonlReader({ maxFrameBytes, onRecord, onOversized, onInvalid, shouldPause = () => false }) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let discarding = false;
  let discardedBytes = 0;

  const deliver = (line) => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      onInvalid?.(error, line);
      return;
    }
    onRecord(parsed, line);
  };

  const consume = (text) => {
    buffer += text;
    while (true) {
      if (shouldPause()) return;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        if (discarding) {
          discardedBytes += Buffer.byteLength(buffer, "utf8");
          buffer = "";
        } else if (Buffer.byteLength(buffer, "utf8") > maxFrameBytes) {
          discarding = true;
          discardedBytes = Buffer.byteLength(buffer, "utf8");
          buffer = "";
        }
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (discarding) {
        discarding = false;
        onOversized?.(discardedBytes + Buffer.byteLength(line, "utf8"));
        discardedBytes = 0;
        continue;
      }
      if (Buffer.byteLength(line, "utf8") > maxFrameBytes) {
        onOversized?.(Buffer.byteLength(line, "utf8"));
        continue;
      }
      deliver(line);
    }
  };

  return {
    resume() { consume(""); },
    get bufferedBytes() { return Buffer.byteLength(buffer); },
    write(chunk) {
      consume(typeof chunk === "string" ? chunk : decoder.write(chunk));
    },
    end() {
      consume(decoder.end());
      if (discarding) {
        onOversized?.(discardedBytes);
        discarding = false;
        discardedBytes = 0;
        buffer = "";
        return;
      }
      if (buffer.length > 0) {
        const tail = buffer;
        buffer = "";
        if (Buffer.byteLength(tail, "utf8") > maxFrameBytes) onOversized?.(Buffer.byteLength(tail, "utf8"));
        else deliver(tail);
      }
    },
  };
}

export function attachJsonlReader(stream, options) {
  const reader = createJsonlReader(options);
  stream.on("data", (chunk) => reader.write(chunk));
  stream.on("end", () => reader.end());
  return reader;
}
