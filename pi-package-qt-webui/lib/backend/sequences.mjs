import { randomBytes } from "node:crypto";
import { LIMITS, ProtocolError } from "./protocol.mjs";
import { createJsonFileStore } from "./store.mjs";
import { settingsDirectory } from "./settings.mjs";

// Saved prompt sequences: named lists of prompts the user can run as one send followed by
// queued follow-ups. They are distinct from Pi's live queue, persist in the config directory,
// and every entry is validated on read and write so a hand-edited file cannot inject anything
// beyond bounded plain strings.

function validateSequence(raw, index, problems) {
  if (!raw || typeof raw !== "object") {
    problems.push(`sequence ${index + 1} is not an object`);
    return null;
  }
  const id = typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, LIMITS.maxSequenceNameCharacters) : "";
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= LIMITS.maxMessageCharacters).slice(0, LIMITS.maxSequenceEntries)
    : [];
  if (!id || name.length === 0 || entries.length === 0) {
    problems.push(`sequence ${index + 1} is incomplete and was ignored`);
    return null;
  }
  return {
    id,
    name,
    entries,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

export function validateSequences(raw) {
  const problems = [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const list = Array.isArray(source.sequences) ? source.sequences : [];
  const sequences = [];
  const seen = new Set();
  list.forEach((entry, index) => {
    const sequence = validateSequence(entry, index, problems);
    if (!sequence || seen.has(sequence.id)) return;
    if (sequences.length >= LIMITS.maxSequences) {
      problems.push(`more than ${LIMITS.maxSequences} sequences; extra entries were ignored`);
      return;
    }
    seen.add(sequence.id);
    sequences.push(sequence);
  });
  return { value: { sequences }, problems };
}

export function createSequenceStore({ env = process.env, directory = settingsDirectory(env), now = () => Date.now() } = {}) {
  const store = createJsonFileStore({ directory, fileName: "sequences.json", maxBytes: LIMITS.maxSequencesFileBytes, validate: validateSequences });

  function list() {
    const result = store.read();
    return { sequences: result.value.sequences, problems: result.problems, path: store.path };
  }

  function get(id) {
    return list().sequences.find((sequence) => sequence.id === id) ?? null;
  }

  // Creates a sequence when id is empty, otherwise replaces the named sequence in place so the
  // user's ordering survives renames and edits.
  function save({ id = "", name, entries }) {
    const cleanName = String(name).trim().slice(0, LIMITS.maxSequenceNameCharacters);
    let saved = null;
    store.update((state) => {
      const timestamp = now();
      if (id) {
        const existing = state.sequences.find((sequence) => sequence.id === id);
        if (!existing) throw new ProtocolError("stale_request", "That sequence no longer exists");
        existing.name = cleanName;
        existing.entries = entries;
        existing.updatedAt = timestamp;
        saved = existing;
        return state;
      }
      if (state.sequences.length >= LIMITS.maxSequences) throw new ProtocolError("limit_exceeded", `At most ${LIMITS.maxSequences} sequences can be saved`);
      saved = { id: `seq-${randomBytes(6).toString("hex")}`, name: cleanName, entries, createdAt: timestamp, updatedAt: timestamp };
      state.sequences.push(saved);
      return state;
    });
    return saved;
  }

  function remove(id) {
    let removed = null;
    store.update((state) => {
      const index = state.sequences.findIndex((sequence) => sequence.id === id);
      if (index === -1) throw new ProtocolError("stale_request", "That sequence no longer exists");
      removed = state.sequences.splice(index, 1)[0];
      return state;
    });
    return removed;
  }

  function move(id, delta) {
    let sequences = [];
    store.update((state) => {
      const index = state.sequences.findIndex((sequence) => sequence.id === id);
      if (index === -1) throw new ProtocolError("stale_request", "That sequence no longer exists");
      const target = Math.max(0, Math.min(state.sequences.length - 1, index + delta));
      const [entry] = state.sequences.splice(index, 1);
      state.sequences.splice(target, 0, entry);
      sequences = state.sequences;
      return state;
    });
    return sequences;
  }

  return { list, get, save, remove, move, path: store.path, directory };
}
