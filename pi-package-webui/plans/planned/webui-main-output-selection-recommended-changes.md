# Recommended Changes: Durable Main-Output Text Selection

Status: recommendation only — implementation not started
Date: 2026-08-01
Scope: Pi WebUI transcript and live-output rendering
Related plan: `plans/archive/webui-interaction-continuity.md`
Related report: `reports/webui-interaction-continuity.html`

## Executive recommendation

**Yes: a focused renderer design change is needed.** More isolated `Range` capture/restore patches can close individual holes, but they cannot make text highlighting reliable while the WebUI has multiple independent code paths that replace selected DOM nodes.

The recommended direction is:

1. **Immediately close known bypasses** in compact output and streaming thinking as a tactical safety patch.
2. **Introduce one transcript mutation coordinator** so selection safety is the default for every chat/output DOM mutation rather than an opt-in helper.
3. **Give live output stable keyed DOM ownership** and preserve the same assistant bubble through streaming, settlement, and authoritative reconciliation.
4. **Use browser `Range` restoration only as a fallback**, not as the primary continuity mechanism.
5. **Do not migrate to React, another framework, or a generic virtual DOM.** The required change is a bounded transcript-renderer refactor using the existing DOM APIs and semantic keys.

This is a medium-sized architecture refactor, not a whole-WebUI rewrite.

## Why the current fix is insufficient

The current implementation correctly captures a non-collapsed selection inside one `.markdown-body` or `.compact-live-text`, records directional text offsets and transcript context, and restores only when the replacement contains the exact same text. That contract is safe, but only the following mutation paths currently participate:

- `renderStreamingMarkdown`
- `renderAllMessages`
- `refreshMessages`

Other first-class render paths still mutate or replace selectable DOM independently.

### Confirmed mutation-path gaps

| Path | Current mutation | Selection effect | Current helper coverage |
|---|---|---|---|
| Compact live output | `flushCompactLiveOutput` assigns `compactTextNode.textContent` each flush | Replaces the selected text node every batch | Missing |
| Streaming thinking | `renderThinkingMarkdown` calls full `renderMarkdown` / `replaceChildren` | Replaces thinking text every delta batch | Missing |
| Real pointer drag over live output | Streaming tail nodes may be removed while the mouse button is still down | Breaks the browser's native drag-selection session | Missing; pointer deferral only recognizes controls |
| Multi-part settlement | One streaming surface becomes several settled Markdown/tool surfaces | Single-surface offsets cannot map to several surfaces | Partial; current test uses one plain-text part |
| Live tool cards | Bodies use `replaceChildren` and cards can use `replaceWith` | Selection inside tool output is detached | Missing / outside current surface contract |
| Async Mermaid completion | Diagram descendants are replaced with `innerHTML = svg` after async rendering | Late replacement can invalidate a range seconds later | Missing |
| Cross-message selection | Capture rejects anchor and focus in different semantic surfaces | Any suffix rebuild may drop a common multi-message copy selection | Unsupported |
| Output/thinking mode transition | Transcript epoch changes and may force a full rebuild | Selection is intentionally invalidated | Safe but currently undocumented |

The clearest immediate defect is compact mode: `.compact-live-text` is declared as a selectable continuity surface, but its normal update path bypasses the continuity helper entirely.

## Root architectural problem

The WebUI currently has **distributed DOM ownership**:

```text
SSE / polling / foreground action
            │
            ├── normal streaming Markdown renderer
            ├── compact live-output flusher
            ├── thinking Markdown renderer
            ├── live tool-card renderer
            ├── authoritative transcript reconciler
            ├── async Mermaid renderer
            └── tab/session reset paths
                         │
                         ▼
               overlapping #chat mutations
```

Each renderer chooses independently whether to append, update text, remove a suffix, replace a body, replace a card, or rebuild `#chat`. Selection continuity is therefore opt-in. Every new renderer or mutation path can silently bypass it.

