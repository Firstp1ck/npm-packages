# Feature category input-frame tag

## Status

- Classification: **complex** (reclassified from the preliminary lightweight result)
- Rationale: the visible tag requires a new cross-package contract between `pi-extension-feature-system-prompt` and `pi-package-webui`, with independent producer and consumer behavior plus reconnect/tab-state handling.
- Integration owner: main Pi session
- State: implementation complete; validation and review gates passed
- Final report: [`../reports/feature-category-input-tag.html`](../reports/feature-category-input-tag.html)

## Goal and success criteria

Display the effective evaluator-assigned feature category in the Web UI composer frame beside the existing Follow-up/Steer and skill tags.

Success means:

1. The classifier extension emits a replayable RPC status after each resolved request classification.
2. Feature requests emit exactly `lightweight-feature` or `complex-feature`; non-feature, failed, reset, and unavailable classifications clear the status.
3. The Web UI consumes only the dedicated status key, keeps values isolated by terminal tab, and does not duplicate the category in the generic footer status area.
4. A hidden-until-used, accessible tag appears in `.composer-context-tags` and uses the exact category label.
5. SSE reconnects restore the latest category through the server's existing replayable `setStatus` mechanism.
6. Classifier tests, Web UI static tests, syntax checks, and package checks pass without regressing pre-existing worktree changes.

## Scope

### In scope

- `pi-extension-feature-system-prompt/feature-system-prompt.ts`
- `pi-extension-feature-system-prompt/tests/feature-system-prompt.test.ts`
- `pi-extension-feature-system-prompt/README.md`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/tests/mobile-static.test.mjs`
- This plan and `pi-package-webui/reports/feature-category-input-tag.html`

### Non-goals

- Changing evaluator taxonomy or classification decisions.
- Adding a category selector or allowing users to override evaluator output.
- Rendering all non-feature request kinds.
- Adding a new Web UI server endpoint or persistence store.
- Reformatting or reverting unrelated dirty-worktree changes.

## Approved design decisions and invariants

1. **Transport:** use Pi's replayable RPC `ctx.ui.setStatus()` contract with an exported dedicated key, rather than adding model-context messages or a new HTTP endpoint.
2. **RPC-only emission:** the extension emits UI status only in RPC mode so native TUI layout is unchanged.
3. **Payload:** status text is the exact bounded label `lightweight-feature` or `complex-feature`; absence clears the status.
4. **Effective classification:** known feature continuations retain and emit the inherited feature category; non-features clear it.
5. **Frontend isolation:** store the category by tab ID and render only the active tab's normalized value.
6. **Generic status suppression:** the dedicated category status is consumed before insertion into `statusEntries`, preventing a duplicate footer item.
7. **Reconnect behavior:** rely on the Web UI server's existing `extensionStatuses` retention and SSE replay.
8. **Safety:** edits must be targeted because all implementation files already contain unrelated uncommitted work.

## Execution DAG

```text
W1 classifier status producer
        |
        v
W2 Web UI status consumer + tag
        |
        v
Integration checks
        |
        v
Independent reviewer quorum
        |
        v
