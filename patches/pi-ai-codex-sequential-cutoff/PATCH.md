# PATCH.md — Add Codex sequential_cutoff reasoning summaries to pi-ai

## Purpose

Adopt the Codex 0.143.0-style reasoning summary delivery mode for `@earendil-works/pi-ai` Codex Responses streaming. The patch sends `stream_options.reasoning_summary_delivery = "sequential_cutoff"` and consumes the new `response.reasoning_summary_text.done` stream event so reasoning summaries are still surfaced in Pi.

### Root cause

Current `pi-ai@0.80.3` streams Codex responses with `stream: true` but without `stream_options`, and only handles incremental `response.reasoning_summary_text.delta` plus `response.reasoning_summary_part.done`. Newer Codex can deliver reasoning summaries through a terminal `response.reasoning_summary_text.done` event whose payload carries `item_id`, `summary_index`, and full `text`; without handling this event, Pi can miss reasoning summaries.

### Expected outcome

Codex requests include:

```json
"stream_options": {
  "reasoning_summary_delivery": "sequential_cutoff"
}
```

When Codex emits `response.reasoning_summary_text.done`, Pi appends the done-event text to the active reasoning/thinking block and emits a `thinking_delta`, while preserving existing delta-based summary handling.

---

## Scope (exact files changed)

> Use POSIX-style paths for portability on Linux/macOS.

Path variables:

- `NPM_PACKAGES=/home/firstpick/npm-packages`
- `WEBUI_PACKAGE=${NPM_PACKAGES}/pi-package-webui`
- `PI_AI_RUNTIME=${WEBUI_PACKAGE}/node_modules/@earendil-works/pi-ai`
- `PI_AI_NESTED=${WEBUI_PACKAGE}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai`
- `NPM_GLOBAL=${HOME}/.npm-global/lib/node_modules`
- `GLOBAL_PI_AI=${NPM_GLOBAL}/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai`
- `GLOBAL_WEB_ACCESS_PI_AI=${NPM_GLOBAL}/pi-web-access/node_modules/@earendil-works/pi-ai`
- `PI_AGENT_NPM=${HOME}/.pi/agent/npm` (symlinked to `${HOME}/.dotfiles/.pi/agent/npm` on this machine)
- `AGENT_PI_AI=${PI_AGENT_NPM}/node_modules/@earendil-works/pi-ai`
- `AGENT_NESTED_PI_AI=${PI_AGENT_NPM}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai`
- `UPSTREAM_PI=<checkout of github.com/earendil-works/pi>`
- `UPSTREAM_AI=${UPSTREAM_PI}/packages/ai`

Installed runtime files patched now:
1. `${PI_AI_RUNTIME}/dist/api/openai-codex-responses.js`
2. `${PI_AI_RUNTIME}/dist/api/openai-responses-shared.js`
3. `${PI_AI_NESTED}/dist/api/openai-codex-responses.js`
4. `${PI_AI_NESTED}/dist/api/openai-responses-shared.js`
5. `${GLOBAL_PI_AI}/dist/api/openai-codex-responses.js`
6. `${GLOBAL_PI_AI}/dist/api/openai-responses-shared.js`
7. `${GLOBAL_WEB_ACCESS_PI_AI}/dist/api/openai-codex-responses.js`
8. `${GLOBAL_WEB_ACCESS_PI_AI}/dist/api/openai-responses-shared.js`
9. `${AGENT_PI_AI}/dist/api/openai-codex-responses.js`
10. `${AGENT_PI_AI}/dist/api/openai-responses-shared.js`
11. `${AGENT_NESTED_PI_AI}/dist/api/openai-codex-responses.js`
12. `${AGENT_NESTED_PI_AI}/dist/api/openai-responses-shared.js`

Upstream source files to patch after package updates:
1. `${UPSTREAM_AI}/src/api/openai-codex-responses.ts`
2. `${UPSTREAM_AI}/src/api/openai-responses-shared.ts`

---

## Change 1 — Send sequential_cutoff stream option on Codex requests

**File:** `${UPSTREAM_AI}/src/api/openai-codex-responses.ts`

### What was changed

Add `stream_options` to the Codex request body built in `buildRequestBody()`.

Before:

```ts
const body = {
	model: model.id,
	store: false,
	stream: true,
	instructions: context.systemPrompt || "You are a helpful assistant.",
	input: messages,
	// ...
};
```