A browser selection is attached to concrete DOM nodes and offsets. If those nodes are removed, no generic after-the-fact restoration can always recover the user's intent:

- text may have changed legitimately;
- Markdown may split one surface into several nodes;
- a pointer drag may still be active;
- duplicate text may exist in several messages;
- async renderers may mutate after the parent render completes;
- cross-message ranges have multiple semantic owners.

The durable solution is to avoid detaching unchanged selected nodes and to centralize the remaining destructive mutations.

## Online state-of-the-art review

Research date: 2026-08-01. Primary sources are listed under [Online sources](#online-sources).

### Verdict

The **principles** behind the recommendation are industry-standard; the proposed class and function names are project-specific.

Across current server-driven UI frameworks, DOM morphing libraries, rich-text editors, and AI streaming renderers, the state-of-the-art pattern is consistent:

1. preserve stable identity with keys;
2. surgically patch or morph the existing DOM instead of replacing whole subtrees;
3. keep unchanged blocks/nodes mounted;
4. process updates through one transaction/commit boundary;
5. map a semantic selection through changes only when node preservation is impossible.

Livewire documents morphing specifically as a way to preserve unchanged elements, focus, and input values [S1]. Turbo uses Idiomorph for morphing and supports permanent regions and scroll preservation [S2]. Morphdom and Idiomorph both describe minimizing replacement so internal DOM state survives [S3][S4]. Phoenix LiveView 1.1 added keyed comprehensions and finer-grained change tracking to reduce list replacement and DOM operations [S5].

For AI output, Streamdown 2.5.0 uses **block-level memoization**: completed Markdown blocks remain stable while only changed blocks rerender [S6]. Its incomplete-Markdown preprocessing handles unterminated syntax before block rendering [S7]. This validates the recommended committed-block/live-tail direction, though Streamdown itself is React/Tailwind-oriented and is not a direct fit for this vanilla WebUI.

For editor-grade selection continuity, ProseMirror treats selection as application state and maps it through transactions; its `SelectionBookmark` is explicitly designed to map and later resolve a selection [S8][S9]. That is the strongest model for editable documents, but adopting ProseMirror for read-only chat output would be disproportionate. The WebUI should borrow semantic bookmarks and a single commit boundary, not the editor framework.

The DOM Standard also confirms why node preservation matters: browser ranges are live and boundary points are adjusted during node removal [S10]. Once selected descendants are removed or replaced, the browser is required to relocate range boundaries; after-the-fact text matching cannot universally recover intent.

### What is standard versus custom

| Recommendation element | Industry status | Plan implication |
|---|---|---|
| Stable keyed message/block identity | Established standard | Keep and extend `transcriptItemKey`; add stable block/surface keys |
| Surgical DOM morphing / in-place patching | Established standard | Prefer keyed block updates over `replaceChildren`/`replaceWith` |
| Completed Markdown blocks remain mounted | Current AI-streaming best practice | Adopt for normal, compact, and thinking output |
| One transaction/commit gateway | Established editor/state-management pattern | Keep the proposed coordinator, but describe it as the WebUI implementation of this pattern |
| Semantic selection bookmark mapped through changes | Established rich-editor pattern | Use as fallback for unavoidable structural changes and cross-block selection |
| Deferring mutation during an active pointer drag | Common protective technique, not a complete architecture | Use only to protect the drag gesture |
| Freezing a selected live tail and writing into a continuation zone | Custom design; not verified as a broad standard | Move behind a prototype/feature flag; do not make it the default before tests |
| Global `Range` capture/restore around every mutation | Tactical workaround | Retain only as migration/fallback protection |

### Candidate evaluation

Scores use the tech-deep-dive 1–5 criteria. Library metadata was verified from the official repositories/package manifests.

| Candidate | Fitness | Maturity | Ecosystem | Maintenance | Performance | API | Integration | License | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Project-owned keyed block renderer + commit gateway | 5 | 4 | 3 | 4 | 5 | 4 | 5 | 5 | **35/40** |
| Idiomorph 0.7.4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 5 | **32/40** |
| Streamdown 2.5.0 | 4 | 4 | 4 | 4 | 4 | 4 | 1 | 4 | **29/40** |

#### Project-owned keyed block renderer + commit gateway

- **Evidence base:** Livewire morphing, Turbo/Idiomorph, morphdom, Phoenix keyed comprehensions, Streamdown block memoization, and ProseMirror transactions [S1][S2][S4][S5][S6][S8].
- **Strengths:** exact fit for existing vanilla JavaScript; can preserve current Markdown, CSS, SSE, scroll, tool, and mobile contracts; no framework migration.
- **Weaknesses:** project must own block identity, diff correctness, browser-selection tests, and mutation discipline.
- **Risk:** a coordinator without stable DOM ownership would merely centralize the existing patches. Stable keyed blocks are the primary mechanism; the gateway enforces them.

#### Idiomorph 0.7.4 (0BSD)

- **Evidence base:** official repository, Turbo production adoption, and the htmx Idiomorph extension [S2][S3][S12].
- **Strengths:** small, dependency-free, real-DOM morphing; callbacks can prevent removal/mutation; directly compatible with vanilla JavaScript.
- **Weaknesses:** its documented `restoreFocus` implementation restores input/textarea focus and control selection, not arbitrary document `Selection` ranges [S3]. It cannot by itself solve live Markdown tail selection or active pointer-drag interruption.
- **Decision:** run a bounded prototype for **settled keyed subtree reconciliation only**. Do not adopt it as the selection solution unless the full behavioral matrix passes.

#### Streamdown 2.5.0 (Apache-2.0)

- **Evidence base:** official repository, block memoization documentation, and Vercel AI Elements integration [S6][S7][S13].
- **Strengths:** purpose-built for AI streaming, stable completed blocks, incomplete-Markdown handling, active ecosystem.
- **Weaknesses:** React 18/19 peer dependency, React DOM, Tailwind-oriented styles, and a substantially different Markdown/plugin stack.
- **Decision:** use as an architectural reference and test oracle; reject direct adoption because integration would become the framework migration this plan intentionally avoids.

### State-of-the-art recommendation

Adopt the project-owned keyed block renderer and transaction gateway. Before implementing its settled-message diff, prototype Idiomorph against the required selection tests. Borrow Streamdown's **stable completed block / rerender changed block only** model, but keep the current vanilla DOM and Markdown pipeline.

The updated recommendation is therefore less custom than the first draft: stable keys, block-level incremental rendering, DOM morphing, and transaction-based selection mapping are established patterns. The unproven continuation-zone idea is now optional rather than foundational.

## Architecture options

| Option | Durability | Change risk | Streaming performance | Maintainability | Recommendation |
|---|---:|---:|---:|---:|---|
| Add more capture/restore calls | Low–medium | Low | Medium | Low | Tactical migration aid only |
| Defer destructive renders during active pointer drag | Medium | Low–medium | Medium | Medium | Adopt as a gesture guard |
| Stable keyed Markdown blocks and message ownership | High | Medium | High | High | **Primary approach** |
| Transcript transaction/commit gateway | High when paired with stable blocks | Medium | High | High | **Adopt incrementally** |
| Idiomorph for settled subtree reconciliation | Medium pending prototype | Low–medium | High | High | Prototype, then decide |
| Streamdown direct adoption | High for streaming Markdown | High | High | Medium | Reject; borrow its design |
| ProseMirror/editor model | Very high | Very high | Medium | High | Reject as disproportionate |
| Broad framework migration | Unknown | Very high | Unknown | Medium | Reject |

### Why more restoration patches are not enough

They can fix compact text and thinking quickly, but they remain path-dependent. They also cannot reliably preserve:

- a native drag session while nodes are removed;
- a selection whose Markdown structure changes;
- a range spanning several semantic surfaces;
- a selection during an async descendant rewrite.

Exact-text validation must remain strict. Weakening it to fuzzy matching could silently restore selection onto the wrong text, which is worse than clearing it.

### Why a framework migration is not recommended

The online evidence strengthens this conclusion. React preserves component state only while identity and position remain stable [S11]; a framework does not automatically preserve a native browser range when descendants are replaced. Streamdown demonstrates excellent block-level streaming behavior, but adopting it requires React/React DOM and a different styling/rendering stack [S6][S7].

The problem is DOM identity and mutation policy, not missing framework machinery. The existing keyed transcript prefix and streaming boundary are useful foundations. Implement the same stable-key/block-memoization principles directly, and evaluate a small morphing library only at the settled-subtree seam.

## Recommended target architecture

### 1. A single transcript mutation coordinator

Add a focused module, preferably:

```text
public/transcript-renderer.mjs
```

It should own all mutations beneath `#chat` that can affect transcript/output content. `public/app.js` remains the integration/controller layer.

Proposed conceptual API:

```js
commitTranscriptMutation({
  key,                 // latest-wins mutation identity
  context,             // tabId + generation + sessionId
  surfaces,            // semantic surfaces affected
  kind,                // append | reconcile | destructive | authoritative
  mutate,              // synchronous DOM mutation
  onInvalidSelection,  // explicit policy, not implicit guessing
});
```

The coordinator should:

- capture current selection/pointer-selection state once;
- determine whether the mutation intersects selected surfaces;
- run non-destructive updates immediately;
- stage/coalesce destructive updates when safe;
- apply authoritative invalidations immediately when correctness requires it;
- restore only with exact context, identity, direction, and text evidence;
- expose one testable mutation log in development/test mode.

This gateway follows the single-update/transaction pattern used by systems such as ProseMirror [S8], but it is not sufficient by itself. Its primary job is to **enforce stable keyed block ownership** and make destructive fallbacks visible. A gateway that still performs routine subtree replacement would only centralize the defect.

No renderer should call `replaceChildren`, `replaceWith`, `innerHTML`, or destructive `textContent` assignment under `#chat` outside this coordinator, except explicitly documented reset/navigation paths.

### 2. Stable keyed DOM ownership

Every rendered transcript unit should have a durable identity:

```text
(tabId, sessionId, transcriptItemKey, surfaceKind, segmentId)
```

Recommended surface kinds:

- `assistant-final`
- `assistant-thinking`
- `tool-execution`
- `tool-result`
- `compaction-summary`
- `live-tail`
- `diagram-source`
- `diagram-rendered`

`transcriptItemKey` is already available and should remain the canonical message identity.

### 3. Preserve live bubble identity through settlement

Today, a live assistant bubble can be removed and replaced by the authoritative assistant message. Instead:

1. create one keyed live bubble;
2. update it while streaming;
3. when the authoritative message arrives, validate its identity/content;
4. adopt/re-key the same bubble as the authoritative transcript item;
5. reconcile only the portions whose content genuinely differs.

This removes the highest-risk live-to-authoritative replacement window.

### 4. Stable keyed blocks plus a bounded mutable tail

Retain the existing streaming Markdown boundary concept but make its block identity and DOM ownership explicit:

```text
assistant bubble (stable message key)
├── completed block 1 (stable block key; never re-rendered)
├── completed block 2 (stable block key; never re-rendered)
└── incomplete tail  (only routinely mutable region)
```

This matches the block-level memoization model documented by Streamdown: completed blocks stay stable and only changed blocks rerender [S6].

Rules:

- completed block nodes are retained and never detached for append-only input;
- each block has a semantic key independent of array position;
- the tail is the only routinely mutable region;
- mutation uses in-place text/node patching where structure remains compatible;
- authoritative divergence may invalidate affected content, but that must be explicit and tested;
- the earlier "continuation zone" concept is a **prototype fallback**, not the baseline design.

For an incomplete Markdown construct whose DOM structure must change while selected, compare two prototypes:

1. defer only the destructive tail patch until the active drag ends, then map the established semantic bookmark; or
2. retain the selected tail temporarily and stream into a sibling continuation zone, reconciling after selection clears.

Choose the simpler option that passes real drag, 30-second highlight, high-cadence SSE, and copy-semantic tests. Do not assume the continuation-zone approach is standard.

### 5. Selection-session controller

Track native selection intent separately from control activation:

- `pointerdown` on selectable transcript text starts a selection gesture;
- `selectionchange` records the selected semantic surfaces;
- `pointerup` / `pointercancel` ends the drag phase but does not clear the established selection;
- `copy`, explicit click elsewhere, collapsed selection, tab switch, or context invalidation ends the selection session.

Policy:

| State | Mutation policy |
|---|---|
| Active pointer drag intersects affected surface | Do not detach or reparse selected nodes; coalesce the destructive tail patch |
| Established selection in completed keyed blocks | Continue rendering elsewhere; stable nodes require no restoration |
| Established selection intersects mutable tail | Use semantic bookmark mapping; invoke the continuation-zone prototype only if ordinary in-place patching cannot pass tests |
| Authoritative content changed inside selected text | Apply authoritative state and explicitly invalidate selection |
| Navigation/tab/session change | Clear selection; never migrate it |

A short timeout may bound detection of the **drag gesture**, but it must not authorize removal of an established selection's nodes. The durable guarantee comes from stable DOM identity, not an indefinitely deferred global renderer.

### 6. Unify normal, compact, and thinking output

Normal output, compact output, and thinking currently use different mutation strategies. They should share the same surface renderer and mutation coordinator:

- compact mode may choose plain-text rendering, but must update a stable text node rather than replace it;
- thinking should use the same incremental committed-zone/live-tail model;
- mode changes may intentionally rebuild, but the invalidation must be explicit and covered by tests.

### 7. Make async descendant renderers coordinator-aware

Mermaid and future async renderers must register their eventual mutation with the transcript coordinator. Token freshness checks prevent stale async writes, but they do not protect selection.

Recommended policy:

- preserve the source node as a stable sibling;
- render diagrams into a separate keyed container;
- do not replace selected descendants;
- if a selected diagram must be replaced, stage it until selection clears or document explicit invalidation.

### 8. Gate an Idiomorph prototype instead of assuming adoption

Idiomorph is a credible state-of-the-art candidate for settled subtree reconciliation: Turbo uses it in production, htmx exposes it as a morph swap, and its callbacks can veto node removal [S2][S3][S12]. However, its built-in focus restoration is designed for active inputs/textareas, not arbitrary document ranges [S3].

Create a throwaway prototype that morphs one settled assistant bubble using stable block IDs. It must pass:

- forward and backward document selection;
- duplicate text in different keyed messages;
- cross-block range;
- code block and Mermaid-adjacent selection;
- active pointer drag;
- authoritative removal and divergence.

Adopt Idiomorph only if it reduces custom diff code **and** preserves the same node identities required by the acceptance matrix. Otherwise keep the project-owned block reconciler.

## Recommended implementation phases

### Phase 0 — Characterization and tactical parity

Purpose: stop known bypasses and prove the real failure modes before the refactor.

Changes:

- wrap compact live-output updates in the existing exact selection contract;
- wrap `renderThinkingMarkdown` once at its central mutation point;
- add real pointer-drag tests, not only programmatic `Range` tests;
- add compact, thinking, multi-part settlement, duplicate-text, and async Mermaid fixtures;
- instrument all destructive mutations beneath `#chat` during tests.

This phase is necessary but **must not be described as the final architecture fix**.

### Phase 1 — Transaction gateway, semantic block model, and morphing spike

Purpose: make stable identity and selection-safe mutation the default before changing visible output.

Changes:

- create `public/transcript-renderer.mjs`;
- define semantic message, surface, and Markdown block keys;
- move selection bookmarks, mutation classification, and scheduling into one commit boundary;
- route current normal, compact, thinking, tool-card, and authoritative mutations through the gateway;
- prohibit direct destructive chat mutations with a static test or lint-style source contract;
- prototype Idiomorph on settled assistant blocks and record pass/fail evidence against the behavioral matrix;
- keep existing DOM output and CSS unchanged during the gateway extraction.

Exit decision:

- use Idiomorph for settled blocks only if it preserves arbitrary document ranges and reduces custom code;
- otherwise implement the small keyed block reconciler locally;
- do not introduce React or Streamdown as runtime dependencies.

Rollback: route call sites back to current functions; no persisted data or API changes.

### Phase 2 — Stable block streaming and settlement adoption

Purpose: eliminate avoidable node replacement using the industry-standard stable-key/block-update pattern.

Changes:

- split output into keyed completed blocks and one mutable tail;
- preserve bubble identity from live stream into authoritative transcript;
- make compact and thinking use the same stable block renderer;
- rerender only changed/incomplete blocks;
- reconcile keyed surfaces in place;
- retain strict authoritative invalidation and exact-text checks;
- prototype a continuation zone only for selected incomplete tails that cannot be patched safely.

Rollback: per-surface fallback to current rebuild behavior behind a temporary development flag.

### Phase 3 — Broader transcript selections and async surfaces

Purpose: cover common copy workflows beyond one Markdown surface.

Changes:

- support ranges spanning several keyed message surfaces;
- support tool output and multi-part assistant messages;
- make Mermaid/async renderers coordinator-aware;
- document intentional invalidation on navigation and presentation-mode changes.

Do not begin Phase 3 until Phase 2 is stable under high-cadence SSE tests.

## Required behavioral test matrix

The implementation should not be considered complete until browser tests cover the following observable behaviors.

| Selection shape | Mutation/event | Required outcome |
|---|---|---|
| Forward selection in settled assistant output | Periodic authoritative refresh | Same selected text, direction, and message identity |
| Backward selection | Stream delta and settlement | Anchor/focus direction preserved |
| Real mouse drag in live tail | Several high-cadence deltas | Drag session and resulting highlight survive |
| Compact live output | Repeated compact flushes | Selection remains |
| Streaming thinking | Repeated thinking deltas | Selection remains while thinking is visible |
| Live single-part output | Authoritative settlement | Same bubble or exact semantic continuation |
| Live multi-part output | Text/tool/text settlement | Selection maps to the correct text surface |
| Duplicate text in two messages | Suffix reconcile | Selection remains in the original keyed message |
| Selection across messages | Force rebuild / suffix change | Unchanged selected messages remain highlighted |
| Tool output | Live result update | Selection survives unchanged content |
| Mermaid-adjacent selection | Async SVG completion | Selected source/text nodes remain stable |
| Any selection | Output-mode or thinking-visibility change | Explicitly tested preserve-or-invalidate policy |
| Any selection | Tab/session navigation | Selection clears and never crosses context |
| Long output selection | SSE flood | No pathological per-tick scanning or visible stalls |
| Mobile long-press selection | Live updates | Selection is not destroyed by rerender |

The current happy-path test—plain text, one surface, programmatic forward selection, single-part settlement—is useful but insufficient.

## Acceptance criteria

1. A non-collapsed highlight in unchanged main output remains visible for at least 30 seconds under active polling and high-cadence SSE updates.
2. A real pointer drag is never interrupted by removal of its anchor/focus nodes.
3. Established selections do not expire on a timeout.
4. Normal, compact, and thinking output use the same mutation policy.
5. Streaming settlement preserves bubble identity whenever authoritative content agrees.
6. Cross-message and multi-part selections are either preserved or explicitly documented/tested as invalidated; no silent accidental reset remains.
7. Authoritative text changes and navigation still win and never restore stale text.
8. Chat scroll/follow behavior, search, tool disclosures, copy actions, ARIA semantics, and mobile behavior remain correct.
9. Per-tick work stays bounded; no full-message string scan occurs when no selection is active.
10. Completed keyed Markdown block nodes retain object identity through append-only streaming and authoritative no-op refreshes.
11. A source contract rejects unapproved direct `replaceChildren`, `replaceWith`, `innerHTML`, or destructive `textContent` mutations beneath `#chat`.
12. Any Idiomorph adoption passes the complete arbitrary-document-selection matrix; input-focus preservation alone is insufficient.
13. `npm test`, the complete browser suite, and repeated selection stress runs pass.

## Proposed file boundaries

Likely production changes:

- `public/app.js` — controller integration and temporary migration call sites
- `public/transcript-renderer.mjs` — mutation coordinator, stable ownership, selection policy
- optionally `public/transcript-selection.mjs` — pure semantic snapshot/matching logic if separation improves executable tests

Likely test changes:

- `tests/browser/interaction-continuity.spec.mjs`
- a dedicated `tests/browser/transcript-selection-continuity.spec.mjs` if the matrix grows
- `tests/interaction-state-stability-static.test.mjs`
- `tests/streaming-ui-coupling.test.mjs`
- fake Pi fixtures for compact, multi-part, Mermaid, drag timing, and SSE flood cases

No server endpoint, data migration, service restart, or framework dependency should be required.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Large refactor inside a heavily coupled `app.js` | Extract only the transcript mutation gateway first; migrate one renderer at a time |
| Stale visual output while selection is held | Keep completed keyed blocks live; defer only an intersecting destructive tail patch during the drag gesture; prototype continuation zones only if required |
| Morphing library preserves controls but not arbitrary ranges | Require the full browser-selection matrix before adopting Idiomorph; retain semantic bookmarks as fallback |
| Wrong selection restoration into duplicate text | Require exact semantic message/surface identity, not global text search |
| Authoritative divergence | Invalidate explicitly; never fuzzy-match or resurrect old text |
| Scroll/follow regressions | Keep scroll intent outside the mutation coordinator and run existing plus new stress tests |
| ARIA live-region regressions | Prefer in-place updates; verify announcements and avoid repeated node reattachment |
| Browser engine differences | Add Chromium first, then WebKit when host libraries are available |
| Performance regression | Instrument mutation count, selected-range scan cost, and frame duration under SSE flood |

## Decision and next step

**Recommended decision:** approve a staged transcript-renderer refactor through Phases 0–2. Treat Phase 3 as a separately reviewed extension after the core is stable.

Online evidence confirms that the core direction is state of the art: keyed identity, surgical DOM patching, stable completed blocks, and transaction-mapped semantic selection. The WebUI-specific coordinator is an implementation boundary for those established patterns, not a novel rendering paradigm.

Do not continue adding isolated selection-restoration patches as the primary strategy. One tactical parity pass is justified, but the durable fix is stable keyed block ownership plus a single transaction/commit gateway.

Run the Idiomorph settled-block prototype in Phase 1, but keep dependency adoption contingent on the behavioral matrix. Use Streamdown and ProseMirror as design references rather than runtime dependencies.

Before implementation, confirm one product-scope decision:

> Should durable selection cover only assistant/thinking output first, or all selectable transcript content including tools and cross-message ranges?

Recommended default: **assistant + thinking + tool output in the core contract, with cross-message ranges delivered in Phase 3.**

## Online sources

Primary and official sources, accessed 2026-08-01:

- **[S1] Livewire 4 Morphing:** surgical DOM changes preserve unchanged elements, focus, and input state. <https://livewire.laravel.com/docs/4.x/morphing>
- **[S2] Turbo — Smooth page refreshes with morphing:** Turbo uses Idiomorph, preserves unchanged screen state, supports permanent regions, and separately preserves scroll. <https://turbo.hotwired.dev/handbook/page_refreshes>
- **[S3] Idiomorph repository and implementation:** ID-set DOM morphing, node-retention callbacks, 0BSD license, and input/textarea-focused `restoreFocus` behavior. <https://github.com/bigskysoftware/idiomorph> and <https://github.com/bigskysoftware/idiomorph/blob/main/src/idiomorph.js>
- **[S4] morphdom:** real-DOM morphing minimizes changes to preserve internal node state such as scroll and input caret positions. <https://github.com/patrick-steele-idem/morphdom>
- **[S5] Phoenix LiveView 1.1:** keyed comprehensions and finer-grained change tracking reduce unnecessary list rerendering and DOM patch work. <https://phoenixframework.org/blog/phoenix-liveview-1-1-released>
- **[S6] Streamdown Memoization:** Markdown is split into memoized blocks; completed blocks remain stable and only changed blocks rerender. <https://streamdown.ai/docs/memoization>
- **[S7] Streamdown Unterminated Block Parsing:** incomplete streaming Markdown is normalized before block rendering. <https://streamdown.ai/docs/termination>
- **[S8] ProseMirror Guide:** all updates pass through transactions/update state; document structure is persistent and unchanged nodes are shared. <https://prosemirror.net/docs/guide/#state.transactions>
- **[S9] ProseMirror SelectionBookmark:** semantic selections can be mapped through changes and resolved against the new document. <https://prosemirror.net/docs/ref/#state.SelectionBookmark>
- **[S10] DOM Standard — live ranges:** boundary points are adjusted as nodes/character data are mutated or removed. <https://dom.spec.whatwg.org/#concept-range>
- **[S11] React — Preserving and Resetting State:** state preservation depends on stable identity and position; removal destroys state. <https://react.dev/learn/preserving-and-resetting-state>
- **[S12] htmx Idiomorph extension:** exposes real-DOM morphing specifically to reuse existing nodes across swaps. <https://htmx.org/extensions/idiomorph/>
- **[S13] Vercel AI Elements Message:** current AI chat components use keyed messages/parts and Streamdown for streaming Markdown. <https://ai-sdk.dev/elements/components/message>

Research limitations:

- No published benchmark directly measures native document-selection survival for this exact WebUI architecture.
- Idiomorph's official tests and implementation demonstrate focus/control-selection restoration, not a general guarantee for arbitrary `window.getSelection()` ranges.
- Candidate scores are qualitative architecture-fit scores, not fabricated performance measurements.
- Streamdown and ProseMirror were evaluated as pattern/reference implementations; direct integration is intentionally rejected.

## Local evidence sources

- `public/app.js`: `renderStreamingMarkdown`, `renderThinkingMarkdown`, `flushCompactLiveOutput`, `renderAllMessages`, `refreshMessages`, `updateLiveToolCard`, `renderMermaidDiagram`, and current chat selection helpers.
- `tests/browser/interaction-continuity.spec.mjs`: current single-surface stream-to-settlement happy path.
- `tests/interaction-state-stability-static.test.mjs`: current opt-in helper call-site contracts.
- `.pi-subagents/artifacts/outputs/31706ac4-3d40-4bd9-9706-c0af28f70909/context.md`: read-only mutation-path reconnaissance.
- `.pi-subagents/artifacts/fba8e032-bda6-4ede-8b89-b9ea2d93e81f_oracle_output.md`: architecture option analysis.
- `.pi-subagents/artifacts/b85f20be-a764-4042-809d-43aab40d8f6a_reviewer_output.md`: adversarial failure and test-gap review.

## Confidence

- **Industry-standard assessment: 96/100.** Multiple independent official implementations converge on stable keys, surgical patching, stable blocks, and transaction-based selection mapping.
- **Project recommendation: 94/100.** The recommended custom keyed block renderer best fits the current vanilla stack, while the Idiomorph prototype keeps the main dependency decision evidence-driven.

Confidence is reduced because no public benchmark covers this exact read-only streaming transcript selection problem, and several WebUI-specific failure modes—real pointer-drag interruption, multi-part settlement, Mermaid timing, and mobile long-press—still need runtime reproduction before implementation details are finalized.
