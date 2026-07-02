function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Fraction of transcript tokens that also appear in the reference text. */
export function tokenOverlapRatio(transcript, reference) {
  const transcriptTokens = tokenize(transcript);
  if (transcriptTokens.length === 0) return 0;
  const referenceTokens = new Set(tokenize(reference));
  if (referenceTokens.size === 0) return 0;
  let hits = 0;
  for (const token of transcriptTokens) {
    if (referenceTokens.has(token)) hits += 1;
  }
  return hits / transcriptTokens.length;
}

/**
 * Classify a transcript captured while (or right after) the assistant was
 * speaking as our own TTS output picked up by the microphone.
 */
export function isSelfEcho(transcript, recentSpokenText, { threshold = 0.6, referenceWords = 60 } = {}) {
  const words = tokenize(recentSpokenText);
  const recent = words.slice(-referenceWords).join(" ");
  return tokenOverlapRatio(transcript, recent) >= threshold;
}
