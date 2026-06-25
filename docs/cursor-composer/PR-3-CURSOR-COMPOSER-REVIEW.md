# PR 3 Cursor Composer truncation review

## Recommended implementation (authored before detailed PR implementation inspection)

Premise inferred from the checked-out commit title and changed-file list: the Cursor Composer provider can serialize large Pi tool results into the prompt sent to Cursor Composer, causing excessive context usage, latency/cost, or context-window failures.

Recommended approach:

1. **Keep the fix at the provider-context boundary.**
   - Direct `/cursor-composer` and `cursor_composer_agent` result output already has a separate return-path truncation concern.
   - The bug premise is about *outgoing* Pi conversation/tool-result context sent into Cursor, so truncation should happen inside provider context serialization before `runCursorComposer()` receives `promptText`.

2. **Extract serialization into a small pure module with tests.**
   - Move `contentToText()` and `serializeProviderContext()` out of `index.ts` into `context.ts`.
   - Keep the module side-effect-free so tests can cover serialization without loading the Cursor SDK or Pi extension runtime.

3. **Apply targeted truncation to `toolResult` content.**
   - Use the same Pi truncation primitives already used by the extension (`truncateHead`, `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES`, `formatSize`) for consistency.
   - Truncate each tool-result text block after converting its structured content to text.
   - Append an explicit marker that states original vs retained lines/bytes so Cursor knows context was omitted.
   - Do not truncate normal user/assistant/system content with the same aggressive limits unless a separate total-context budget is introduced.

4. **Preserve semantic context where possible.**
   - Keep role headings and tool names.
   - Preserve non-text block handling: text, thinking, tool-call arguments, image omission, and unknown JSON-ish blocks.
   - Prefer deterministic behavior and stable output for tests.

5. **Make limits configurable only if needed, with safe defaults.**
   - Defaults should match Pi's established tool-output limits.
   - Optional environment overrides are acceptable if validated as positive finite integers and documented, but they are not required for the first fix.

6. **Testing and validation expected.**
   - Unit tests for large tool-result truncation, small tool-result pass-through, role headings/tool names, structured content conversion, and no accidental truncation of normal user text.
   - A lightweight smoke/benchmark script is useful only if it does not become a required package runtime dependency.

Recommended shape:

```ts
// context.ts
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";

export function contentToText(content: unknown): string { /* existing conversion */ }

export function truncateToolResultText(text: string): string {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return truncation.content;
  return `${truncation.content}\n\n[Tool result truncated for Cursor Composer context: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
}

