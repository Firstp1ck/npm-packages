import assert from "node:assert/strict";
import { advanceStreamingMarkdownTail } from "../public/stream-markdown-tail.mjs";
import { createTranscriptRenderer } from "../public/transcript-renderer.mjs";

class FakeNode {
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.isConnected = false;
  }
  get firstChild() { return this.childNodes[0] || null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.nodeType === 11) {
        this.append(...[...node.childNodes]);
        node.childNodes = [];
        continue;
      }
      node.parentNode = this;
      node.isConnected = this.isConnected;
      this.childNodes.push(node);
    }
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
    this.setConnected(false);
  }
  setConnected(value) {
    this.isConnected = value;
    for (const child of this.childNodes) child.setConnected(value);
  }
}

class FakeText extends FakeNode {
  constructor(data = "") { super(FakeNode.TEXT_NODE); this.data = data; }
  appendData(value) { this.data += value; }
}

class FakeElement extends FakeNode {
  constructor() { super(FakeNode.ELEMENT_NODE); this.dataset = {}; }
  addEventListener() {}
  closest() { return null; }
  matches() { return false; }
  querySelectorAll() { return []; }
  contains(candidate) {
    if (candidate === this) return true;
    return this.childNodes.some((child) => child === candidate || (child.contains?.(candidate) ?? false));
  }
}

class FakeFragment extends FakeNode {
  constructor() { super(11); }
}

globalThis.Node = FakeNode;
globalThis.document = {
  addEventListener() {},
  createDocumentFragment: () => new FakeFragment(),
  createTextNode: (value) => new FakeText(value),
  createElement: () => new FakeElement(),
};
globalThis.window = {
  addEventListener() {},
  getSelection: () => ({ rangeCount: 0, isCollapsed: true }),
};

const chat = new FakeElement();
chat.setConnected(true);
const surface = new FakeElement();
chat.append(surface);
const renderer = createTranscriptRenderer({ chat });
let liveCreates = 0;
let liveAppends = 0;
let authoritativeRenders = 0;

const options = {
  surface,
  messageKey: "live:test",
  kind: "assistant-final",
  stableBoundary: (text, state, advanceOptions) => advanceStreamingMarkdownTail(state, text, advanceOptions),
  renderInto(parent, text) {
    authoritativeRenders += 1;
    const block = new FakeElement();
    block.append(new FakeText(text));
    parent.append(block);
  },
  renderLiveTail(parent, tail) {
    liveCreates += 1;
    const block = new FakeElement();
    block.append(new FakeText(tail));
    parent.append(block);
  },
  appendLiveTail(nodes, previousTail, tail) {
    liveAppends += 1;
    nodes[0].firstChild.appendData(tail.slice(previousTail.length));
  },
};

const first = renderer.reconcileMarkdownSurface({ ...options, text: "```js\none" });
const mountedTail = surface.firstChild;
assert.equal(first.liveMode, "open-fence");
assert.equal(liveCreates, 1);
assert.equal(authoritativeRenders, 0, "an incomplete fence must not run authoritative Markdown/tokenization");

const second = renderer.reconcileMarkdownSurface({ ...options, text: "```js\nonetwo" });
assert.equal(second.reusedTail, true);
assert.equal(surface.firstChild, mountedTail, "live open-fence appends must retain the mounted tail node identity");
assert.equal(liveCreates, 1);
assert.equal(liveAppends, 1);
assert.equal(authoritativeRenders, 0);

const closedText = "```js\nonetwo\n```";
renderer.reconcileMarkdownSurface({ ...options, text: closedText });
assert.equal(authoritativeRenders, 1, "closing the fence must perform one authoritative highlighted render");
assert.notEqual(surface.firstChild, mountedTail);
const highlightedTail = surface.firstChild;

renderer.reconcileMarkdownSurface({ ...options, text: closedText, complete: true });
assert.equal(authoritativeRenders, 1, "explicit completion must promote an already authoritative close without highlighting twice");
assert.equal(surface.firstChild, highlightedTail, "authoritative completion must preserve the completed block identity");

const longPlain = "x".repeat(16 * 1024 + 1);
renderer.reconcileMarkdownSurface({ ...options, text: longPlain });
assert.equal(surface.firstChild.firstChild.data, longPlain);
renderer.reconcileMarkdownSurface({ ...options, text: longPlain, complete: true });
assert.equal(authoritativeRenders, 2, "completion must replace the cheap long-tail representation with authoritative Markdown");

const incompleteFence = "```js\nunfinished";
renderer.reconcileMarkdownSurface({ ...options, text: incompleteFence });
renderer.reconcileMarkdownSurface({ ...options, text: incompleteFence, complete: true });
assert.equal(authoritativeRenders, 3, "completion must authoritatively tokenize even an unclosed fence exactly once");

console.log("transcript-markdown-tail.test.mjs passed");
