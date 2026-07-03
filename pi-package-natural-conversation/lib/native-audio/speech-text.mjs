const CODE_BLOCK_PLACEHOLDER = "Code block omitted.";

// Phrases whisper famously invents from silence/noise (training-data artifacts
// from video outros and subtitle credits), normalized to letters-only.
const STT_HALLUCINATION_EXACT = new Set([
  "thankyou",
  "thankyouverymuch",
  "thanks",
  "thanksforwatching",
  "thankyouforwatching",
  "you",
  "bye",
  "byebye",
  "goodbye",
  "sobye",
  "danke",
  "dankeschön",
  "vielendank",
  "tschüss",
  "bisbald",
  "biszumnächstenmal",
  "daswars",
]);
const STT_HALLUCINATION_PATTERNS = /amaraorg|untertitel|subtitles|copyright|thanksforwatching/;

/**
 * True when a transcript matches a known whisper hallucination phrase. Only
 * a hint: callers must combine it with audio evidence (e.g. low voicedMs)
 * so a genuine spoken "thank you" is never dropped.
 */
export function isLikelySttHallucination(text) {
  const normalized = String(text ?? "").toLowerCase().replace(/[^\p{L}]+/gu, "");
  if (!normalized) return true;
  return STT_HALLUCINATION_EXACT.has(normalized) || STT_HALLUCINATION_PATTERNS.test(normalized);
}

/**
 * Reduce assistant markdown to text suitable for TTS. Tool cards never reach
 * this function; it only sees final assistant message text.
 */
export function speakableTextFromMarkdown(markdown) {
  let text = typeof markdown === "string" ? markdown : "";
  text = text.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_BLOCK_PLACEHOLDER} `);
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Symbol-heavy strings are unlistenable; a TTS voice spelling out a URL or
  // a deep path is worse than omitting it (the visible transcript keeps it).
  text = text.replace(/\bhttps?:\/\/[^\s)\]}>"']+/gi, "Link");
  // Deep filesystem paths shrink to their last segment ("the file voice.json").
  text = text.replace(/(^|\s)((?:~?\/[\w.@-]+){3,})\/?(?=[\s.,;:!?)]|$)/g, (_match, lead, path) => {
    const segments = path.split("/").filter(Boolean);
    return `${lead}${segments[segments.length - 1]}`;
  });
  text = text.replace(/\p{Extended_Pictographic}️?/gu, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*\|.*\|\s*$/gm, " ");
  text = text.replace(/^[-=_*]{3,}\s*$/gm, " ");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Split text into sentence chunks, merging short sentences until each chunk
 * reaches `minChars`, so the first chunk can start playing while later ones
 * synthesize.
 */
export function splitIntoSpeechChunks(text, { minChars = 60, maxChars = 400 } = {}) {
  const input = typeof text === "string" ? text.trim() : "";
  if (!input) return [];

  const sentences = input.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && (current.length >= minChars || candidate.length > maxChars)) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