export function serializeProviderContext(context: Context): string {
  const lines: string[] = [];
  // preserve system/task/conversation headings
  for (const message of ((context as any).messages ?? []) as any[]) {
    if (message.role === "toolResult") {
      lines.push(
        `## toolResult ${message.toolName ?? "tool"}`,
        truncateToolResultText(contentToText(message.content)),
        "",
      );
    } else {
      lines.push(`## ${message.role ?? "message"}`, contentToText(message.content), "");
    }
  }
  return lines.join("\n").trim();
}
```

## Comparison and PR assessment

### Evidence reviewed

I did not read the full GitHub PR text. I checked out PR 3 via the GitHub pull ref because `gh` is unavailable in this environment, then inspected only the affected implementation files and targeted diffs.

Base behavior on `origin/main` fully replays tool results into the Cursor provider prompt:

- `origin/main:pi-extension-cursor-composer/index.ts:670-689` builds provider context.
- `origin/main:pi-extension-cursor-composer/index.ts:682-684` serializes every `toolResult` with `contentToText(message.content)` and no truncation.

PR behavior:

- `pi-extension-cursor-composer/index.ts:20` imports `serializeProviderContext` from `context.ts`.
- `pi-extension-cursor-composer/index.ts:696` applies serialization before calling Cursor.
- `pi-extension-cursor-composer/context.ts:67-80` reads truncation config from env.
- `pi-extension-cursor-composer/context.ts:150-168` truncates large tool-result content and adds metadata/instructions.
- `pi-extension-cursor-composer/context.ts:189-195` applies that only to `toolResult` messages.

### Recommendation vs PR implementation

| Area | Recommended | PR implementation | Assessment |
|---|---|---|---|
| Boundary | Truncate outgoing native-provider prompt context, not direct command/tool return path | Does this in `serializeProviderContext(context)` before `runCursorComposer()` | Matches |
| Module shape | Extract pure serialization module | Adds `context.ts` with pure helpers and unit tests | Matches |
| Scope | Target `toolResult`; preserve normal conversation content | Only `toolResult` uses `serializeToolResultContent`; other roles still use `contentToText` | Matches |
| Transparency | Include truncation marker and original/included sizes | Adds explicit marker, original lines/bytes, included preview, and re-read/rerun instruction | Matches, good |
| Defaults | Prefer existing Pi truncation constants/utilities unless there is a reason not to | Reimplements byte/line preview with custom defaults: 32 KB / 500 lines | Valid, but more maintenance drift than recommended |
| Config | Optional safe env overrides | Adds `CURSOR_COMPOSER_PROVIDER_TRUNCATE_TOOL_RESULTS`, `...MAX_BYTES`, `...MAX_LINES` | Matches |
| Tests | Unit tests for small/large/disabled/limits | Adds four offline tests covering those paths | Matches, adequate first coverage |
| Docs | Document behavior and opt-out | README documents default, opt-out, tuning, tests, smoke/benchmark | Matches, with one packaging caveat below |

### Validation run

Commands run:

```bash
cd pi-extension-cursor-composer
npm install --ignore-scripts
npm test
npm run smoke:cursor
npm run benchmark:cursor
git diff --check origin/main...HEAD
npm pack --dry-run
npm audit --omit=dev --json
```

Results:

- Unit tests: **pass** (`4/4`).
- Dry smoke: baseline `131298` prompt bytes, optimized `8916` prompt bytes, **93.2% reduction**.
- Dry benchmark: baseline `32288` prompt bytes, optimized `3388` prompt bytes, **89.5% reduction**.
- `git diff --check`: **pass**.
- `npm pack --dry-run`: runtime tarball includes `index.ts`, `context.ts`, `README.md`, `LICENSE`, `package.json`.
- `npm audit --omit=dev`: reports existing production dependency chain vulnerabilities through `@connectrpc/connect-node -> undici`; not caused by the truncation code, but the new package lock makes the vulnerable resolution explicit.

### Implications

Positive:

- The premise is valid: the previous provider serializer could resend arbitrarily large prior Pi tool results to Cursor on every provider turn.
- The PR materially reduces prompt size for large tool-result histories, which should reduce cost, latency, context pressure, and failure risk.
- The opt-out env var preserves old behavior when exact replay is more important than prompt size.
- The marker text tells Cursor that content was omitted and suggests re-reading/rerunning, reducing silent context loss.

Trade-offs / risks:

1. **Information loss is intentional.** If a later turn depends on exact old tool output and the file/command cannot be reconstructed, Cursor may need to ask or may answer with incomplete evidence.
2. **Head-only preview may be less useful for some tools.** For `read`, head preview is often reasonable; for `bash`, tail output often contains final errors/results. A future improvement could choose head/tail by tool name or preserve both head and tail.
3. **No total-context budget.** Each large `toolResult` is capped, but many capped tool results can still accumulate. This PR fixes the main unbounded single-result premise, not whole-conversation budgeting.
4. **Custom truncation duplicates Pi utilities.** The code is valid, but using `truncateHead`/`formatSize` from Pi would avoid drift and align with established defaults/Unicode behavior.
5. **Status command env parsing mismatch.** `context.ts` treats `0`, `false`, `no`, and `off` as disabling truncation, but `cursor-composer-status` only displays `off` for exactly `"false"` (`index.ts:972`). This can show misleading status for `0/no/off`.
6. **Published package docs/scripts mismatch.** `package.json` defines test/smoke/benchmark scripts, and README documents them, but `files` excludes `tests/` and `scripts/`. Source checkout works; an npm tarball consumer sees scripts pointing to missing files. Either include dev files in `files` or keep the docs clearly source-repo-only.
7. **Audit finding remains.** `@connectrpc/connect-node` pulls a vulnerable `undici` version under the generated lock. This appears pre-existing from the direct dependency, but it is still a release hygiene issue.

### Validity verdict

The PR implementation is **valid and directionally correct** for the stated premise. It fixes the key bug by truncating large prior `toolResult` content before native Cursor provider calls, while preserving role structure and giving the model explicit truncation metadata.

I would not reject the PR on premise or architecture. I would request small follow-up changes before merge if the bar is strict:

1. Reuse Pi's existing truncation helpers, or document why the provider needs custom 32 KB / 500-line defaults.
2. Make `/cursor-composer-status` use the same env parser as serialization.
3. Decide whether `tests/` and `scripts/` should be published or remove/qualify the README/package scripts for tarball users.
4. Track the `@connectrpc/connect-node` / `undici` audit issue separately.

If those are considered non-blocking, the PR can be merged with follow-up issues.

## Questions for improvement and unclear implementation details

### Blocking / merge-decision questions

1. **What exact failure mode triggered the PR?**
   - Was the observed issue cost/latency, Cursor context overflow, degraded answer quality, SDK request failure, or all of these?
   - Do we have a representative conversation/tool-result size that reproduces it?

2. **Why are the new defaults `32_000` bytes and `500` lines?**
   - Are these empirically chosen from Cursor usage data?
   - Should they instead reuse Pi's established `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` so provider behavior stays consistent with other tool output limits?

3. **Is head-only preview acceptable for every tool result?**
   - `read` output often benefits from head preview, but `bash` output often needs tail errors/results.
   - Should truncation preserve head + tail, or choose strategy by `toolName`?

4. **Should this fix include a total provider-prompt budget?**
   - The PR caps individual tool results, but many capped results can still accumulate.
   - Is per-result truncation enough for the current bug, or should there be a whole-conversation budget as well?

5. **Should exact historical tool output ever be recoverable?**
   - If Cursor needs omitted content, should the prompt only instruct it to re-read/rerun, or should Pi preserve references to full output files when available?

### Implementation correctness questions

6. **Can `/cursor-composer-status` share the same env parser as `context.ts`?**
   - `context.ts` treats `0`, `false`, `no`, and `off` as false.
   - `index.ts` currently displays truncation as off only for exactly `"false"`.

7. **Should `serializeProviderContext` keep the stricter `Context` type?**
   - The PR changes the serializer to accept `unknown`, which helps testing, but weakens type signaling.
   - Would `Context | ProviderContextSerializationOptions` test helpers be cleaner?

8. **Should custom byte/line truncation be replaced with `truncateHead`?**
   - Current custom implementation allows partial last lines and uses `Buffer` directly.
   - Pi's helper has established Unicode/line behavior and formatting conventions.

9. **Should truncation metadata be shorter?**
   - The marker is clear but adds repeated instruction text for every truncated result.
   - Would a shorter marker reduce prompt overhead while staying understandable?

10. **Should non-text structured tool results be truncated before or after JSON pretty-printing?**
    - Current behavior converts to pretty JSON first, then truncates.
    - Is that intended for very large JSON tool outputs, or should structured summaries be handled differently?

### Packaging / release questions

11. **Should `tests/` and `scripts/` be included in the published package?**
    - `package.json` exposes `test`, `smoke:cursor`, and `benchmark:cursor`, and README documents them.
    - `files` currently publishes only runtime files, so those scripts are missing in the npm tarball.

12. **Is adding `package-lock.json` intended for this package?**
    - Some packages in the monorepo have locks and some may not.
    - If included, should the lock be refreshed in a way that avoids incidental metadata drift?

13. **How should the `@connectrpc/connect-node -> undici` audit finding be handled?**
    - It appears unrelated to this PR's truncation logic, but the new lock makes the resolution explicit.
    - Should this PR leave it alone, or should a separate dependency-upgrade issue be opened before release?

### Test / benchmark questions

14. **Do we need an offline test for normal user/assistant content not being truncated?**
    - Current tests cover small/large tool results and disabled truncation.
    - A direct regression test would protect the targeted scope.

15. **Do we need a test for env parsing?**
    - Especially values `0`, `false`, `no`, `off`, invalid numbers, and positive integer overrides.

16. **Should the benchmark measure answer quality, not only prompt bytes/usage?**
    - Dry reduction is strong, but truncation can affect correctness.
    - A benchmark should ideally verify that required evidence remains recoverable or re-readable.

17. **Should live smoke/benchmark default to `plan` mode everywhere?**
    - Smoke uses `plan`, but benchmark creates the agent/run in `agent` mode while instructing not to modify files.
    - Is that intentional, or should the benchmark avoid edit-capable mode by default?

### Product behavior questions

18. **Should truncation be visible to the user in the Pi UI or only in Cursor's prompt?**
    - Current visibility is mostly prompt-internal plus `/cursor-composer-status`.
    - Would a diagnostic/event be useful when truncation occurs?

19. **Should users be warned when disabling truncation?**
    - `CURSOR_COMPOSER_PROVIDER_TRUNCATE_TOOL_RESULTS=false` can restore high-cost/high-context behavior.
    - Should status or docs explicitly warn about cost/context implications?

20. **Should this behavior apply only to native model-provider turns?**
    - The direct `cursor_composer_agent` tool already truncates its return output.
    - Confirm that no direct-command path should use the new context serializer.
