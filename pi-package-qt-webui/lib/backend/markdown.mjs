import { highlightCode } from "./highlight.mjs";
import { LIMITS, safeExternalLink } from "./protocol.mjs";

// Bounded Markdown renderer for untrusted assistant text.
//
// Output is a flat list of typed blocks. Inline content is emitted as Qt StyledText built only
// from escaped text and a fixed tag whitelist (<b>, <i>, <s>, <tt>, <a href>). Raw HTML in the
// input is always escaped, images never fetch anything, and links keep only approved schemes.
// The renderer never produces markup the QML side must sanitize again.

const INLINE_ENTITY = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeStyledText(text) {
  return String(text ?? "").replace(/[&<>"]/g, (character) => INLINE_ENTITY[character]);
}

function truncatedInput(text) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  if (raw.length <= LIMITS.maxMarkdownInputCharacters) return { text: raw, truncated: false };
  return { text: raw.slice(0, LIMITS.maxMarkdownInputCharacters), truncated: true };
}

function linkMarkup(label, target, original) {
  const href = safeExternalLink(target.trim());
  const styledLabel = renderInline(label, { allowLinks: false });
  // Disallowed schemes stay visible as inert text so nothing is silently hidden.
  if (!href) return escapeStyledText(original);
  return `<a href="${escapeStyledText(href)}">${styledLabel.length > 0 ? styledLabel : escapeStyledText(href)}</a>`;
}

// Inline scanner: code spans, strong, emphasis, strikethrough, links, autolinks, images, escapes.
export function renderInline(text, { allowLinks = true } = {}) {
  const source = String(text ?? "");
  let output = "";
  let index = 0;
  let guard = 0;

  const emphasisMatch = (marker) => {
    const escaped = marker.replace(/[*_~]/g, "\\$&");
    return new RegExp(`^${escaped}(?=\\S)([\\s\\S]+?)(?<=\\S)${escaped}`);
  };

  while (index < source.length) {
    if (++guard > source.length * 2 + 16) break;
    const rest = source.slice(index);
    const character = rest[0];

    if (character === "\\" && rest.length > 1 && /[\\`*_{}\[\]()#+\-.!~<>|]/.test(rest[1])) {
      output += escapeStyledText(rest[1]);
      index += 2;
      continue;
    }

    if (character === "`") {
      const fence = rest.match(/^(`+)/)[1];
      const close = rest.indexOf(fence, fence.length);
      if (close !== -1) {
        const code = rest.slice(fence.length, close);
        output += `<tt>${escapeStyledText(code.replace(/\n/g, " "))}</tt>`;
        index += close + fence.length;
        continue;
      }
    }

    if (character === "!" && rest[1] === "[") {
      const image = rest.match(/^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/);
      if (image) {
        output += `[image: ${escapeStyledText(image[1] || image[2] || "")}]`;
        index += image[0].length;
        continue;
      }
    }

    if (character === "[" && allowLinks) {
      const link = rest.match(/^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/);
      if (link) {
        output += linkMarkup(link[1], link[2], link[0]);
        index += link[0].length;
        continue;
      }
    }

    if (character === "<" && allowLinks) {
      const autolink = rest.match(/^<((?:https?:|mailto:)[^\s<>]+)>/);
      if (autolink) {
        output += linkMarkup(autolink[1], autolink[1], autolink[0]);
        index += autolink[0].length;
        continue;
      }
    }

    if (allowLinks && /^https?:\/\/[^\s<>]+/.test(rest)) {
      const bare = rest.match(/^https?:\/\/[^\s<>]+/)[0].replace(/[.,;:!?)]+$/, "");
      output += linkMarkup(bare, bare, bare);
      index += bare.length;
      continue;
    }

    let matched = false;
    for (const [marker, tag] of [["**", "b"], ["__", "b"], ["~~", "s"], ["*", "i"], ["_", "i"]]) {
      if (!rest.startsWith(marker)) continue;
      const match = rest.match(emphasisMatch(marker));
      if (!match) continue;
      output += `<${tag}>${renderInline(match[1], { allowLinks })}</${tag}>`;
      index += match[0].length;
      matched = true;
      break;
    }
    if (matched) continue;

    output += escapeStyledText(character);
    index += 1;
  }
  return output;
}

function tableSeparator(line) {
  return typeof line === "string" && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim()).slice(0, LIMITS.maxTableColumns);
}

function listMatch(line) {
  const match = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
  if (!match) return null;
  return { indent: match[1].length, ordered: /\d/.test(match[2]), text: match[3] };
}

function listItemBlock(item, depth) {
  const task = item.text.match(/^\[( |x|X)\]\s+(.*)$/);
  return {
    type: "listItem",
    depth,
    ordered: item.ordered,
    index: item.index,
    checked: task ? task[1].toLowerCase() === "x" : null,
    task: !!task,
    styled: renderInline(task ? task[2] : item.text),
  };
}

class BlockBudget {
  constructor() {
    this.blocks = [];
    this.truncated = false;
  }

  push(block) {
    if (this.blocks.length >= LIMITS.maxMarkdownBlocks) {
      this.truncated = true;
      return false;
    }
    this.blocks.push(block);
    return true;
  }
}

function renderBlocks(text, budget, depth) {
  const lines = text.split("\n");
  let index = 0;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) budget.push({ type: "paragraph", depth, styled: renderInline(paragraph.join("\n")).replace(/\n/g, "<br>") });
    paragraph = [];
  };

  while (index < lines.length && !budget.truncated) {
    const line = lines[index];
    if (line.trim().length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w.+#-]{0,32})[^`]*$/);
    if (fence) {
      flushParagraph();
      const delimiter = fence[1];
      const closing = new RegExp(`^\\s{0,3}${delimiter[0] === "~" ? "~" : "\`"}{${delimiter.length},}\\s*$`);
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const closed = index < lines.length;
      if (closed) index += 1;
      const language = fence[2].toLowerCase();
      const codeText = codeLines.join("\n");
      const highlighted = highlightCode(language, codeText);
      budget.push({ type: "code", depth, language, text: codeText, closed, tokens: highlighted.tokens });
      continue;
    }

    if (line.includes("|") && tableSeparator(lines[index + 1])) {
      flushParagraph();
      const header = splitTableRow(line).map((cell) => renderInline(cell));
      index += 2;
      const rows = [];
      let dropped = 0;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim().length > 0) {
        if (rows.length < LIMITS.maxTableRows) rows.push(splitTableRow(lines[index]).map((cell) => renderInline(cell)));
        else dropped += 1;
        index += 1;
      }
      budget.push({ type: "table", depth, header, rows, droppedRows: dropped });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      budget.push({ type: "heading", depth, level: heading[1].length, styled: renderInline(heading[2]) });
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      budget.push({ type: "rule", depth });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      if (depth + 1 >= LIMITS.maxMarkdownDepth) {
        budget.push({ type: "paragraph", depth, quote: true, styled: escapeStyledText(quoteLines.join(" ")) });
      } else {
        const start = budget.blocks.length;
        renderBlocks(quoteLines.join("\n"), budget, depth + 1);
        for (let cursor = start; cursor < budget.blocks.length; cursor += 1) budget.blocks[cursor].quote = true;
      }
      continue;
    }

    const first = listMatch(line);
    if (first) {
      flushParagraph();
      const items = [];
      const counters = new Map();
      let itemCount = 0;
      while (index < lines.length) {
        const current = lines[index];
        const item = listMatch(current);
        if (item) {
          const level = Math.min(Math.floor(item.indent / 2), LIMITS.maxMarkdownDepth - 1);
          const key = `${level}:${item.ordered}`;
          const counter = (counters.get(key) ?? 0) + 1;
          counters.set(key, counter);
          for (const [otherKey] of counters) if (Number(otherKey.split(":")[0]) > level) counters.delete(otherKey);
          if (itemCount < LIMITS.maxListItems) items.push(listItemBlock({ ...item, index: counter }, depth + level));
          itemCount += 1;
          index += 1;
          continue;
        }
        if (items.length > 0 && /^\s{2,}\S/.test(current)) {
          const last = items[items.length - 1];
          last.styled += `<br>${renderInline(current.trim())}`;
          index += 1;
          continue;
        }
        break;
      }
      for (const item of items) if (!budget.push(item)) break;
      if (itemCount > LIMITS.maxListItems) budget.push({ type: "paragraph", depth, styled: escapeStyledText(`… ${itemCount - LIMITS.maxListItems} more list items omitted`) });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
}

export function renderMarkdown(text) {
  const input = truncatedInput(text);
  const budget = new BlockBudget();
  renderBlocks(input.text, budget, 0);
  if (input.truncated || budget.truncated) {
    if (budget.blocks.length >= LIMITS.maxMarkdownBlocks) budget.blocks.length = LIMITS.maxMarkdownBlocks - 1;
    budget.blocks.push({ type: "notice", depth: 0, styled: escapeStyledText("Output was shortened to stay within the transcript limit.") });
  }
  return { blocks: budget.blocks, truncated: input.truncated || budget.truncated };
}

// Plain text of rendered blocks, used by tests to prove copy/search return original text.
export function blockPlainText(block) {
  if (block.type === "code") return block.text;
  if (block.type === "table") return [block.header, ...block.rows].map((row) => row.join(" | ")).join("\n");
  return String(block.styled ?? "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