Accepted fixes, final checks, HTML report
```

## Workstreams

| ID | Owner | Prerequisites | Exact write boundary | Deliverable | Validation | Handoff |
|---|---|---|---|---|---|---|
| W1 | Implementation worker 1 | This plan; current classifier source/tests | `pi-extension-feature-system-prompt/feature-system-prompt.ts`, `tests/feature-system-prompt.test.ts`, `README.md` only | RPC-only replayable feature-category status emission with reset/failure clearing | `npm test`, `npm run check`, `npm run smoke` in classifier package | `/tmp/feature-category-input-tag-w1.md` |
| W2 | Implementation worker 2 | W1 contract and handoff | `pi-package-webui/public/index.html`, `public/app.js`, `public/styles.css`, `tests/mobile-static.test.mjs` only | Per-tab category status consumption and accessible input-frame tag | targeted static test and syntax check | `/tmp/feature-category-input-tag-w2.md` |
| INT | Integration owner | W1 and W2 inspected | Plan/report plus accepted targeted fixes only | Integrated verification, review dispositions, final report | both package checks and diff inspection | This plan and final report |

Workers must not edit this plan, reports, package manifests, lockfiles, server code, or one another's files. Unapproved product, interface, dependency, security, migration, or ownership decisions are stop conditions.

## Acceptance checks

- `npm test` in `pi-extension-feature-system-prompt`
- `npm run check` in `pi-extension-feature-system-prompt`
- `npm run smoke` in `pi-extension-feature-system-prompt`
- `node --check public/app.js` in `pi-package-webui`
- `node tests/mobile-static.test.mjs` in `pi-package-webui`
- `npm run check` in `pi-package-webui`
- `git diff --check` limited to feature files
- Strict HTML report validation

## Integration and rollback

Integration is direct because both workstreams run sequentially in the same dirty worktree with disjoint write boundaries. The integration owner will inspect exact diffs and preserve all pre-existing changes. Rollback consists of removing only the dedicated status emission, tag markup/styles/state handling, focused tests/docs, and this feature's plan/report; unrelated worktree changes must remain untouched.

## Risks

| Risk | Mitigation |
|---|---|
| Existing dirty files are overwritten | Exact targeted edits, pre/post diff inspection, no broad rewrites |
| Category leaks into generic footer | Consume and return before generic `statusEntries` logic |
| Wrong tab shows the tag | Per-tab map keyed by status event `tabId`; rerender on tab switch/removal |
| Reconnect loses the category | Existing server status retention/replay is reused and covered by contract evidence |
| Classification failure leaves a stale feature tag | Explicit clear on reset, non-feature, no-model, invalid-output, and exception paths |
| Extension changes native TUI presentation | Emit only when `ctx.mode === "rpc"` |

## Progress record

- Repository exploration located the composer tag strip and classifier injection path.
- Evidence contradicted the preliminary lightweight classification because implementation crosses a package/runtime UI contract; classification changed to complex before implementation.
- The worktree was found dirty with unrelated classifier and Web UI changes; preservation is an explicit invariant.
- W1 completed in chain run `76b944f6-3aa5-4c13-ab18-b9661dbdad46` and delivered `/tmp/feature-category-input-tag-w1.md`; classifier tests/check/smoke passed.
- W2 completed in the same sequential chain and delivered `/tmp/feature-category-input-tag-w2.md`; focused and full Web UI checks passed.
- Integration-owner checks passed after implementation and again after the accepted reconnect fix.
- Final report saved at [`../reports/feature-category-input-tag.html`](../reports/feature-category-input-tag.html).

## Review record

### Qualifying quorum

| Reviewer | Run identity | Model/provider | Verdict | Confidence |
|---|---|---|---|---|
| R1 | `aef5729e-f799-4dc5-978d-0cd3589c1627`, child 0 | `anthropic/claude-opus-4-8:high` | Approve with one reconnect note | 80/100 |
| R2 | `7c02279d-34f9-436d-86ed-08fcf42b02f9`, child 1 | `openrouter/deepseek/deepseek-v4-flash:high` | Approve; no blockers | 95/100 |

The OpenAI Codex implementation provider differs from both qualifying reviewer author/provider families. An earlier R1 attempt exceeded its turn budget and did not count; the fresh successful Anthropic replacement above is the qualifying result.

### Finding dispositions

| ID | Finding | Disposition | Evidence and rationale |
|---|---|---|---|
| R1-F1 | Background feature→non-feature transition could leave a stale client label because cleared server statuses are omitted from additive replay. | **Accepted and fixed** | `webui_connected` now deletes the connected tab's cached category and rerenders before retained statuses replay. Focused static and all 41 Web UI checks pass. |
| R1-F2 | Reconnect-absence reconciliation lacked a focused assertion. | **Accepted and fixed** | `mobile-static.test.mjs` now requires feature-category cache deletion/rerender in the reconnect branch. |
| R1-N3 | Inactive-tab handler lacks a feature-category branch. | **Rejected as an independent defect** | The category is an active-composer affordance; reconnect clearing fixes the actual stale path without new inactive-tab behavior. |
| R2-N2 | Tab cleanup performs an idempotent duplicate map deletion. | **Rejected** | Harmless defensive cleanup across separate teardown paths; no material benefit from changing it. |
| R2-N3 | Lightweight category has no dedicated CSS override. | **Rejected** | Base teal styling intentionally represents lightweight; complex has the distinct stronger style. |
| R2-N4 | Existing context tags may face pressure when every chip is visible on narrow screens. | **Deferred / out of scope** | No feature-specific overflow was reproduced; live browser visual verification remains a disclosed limitation. |
| R2-N5/N6 | Replay tab routing and null-tab guard observations. | **Accepted as correct** | Server replay carries the tab ID; active-only rendering and the null guard match the approved design. |

## Final validation evidence

- Classifier package: 16/16 tests passed; syntax check and import smoke passed.
- Web UI package: focused mobile/static test passed; all 41 test files passed, with the Windows-only harness skipped as expected.
- `git diff --check` passed on feature paths.
- Live browser visual/SSE automation was not available; reconnect behavior is covered by source contract and static integration assertions.
