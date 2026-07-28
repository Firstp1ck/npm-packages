# Workflow Button Icon

**Status:** Implementation validated; independent review quorum blocked by provider availability  
**Classification:** Lightweight  
**Integration owner:** Main Pi agent  
**Report:** [Workflow Button Icon report](../../reports/workflow-button-icon.html)

## Classification rationale

The preliminary lightweight classification is confirmed by repository evidence. The change is confined to one existing composer control and its static contract: HTML markup, one width rule, removal of obsolete text mutation, a scoped tooltip-layer opt-out, and focused static tests. It introduces no new component boundary, API, persistence, migration, dependency, security-sensitive path, or rollout concern.

## Success criteria

- The Workflow Mode control renders a workflow-appropriate inline SVG instead of the visible `Workflow` label.
- The control uses the same `composer-icon-button` and `composer-icon` conventions as adjacent composer controls.
- The control keeps its existing toggle behavior, pressed state, active styling, capability gating, tooltip, and accessible name.
- Exactly one styled tooltip is shown: the composer pseudo-element tooltip, without the additional floating tooltip layer.
- The tooltip opens rightward from the left-side Workflow icon so it remains inside the window frame while its arrow stays centered on the icon.
- Focused static tests and JavaScript syntax validation pass.
- Two independent fresh-context reviewers assess the integrated diff, and all findings are dispositioned.

## Scope and non-goals

### In scope

- `public/index.html`: replace the label with a decorative inline workflow SVG and retain an accessible button name.
- `public/styles.css`: reduce the old text-button minimum width to the shared icon-button width.
- `public/app.js`: remove obsolete dynamic text mutation, preserve pending feedback, and let composer controls opt out of the floating tooltip layer when scoped CSS already renders their tooltip.
- `tests/mobile-static.test.mjs`: assert icon markup, accessibility, shared sizing, pending feedback, and single-tooltip behavior.

### Non-goals

- Changing Workflow Mode command behavior or status synchronization.
- Redesigning the active-state colors, overlay restore control, or composer layout.
- Introducing an icon library or runtime dependency.

## Design decisions and invariants

1. Use the existing 24×24, `currentColor`, 2px rounded-stroke inline SVG convention; a pair of linked nodes communicates orchestration without adding a dependency.
2. Mark the SVG `aria-hidden="true"` and keep the accessible name on the button. Runtime tooltip handling remains the source of the state-specific accessible label.
3. Preserve the existing element ID and event listener so behavior and state management remain unchanged.
4. Reuse `composer-icon-button` rather than introducing bespoke sizing or icon styles.
5. Keep `data-tooltip` for the existing composer pseudo-element styling, but pass `floating: false` so the same tooltip is not also rendered by the global floating-tooltip layer.
6. Anchor the tooltip panel at `left: 0` and center its arrow over the Workflow icon, matching the existing left-edge Git tooltip behavior.
7. Preserve all unrelated dirty-worktree changes.

## Execution and acceptance

1. Apply the focused markup, style, runtime cleanup, and static-test updates.
2. Run `node --check public/app.js` and `node tests/mobile-static.test.mjs`.
3. Inspect the scoped diff for write-boundary compliance.
4. Obtain two qualifying read-only reviews from providers distinct from each other and the implementation provider; disposition every finding below.
5. Save and link the final HTML report.

## Validation record

- `node --check public/app.js` — passed.
- Focused assertions covering icon markup, accessible naming, single-tooltip behavior, pending feedback, shared 2.9rem sizing, and removal of runtime text mutation — passed.
- `git diff --check` for all scoped implementation files — passed.
- Focused CSS assertions for rightward tooltip placement and centered arrow anchoring — passed.
- `node tests/mobile-static.test.mjs` — reached an unrelated pre-existing failure at the global typography-floor assertion because `public/styles.css:7343` contains `font-size: 0.72rem`; both that declaration and the failing assertion exist at `HEAD`. The Workflow Button assertions were also executed independently and passed.

