const RIFF_HEADER_BYTES = 44;

export function encodeWav(pcm, { sampleRateHz = 16000, channels = 1, bitsPerSample = 16 } = {}) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm ?? []);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRateHz * blockAlign;
  const header = Buffer.alloc(RIFF_HEADER_BYTES);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

export function parseWav(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return undefined;
  }

  let offset = 12;
  let format;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt " && chunkStart + 16 <= buf.length) {
      format = {
        audioFormat: buf.readUInt16LE(chunkStart),
        channels: buf.readUInt16LE(chunkStart + 2),
        sampleRateHz: buf.readUInt32LE(chunkStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data" && format) {
      const dataLength = Math.min(chunkSize, buf.length - chunkStart);
      return { ...format, dataOffset: chunkStart, dataLength, data: buf.subarray(chunkStart, chunkStart + dataLength) };
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  return undefined;
}

export function isWav(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}