After:

```ts
const body = {
	model: model.id,
	store: false,
	stream: true,
	stream_options: {
		reasoning_summary_delivery: "sequential_cutoff",
	},
	instructions: context.systemPrompt || "You are a helpful assistant.",
	input: messages,
	// ...
};
```

The same runtime edit was applied to all installed generated Codex response files listed in Scope.

### Why

Codex PR #31306 introduced this request field for the new reasoning summary delivery mode. Sending it asks the backend to deliver reasoning summaries through the sequential cutoff path.

---

## Change 2 — Track reasoning item ids for thinking slots

**File:** `${UPSTREAM_AI}/src/api/openai-responses-shared.ts`

### What was changed

Extend the internal thinking slot shape to remember the reasoning item id, then populate it when a `reasoning` output item is added.

Before:

```ts
type ResponsesOutputSlot =
	| { type: "thinking"; block: ThinkingContent; contentIndex: number }
	| { type: "text"; block: TextContent; contentIndex: number }
	| { type: "toolCall"; block: StreamingToolCall; contentIndex: number };
```

After:

```ts
type ResponsesOutputSlot =
	| { type: "thinking"; block: ThinkingContent; contentIndex: number; itemId?: string }
	| { type: "text"; block: TextContent; contentIndex: number }
	| { type: "toolCall"; block: StreamingToolCall; contentIndex: number };
```

And in `createSlot()` for `item.type === "reasoning"`:

```ts
const slot = {
	type: "thinking",
	block,
	contentIndex: output.content.length - 1,
	itemId: item.id,
} satisfies ResponsesOutputSlot;
```

The installed generated JS stores `itemId: item.id` on the thinking slot in all installed runtime copies listed in Scope.

### Why

The new done event includes `item_id`. Recording the item id lets the stream processor attach done-event text to the correct active reasoning block, instead of relying only on `output_index`.

---

## Change 3 — Consume response.reasoning_summary_text.done

**File:** `${UPSTREAM_AI}/src/api/openai-responses-shared.ts`

### What was changed

Add a helper near `getSlot()` to resolve the active thinking slot by `output_index`, by `item_id`, or as a fallback to the only active thinking slot:

```ts
const findThinkingSlotForEvent = (
	event: ResponseStreamEvent & { output_index?: number; item_id?: string },
): Extract<ResponsesOutputSlot, { type: "thinking" }> | undefined => {
	if (typeof event.output_index === "number") {
		const slot = getSlot(event.output_index, "thinking");
		if (slot) return slot;
	}
	const itemId = typeof event.item_id === "string" ? event.item_id : undefined;
	let fallback: Extract<ResponsesOutputSlot, { type: "thinking" }> | undefined;
	for (const slot of outputSlots.values()) {
		if (slot.type !== "thinking") continue;
		fallback ??= slot;
		if (itemId && slot.itemId === itemId) return slot;
	}
	return fallback;
};
```

Then handle the new event before `response.reasoning_summary_part.done`:

```ts
} else if (event.type === "response.reasoning_summary_text.done") {
	const slot = findThinkingSlotForEvent(event);
	if (!slot) continue;
	const text = typeof event.text === "string" ? event.text : "";
	if (!text) continue;
	let delta = text;
	if (slot.block.thinking.length > 0) {
		if (slot.block.thinking === text || slot.block.thinking.endsWith(text)) {
			continue;
		}
		if (text.startsWith(slot.block.thinking)) {
			delta = text.slice(slot.block.thinking.length);
		} else if (event.summary_index > 0 && !slot.block.thinking.endsWith("\n\n")) {
			delta = "\n\n" + text;
		}
	}
	slot.block.thinking += delta;
	stream.push({
		type: "thinking_delta",
		contentIndex: slot.contentIndex,
		delta,
		partial: output,
	});
}
```

The same runtime edit was applied to all installed generated response shared files listed in Scope.

### Why

`response.reasoning_summary_text.done` carries the full summary text for the sequential cutoff delivery mode. Handling it prevents summary loss and avoids duplicating text if older delta events and done events both appear.

---

## Verification steps

Run from any directory:

```bash
NPM_PACKAGES=/home/firstpick/npm-packages
WEBUI_PACKAGE="${NPM_PACKAGES}/pi-package-webui"
PI_AI_RUNTIME="${WEBUI_PACKAGE}/node_modules/@earendil-works/pi-ai"
PI_AI_NESTED="${WEBUI_PACKAGE}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"
NPM_GLOBAL="${HOME}/.npm-global/lib/node_modules"
GLOBAL_PI_AI="${NPM_GLOBAL}/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"
GLOBAL_WEB_ACCESS_PI_AI="${NPM_GLOBAL}/pi-web-access/node_modules/@earendil-works/pi-ai"
PI_AGENT_NPM="${HOME}/.pi/agent/npm"
AGENT_PI_AI="${PI_AGENT_NPM}/node_modules/@earendil-works/pi-ai"
AGENT_NESTED_PI_AI="${PI_AGENT_NPM}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"

PI_AI_ROOTS=(
  "${PI_AI_RUNTIME}"
  "${PI_AI_NESTED}"
  "${GLOBAL_PI_AI}"
  "${GLOBAL_WEB_ACCESS_PI_AI}"
  "${AGENT_PI_AI}"
  "${AGENT_NESTED_PI_AI}"
)

for root in "${PI_AI_ROOTS[@]}"; do
  node --check "${root}/dist/api/openai-codex-responses.js"
  node --check "${root}/dist/api/openai-responses-shared.js"
  grep -n 'reasoning_summary_delivery: "sequential_cutoff"' \
    "${root}/dist/api/openai-codex-responses.js"
  grep -n 'response.reasoning_summary_text.done\|findThinkingSlotForEvent' \
    "${root}/dist/api/openai-responses-shared.js"
done
```

Optional runtime smoke test with mocked `fetch`:

```bash
node --input-type=module <<'EOF'
import { stream } from '/home/firstpick/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js';

const payload = btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_test' } }));
const apiKey = `header.${payload}.sig`;
let capturedBody;

globalThis.fetch = async (_url, init) => {
  capturedBody = JSON.parse(init.body);
  const events = [
    { type: 'response.created', response: { id: 'resp1' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'reasoning-1', summary: [] } },
    { type: 'response.reasoning_summary_text.done', item_id: 'reasoning-1', summary_index: 0, text: 'Checking' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'reasoning-1', summary: [{ text: 'Checking' }] } },
    { type: 'response.completed', response: { id: 'resp1', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(new TextEncoder().encode(sse), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

const model = {
  id: 'gpt-5.5',
  provider: 'openai-codex',
  api: 'openai-codex-responses',
  input: ['text'],
  output: ['text'],
  reasoning: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = { systemPrompt: 'You are helpful.', messages: [], tools: [] };
const events = [];
for await (const event of stream(model, context, { apiKey, transport: 'sse', reasoningEffort: 'low' })) {
  events.push(event);
}
if (capturedBody?.stream_options?.reasoning_summary_delivery !== 'sequential_cutoff') {
  throw new Error('missing sequential_cutoff stream option');
}
if (!events.some((event) => event.type === 'thinking_delta' && event.delta === 'Checking')) {
  throw new Error('missing done-event thinking_delta');
}
console.log('ok: sequential_cutoff sent and reasoning_summary_text.done consumed');
EOF
```

Expected:
- All `node --check` commands exit `0`.
- `grep` shows `reasoning_summary_delivery: "sequential_cutoff"` in every installed Codex response file listed in Scope.
- `grep` shows the done-event handler and helper in every installed response shared file listed in Scope.
- The optional smoke test prints `ok: sequential_cutoff sent and reasoning_summary_text.done consumed`.

---

## Operational notes

- This local patch edits generated `dist` files under multiple `node_modules` trees because the active `pi` binary resolves through `${NPM_GLOBAL}/@earendil-works/pi-coding-agent`, while WebUI and extension paths can resolve their own nested `pi-ai` copies. These edits may be overwritten by `npm install`, `npm update`, `pi update`, or an upstream Pi package update.
- For a durable upstream fix, apply the TypeScript source changes under `${UPSTREAM_AI}/src/api`, then run the `@earendil-works/pi-ai` build so `dist` and source maps are regenerated consistently.
- If upstream adds a typed `StreamOptions` shape later, prefer that type over ad-hoc object literals.
- Restart Pi after applying the installed runtime patch so the modified `pi-ai` modules are loaded by a fresh Node process.