## Review record

Primary implementation provider: `openai-codex/gpt-5.6-sol`.

| Reviewer run | Actual provider/model | Result | Findings and disposition |
|---|---|---|---|
| `10796325…` child 0 | OpenRouter / Moonshot Kimi K3 | Failed turn budget; non-qualifying partial pre-fix review | Pending-state feedback note **accepted**. Added `aria-busy` and a pending-specific tooltip, then reran focused checks successfully. |
| `10796325…` child 1 | OpenRouter / Moonshot Kimi K3 after Anthropic Opus 5 and 4.8 returned HTTP 429 | Completed pre-fix review; non-qualifying for final quorum | Same pending-state finding **accepted and fixed**. Redundant-width and verbose-label notes **rejected as defects**: the explicit width is a harmless local contract, and runtime tooltip labeling is existing intentional behavior. |
| `6b1b0a28…` child 0 | OpenRouter / Moonshot Kimi K3 | Completed final read-only review; **qualifying output 1** | Approved. Explicit-width note **rejected as a defect** because the declaration intentionally preserves the scoped sizing contract. Pending announcement caveat **deferred** as minor residual risk; disabled gating is pre-existing and the new tooltip/`aria-busy` improves it. |
| `6b1b0a28…` child 1 | LM Studio / Qwen 3.6 35B A3B | Connection error; non-qualifying | No findings produced. Local LM Studio was not listening on its configured `localhost:1234` endpoint. |
| `a5315c56…` child 0 | OpenRouter / Moonshot Kimi K3 after Anthropic Fable 5 and Opus 4.8 returned HTTP 429 | Completed final review, but duplicates output 1's provider and cannot satisfy provider diversity | Approved; informational pending and label notes **deferred/rejected as defects** for the same evidence above. |
| `a5315c56…` child 1 | OpenRouter / Moonshot Kimi K3 after Anthropic Opus 5 and 4.8 returned HTTP 429 | Failed turn budget; non-qualifying | Partial approval only; no new actionable finding. |

### Quorum status

The pre-correction implementation received one qualifying fresh-context, read-only reviewer output from OpenRouter/Moonshot. A second output from a provider distinct from both OpenRouter and the OpenAI Codex implementation provider could not be obtained: Anthropic attempts consistently returned account-level HTTP 429 rate-limit errors, and the configured LM Studio provider returned a connection error. The later single-tooltip correction has passed focused validation but has not received a qualifying provider-diverse review. The mandatory quorum therefore remains incomplete unless the user explicitly waives it or approves an alternative provider/path.

## Progress record

- 2026-07-25: Repository exploration located the button, shared SVG conventions, dynamic label mutation, style rule, and static assertions.
- 2026-07-25: Lightweight classification confirmed; no blocking product or architecture decisions identified.
- 2026-07-25: Implemented the inline icon, shared icon-button styling, obsolete-label cleanup, and focused regression assertions.
- 2026-07-25: Targeted checks passed; the broader static test remains blocked by a verified pre-existing typography-floor mismatch unrelated to this feature.
- 2026-07-25: Accepted independent feedback about the lost pending label cue; added `aria-busy` plus a pending-specific accessible tooltip and revalidated the scoped behavior.
- 2026-07-25: OpenRouter/Moonshot review approved the then-current integrated result. Anthropic reviews were unavailable due repeated HTTP 429 responses, and LM Studio was unavailable due a connection error, leaving the provider-diverse quorum blocked.
- 2026-07-25: User reported a duplicate tooltip. Root cause was simultaneous composer pseudo-element and global floating-tooltip rendering; added a scoped `floating: false` opt-out and focused regression assertions.
- 2026-07-25: User reported left-frame clipping. Anchored the tooltip panel to the icon's left edge so it opens rightward, retained the centered arrow, and passed focused placement assertions.
