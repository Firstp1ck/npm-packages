# Image Payload Error Hardening

Related report: [Image Payload Error Hardening report](../reports/image-payload-error-hardening.html)

## Objective and success criteria

Make malformed image payload failures visible in the WebUI transcript and reject malformed browser-supplied base64 before it reaches Pi/Codex.

Success criteria:

- A malformed image returned by a tool is surfaced immediately as a visible transcript diagnostic with actionable recovery guidance.
- If Pi emits only an `agent_end` error message, the provider error is still surfaced even when `message_end` was absent.
- WebUI attachment and inline-image endpoints accept canonical base64 and reject non-canonical or malformed payloads with HTTP 400 before RPC dispatch or file creation.
- The already-corrected workbook renderer source remains covered by its canonical PNG regression test.
- Focused checks, two qualifying independent reviews, and this linked HTML report are completed.

## Scope and non-goals

In scope:

- `pi-package-webui/public/app.js` runtime diagnostics for malformed tool image blocks and `agent_end` fallback errors.
- `pi-package-webui/bin/pi-webui.mjs` canonical base64 validation at browser-controlled attachment/image boundaries.
- Focused WebUI tests plus verification of the existing workbook-render canonical-base64 test.

Non-goals:

- Rewriting or mutating persisted Pi session history.
- Silently dropping tool-result images from model context.
- Publishing or globally installing package updates.
- Changing Pi core/provider serialization in vendored dependencies.

## Root cause and evidence

- The failing sessions contain `workbook_render` tool-result image blocks whose `data` begins with comma-separated PNG byte values (`137,80,78,71,...`) rather than base64. Codex rejects these in function-call output as invalid `image_url` data URLs.
- The repository source already fixes the workbook producer with `Buffer.from(png).toString("base64")` and tests canonical round-tripping. The locally installed `@firstpick/pi-extension-workbook@0.1.1` still uses `png.toString("base64")` on a `Uint8Array`, so installation/publication lag can reproduce the defect.
- WebUI source handled streaming and `message_end` provider errors, but had no malformed tool-image warning and no `agent_end.messages` fallback when a terminal message event was missed.
- Server-side browser image validation checked the alphabet only; Node's permissive decoder could accept non-canonical encodings that Codex rejects.

## Approved decisions and architecture

- Treat the workbook serializer fix as the producer-level resolution; do not duplicate or revert it.
- Add a WebUI diagnostic guard at `tool_execution_end` so invalid tool image blocks become visible before or alongside the provider failure.
- Add an `agent_end.messages` fallback for the terminal assistant error, guarded per agent run to avoid duplicating a normal `message_end` diagnostic.
- Validate base64 by strict alphabet/padding plus decode-and-reencode equality. Browser-supplied invalid data is a client error and returns HTTP 400.
- Preserve source image bytes and MIME types unchanged when validation passes.
- One integration owner edits the shared worktree; reviewers are read-only.

### Failure flow

`tool result image → WebUI format check → visible warning`

`next Codex request → provider error → message_end diagnostic OR agent_end fallback`

`browser attachment/image → canonical base64 gate → reject 400 OR forward unchanged to Pi`

## Implementation map

- `bin/pi-webui.mjs`
  - `decodeCanonicalBase64`: strips an optional data-URL envelope/whitespace, requires canonical length/alphabet/padding, decodes, and verifies decode/re-encode equality.
  - `decodeAttachmentData`: routes uploads through the canonical gate.
  - `normalizeRpcImages`: validates MIME and canonical data, uses exact decoded byte sizes, and forwards valid payloads unchanged.
- `public/app.js`
  - `toolImagePayloadError`: detects malformed image blocks in tool results without echoing payload contents.
  - `assistantErrorFromAgentEnd`: reads the last assistant message in `agent_end.messages` and returns only terminal provider errors.
  - `handleEvent`: resets/deduplicates run error reporting, surfaces `agent_end` fallback errors, and warns on malformed tool images.
- `tests/image-payload-hardening-harness.test.mjs`
  - Focused real-server/fake-Pi coverage for comma-byte, unpadded, malformed-upload, and canonical forwarding cases.
- `tests/http-endpoints-harness.test.mjs`
  - Integrates the same transport contract into the broader endpoint harness.
- `tests/runtime-error-visibility.test.mjs`
  - Structural regression assertions for malformed tool-image diagnostics and the `agent_end` fallback.
- `tests/fixtures/fake-pi.mjs`
  - Records RPC images so tests can prove invalid payloads were blocked and valid payloads remained unchanged.

## Work items and dependencies

1. [x] Add canonical server base64 validation and focused endpoint coverage.
2. [x] Add malformed tool-image and `agent_end` fallback diagnostics with regression assertions.
3. [x] Run focused and package checks; record unrelated/environmental failures.
4. [x] Obtain and disposition two independent cross-provider reviews.
5. [x] Evaluate every finding, rerun affected checks, and finalize this plan/report pair.

Dependency order: server/client hardening → focused tests → independent reviews → finding disposition → final checks/report. No concurrent writers were used.

## Acceptance tests and results

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js bin/pi-webui.mjs tests/fixtures/fake-pi.mjs` | Pass | Exit 0. |
| `node tests/runtime-error-visibility.test.mjs` | Pass | `runtime error visibility test passed`. |
| `node tests/image-payload-hardening-harness.test.mjs` | Pass | `image payload hardening harness passed`; invalid payloads returned 400 and never reached fake Pi, while canonical PNG data was forwarded unchanged. |
| Workbook extension test | Pass | `npm test -- --test-name-pattern=...`: 24 tests passed, including canonical cold/cached PNG serialization. |
| `git diff --check -- pi-package-webui` | Pass | No whitespace errors. |
| `npm run check` in `pi-package-webui` | Partial, unrelated environment failures | Image hardening tests passed. 37/39 test files passed; `http-endpoints-harness.test.mjs` later failed on Windows `EBUSY` cleanup and `staged-content-hash-contract.test.mjs` failed because symlink creation was denied (`EPERM`). |
| Direct broad HTTP harness retry | Partial, unrelated environment failure | Image assertions occur before the later Git fixture; two runs failed on Windows `EBUSY` while removing `merge-conflict`. The dedicated focused harness passed independently. |
| `npm run check` in `pi-extension-workbook` | Blocked by dependency environment | TypeScript could not resolve `@earendil-works/pi-coding-agent` from sibling `pi-utils`, plus its downstream implicit-any diagnostic. Runtime extension tests passed. |
| HTML report strict validation | Pass | Bundled `validate_report.py --strict` completed successfully after report generation. |

## Independent review trace

### Reviewer A — Anthropic

- Run: `3798f6a5-1cd4-49ae-ae97-df8b3d4bd6af`, agent index 0.
- Model: `anthropic/claude-opus-4-8:high`.
- Provider/model family: Anthropic / Claude.
- Acceptance: checked; verdict **approve**.
- Evidence: inspected plan, diff, Pi type declarations, canonical-base64 logic, event sequencing, and focused tests.

### Reviewer B — DeepSeek

- Run: `3798f6a5-1cd4-49ae-ae97-df8b3d4bd6af`, agent index 1.
- Model: `openrouter/deepseek/deepseek-v4-pro:high`.
- Provider/model family: OpenRouter gateway / DeepSeek.
- Acceptance: checked; verdict **approve**.
- Evidence: independently inspected the plan/diff, adversarial encodings, browser compatibility, lifecycle/deduplication, endpoint behavior, and focused tests.

The reviewers were separately instantiated, fresh-context, read-only runs from provider families distinct from the OpenAI implementation model and from each other. Neither saw the other's result before completing.

## Reviewer findings and dispositions

1. **Low: image file-count and size-limit errors still default to HTTP 500. — Deferred.** Verified at adjacent pre-existing `throw new Error(...)` sites. This feature's approved scope is malformed/canonical base64 plus MIME validation; changing all upload-limit status semantics is a separate API cleanup. Recommended follow-up: use 400 for count and 413 for decoded size limits with dedicated tests.
2. **Low: a tool image containing a full data URL would trigger the malformed-image warning. — Rejected as a defect.** Pi's `ImageContent` contract stores raw base64 in `data` with MIME in `mimeType`. Pi's provider adapter itself prepends the data-URL envelope; accepting an already-prefixed value would produce a nested invalid URL and Codex would reject it. Warning is therefore correct.
3. **Low: `assistantErrorSurfacedThisRun` is module-global rather than per-tab. — Rejected as a regression.** Active-tab filtering and the existing global streaming state (`streamProviderErrorText`, `streamMessageActive`) use the same single active transcript model. No reproduction showed cross-tab suppression. A per-tab stream-state redesign is outside scope.
4. **Low: browser `atob` + `btoa` round-trip costs memory for large tool images. — Deferred.** The check is bounded to image blocks and runs once at tool completion; no performance failure was observed. Replace it with lexical pad-bit validation only if profiling shows material main-thread impact.
5. **Info: `Array.prototype.findLast` requires a modern browser. — Accepted, no code change.** The package targets current browsers and already requires modern APIs; the server requires Node 22+. The method is supported by the target browser generations.
6. **Info: plan/report status was stale during review. — Accepted and fixed.** This final plan and linked report now contain completed work items, evidence, reviewer trace, dispositions, and residual risks.

No reviewer finding required a source-code fix. Focused checks were rerun after review; they remained green.

## Residual risks and rollout guidance

- WebUI can warn about malformed historical/tool-produced image content but cannot safely rewrite an existing Pi session. Upgrade the producing extension, then fork before the malformed tool result or start a new session.
- The corrected workbook renderer exists in repository source, but the observed local `@firstpick/pi-extension-workbook@0.1.1` installation is stale. Publishing/installing an updated package is intentionally outside this task and remains required for producer-level rollout.
- Static client tests verify handler structure, while the focused harness verifies HTTP/RPC behavior. A real-browser automation test for transcript rendering was not available.
- Strict canonical validation intentionally rejects previously tolerated unpadded base64. Browser `FileReader` produces canonical padded base64.
- Existing unrelated Windows cleanup/symlink and workbook TypeScript dependency issues keep the broad package checks from being completely green; none occurred in the focused image-path checks.

## Review status

- Implementation: complete.
- Focused verification: complete.
- Qualifying independent review gate: complete (Anthropic + DeepSeek).
- Finding disposition: complete; no accepted source fix was necessary.
- Report: complete and strictly validated.
- Feature status: complete within approved scope; producer package publication/installation remains an explicit rollout follow-up.
