# Review of architecture step 4

**Scope reviewed:** Step 4 ("shared headless core for Qt WebUI and Pi WebUI") in `pi-package-qt-webui/plans/planned/qt-webui-architecture-refactor.md` (lines ~455–556), read against the full plan, the Qt WebUI sources (`lib/backend/resources.mjs`, `lib/backend/sampling.mjs`, `lib/backend/protocol.mjs`, `lib/pi-extension/qt-webui-helper.mjs`, `tests/package-contract.test.mjs`, `tests/packed-install.test.mjs`), the Pi WebUI sources (`lib/resource-selection.mjs`, `lib/git-workflow-preferences.mjs`, `lib/sampling-parameter-capabilities.mjs`, `lib/scoped-models.mjs`, `public/sampling-parameter-controls.mjs`, `package.json`), and the prior approved plan `pi-package-qt-webui/plans/planned/qt-webui-shared-tool-skill-state.md`. No files were modified.

## Verdict

**Revise.** The direction is correct and the choice of resource-profile selection as the first contract is well-grounded in real evidence (Qt WebUI already consumes Pi WebUI's `resource-selection.mjs`). However, the step as written has one acceptance criterion that is unreachable within its stated scope (the settings store/lock import is left behind), one candidate contract (sampling) whose two implementations are semantically different in user-visible ways, an unsolved browser-delivery problem for anything extracted from Pi WebUI's `public/`, and an unacknowledged reversal of a prior approved ownership decision. None of these are fatal; all of them are fixable with plan edits before execution.

## What is sound

- **Audit-before-move ordering.** Work package 4.1 forces per-candidate evidence ("Identify current owners and callers in both packages", "Reject extraction when names are similar but semantics differ", "Write the proposed public API and compatibility policy before moving code") before any code moves. This is the right shape, and the divergence findings below land inside an existing gate rather than requiring a new one.
- **Correct first contract.** `pi-package-webui/lib/resource-selection.mjs` is pure, bounded, dependency-free, and already the canonical implementation that `pi-package-qt-webui/lib/backend/resources.mjs` (lines 6–10) and `lib/pi-extension/qt-webui-helper.mjs` (line 2) import. Moving it is genuinely low-risk compared to the other candidates.
- **Explicit exclusions.** Ruling out HTTP/SSE/auth, DOM renderers, tab actors, and settings envelopes prevents the classic "shared core becomes a dumping ground" failure. The "no generic `utils` module" rule in 4.4 is a good guardrail.
- **Rollback and compatibility posture.** Keeping re-export shims in the old owner, forbidding storage migration until both clients ship, and refusing to delete legacy data matches the non-destructive migration discipline already proven in `resources.mjs`'s `migrateLegacyProfiles`/`canonicalMigrationComplete` design.
- **Gate realism.** Requiring packed-tarball tests (rather than repository-relative imports) for both UIs is exactly right, and "do not start the shared package merely to reduce duplicate line count" is a healthy decision gate.
- **Understated benefit worth surfacing:** dropping Qt WebUI's runtime dependency on `@firstpick/pi-package-webui` removes a heavy transitive closure (`pi-ai`, `pi-tui`, `mermaid`, `typebox`, per `pi-package-webui/package.json`) from a desktop package that needs only a handful of pure functions. The plan should claim this explicitly; it is one of the strongest justifications for the step.

## Findings

### F1 — High — The headline acceptance criterion is unreachable within 4.3's stated scope

**Evidence.** Acceptance requires "Qt WebUI has no import from `@firstpick/pi-package-webui/lib/`" (plan line ~534). But the cross-package imports are:

- `pi-package-qt-webui/lib/backend/resources.mjs:2–5` — `readWebuiSettings`, `updateWebuiSettings`, `webuiSettingsFile` from `lib/git-workflow-preferences.mjs` (the locked, atomic, cross-process settings store);
- `pi-package-qt-webui/tests/backend-session.test.mjs:5` — same module;
- `pi-package-qt-webui/lib/pi-extension/qt-webui-helper.mjs:2` — `branchResourceDirective` from `lib/resource-selection.mjs`.

Work package 4.3 scopes only "profile normalization, exact-model selection, unavailable-name preservation, and inheritance resolution" — i.e., the pure half of `resource-selection.mjs`. It does not move `branchResourceDirective`, and it cannot move the settings store, because `git-workflow-preferences.mjs` is entangled with the Pi-WebUI-specific settings envelope: it imports `subagent-launch-slots.mjs`, `ui-layout-settings.mjs`, `append-system-selection.mjs`, and `webui-output-mode.mjs` (lines 5–13), and 4.1 explicitly excludes "package-specific settings envelopes". The step-4 dependency rule also bans "process supervisors" from the core without saying whether a cross-process file lock (`withWebuiSettingsLock`, `writePrivateAtomicSettings`, lines ~250–420 of `git-workflow-preferences.mjs`) counts.

**Impact.** Gate D either fails, or — worse — the implementer quietly expands scope mid-step to include the lock/atomic-write layer, which is the most security- and durability-sensitive code in the arrangement (stale-lock reclamation, `0o600`/`0o700` permissions, atomic rename, Windows retry), without the separate review the plan's own constraints demand.

**Proposed amendment (required).** Split the acceptance criterion: (a) "Qt WebUI has no import of `resource-selection.mjs` from `@firstpick/pi-package-webui/lib/`" as the 4.3 exit criterion; (b) add an explicit decision work package — either move a generic *locked atomic JSON store* (lock + latest-snapshot merge + atomic write, with envelope normalization injected per package) into the core as its own named module with its own security review, or declare the settings store permanently Pi-WebUI-owned and keep the dependency, in which case the "no import" outcome in the step header must be reworded. Also add `branchResourceDirective` to 4.3's move list or explicitly defer it; it is one of only two modules Qt imports today and the plan never mentions it.

### F2 — High — Browser delivery of shared logic is unsolved; the sampling candidate cannot actually be deduplicated

**Evidence.** Pi WebUI's sampling capability logic is consumed by the *browser*: `public/sampling-parameter-controls.mjs` is imported by `public/app.js:29`, `webui-rpc-helper.mjs:35`, and `lib/sampling-parameter-capabilities.mjs:1`, and is pinned into the offline app shell in `public/service-worker.js:20`. Pi WebUI has no build step — `public/` is served statically. The core package's dependency rule forbids browser DOM code, and a Node package cannot be imported by a statically served browser module without a bundling or generation step the plan never mentions.

**Impact.** Extracting "sampling parameter validation and capability filtering" into the core either (a) leaves the browser copy behind, so the deduplication goal silently fails and two implementations still drift, or (b) forces an unplanned build/codegen step into Pi WebUI's packaging, which is a tooling change with its own release risk.

**Proposed amendment (required).** In 4.1, require every candidate to declare its *delivery surfaces* (Node backend, Pi extension, browser). For browser-consumed logic, either specify a committed generated artifact with a no-diff regeneration check (the same pattern step 1.1 already mandates for generated QML protocol constants) or restrict the extraction to the server-side consumers and say so plainly.

### F3 — High — The two sampling implementations are semantically different in user-visible ways; unification changes behavior

**Evidence.** Qt's `lib/backend/sampling.mjs` and Pi WebUI's `lib/sampling-parameter-capabilities.mjs` look like twins but are not:

- Pi WebUI's `resolveSamplingParameterCapabilities` keys on a full `model` object and honors model-declared `samplingParams` to enable `top_k`/`min_p` on `openai-completions` (the `source: "model"` branch, ~lines 70–76), and honors `model.compat.supportsTemperature === false` for Anthropic (~lines 78–87). Qt's `samplingCapabilities(api, { thinkingActive })` keys on the API string only and has neither behavior.
- Pi WebUI's `applySupportedSamplingParameters` deletes `temperature` when the payload already contains Anthropic extended thinking (`anthropicPayloadHasThinking`, ~lines 92–96). Qt's `applySamplingToPayload` has no equivalent, so the two clients can send different payloads for the same stored profile.
- The `reason` strings differ and are shown in each UI's disabled-field tooltips (cf. `pi-package-qt-webui/TECHNICAL.md:147`).

This is precisely the "names are similar but semantics differ" case 4.1 says to reject — yet sampling is listed as an initial candidate, and the plan constraint forbids changing user-visible behavior merely to ease a module boundary. Unifying requires a deliberate behavior-alignment decision (which client's Anthropic-thinking rule wins?), i.e., a separately reviewed behavior change.

**Impact.** If the implementer treats sampling as a mechanical move, one client's payload construction and UI explanations change silently, weakening the plan's own "no behavior rewrite in the same commit as a responsibility move" rule.

**Proposed amendment (required).** Demote sampling from "initial candidate" to "audit output required before scheduling". The audit must produce an explicit behavior-diff document; any alignment ships as its own reviewed change with TECHNICAL.md updates, before or after — but not inside — the extraction commit.

### F4 — Medium — Bounds/limits diverge between the two contracts and the plan doesn't say which values win

**Evidence.** `pi-package-webui/lib/resource-selection.mjs:1–4`: `MAX_RESOURCE_NAME_LENGTH = 256`, `MAX_PROVIDER_LENGTH = 160`, `MAX_MODEL_ID_LENGTH = 512`, `MAX_MODEL_PROFILES = 512`, with truncating normalization (`cleanResourceString` slices). `pi-package-qt-webui/lib/backend/protocol.mjs`: `maxModelProfiles = 64`, `maxResourceNames = 512` (a count, not a length), `maxToolNameCharacters = 64` (name entries capped at `×2 = 128` in `resources.mjs`'s `nameList`), `maxProviderCharacters = 64`, `maxModelIdCharacters = 128`, with skip/reject semantics rather than truncation. Qt's `assertExactModelSelection` (`resources.mjs`) already implicitly depends on the canonical 512-profile cap. The step-4 rule "Define package-owned limits only for genuinely shared contracts" doesn't reconcile these, and the program constraint "Keep current bounds … until a separately reviewed change replaces them" conflicts with whichever reconciliation is chosen.

**Impact.** Shared fixtures that "both clients produce identical results from" cannot be written without first picking canonical limits; picking them is a bounds change requiring the separate review the constraints mandate. If left implicit, the fixture authors will pick values ad hoc.

**Proposed amendment (required).** Add a limits inventory to 4.1: for every paired limit, record both values, classify truncate-vs-reject semantics, declare the canonical value for the shared file format (the file is shared, so file-format limits belong to the core), and route any client-visible tightening/loosening through the plan's existing separately-reviewed-bounds-change rule. Fixtures must include boundary values (e.g., 255/256/257-character names, 64 vs 512 profiles).

### F5 — Medium — Unknown-key pass-through is load-bearing for Qt's migration marker but is not in the contract

**Evidence.** Qt's `migrateLegacyProfiles` stores its idempotency marker as `resourceDefaults.qtWebuiMigrations.webuiToolSkillState` *inside Pi WebUI's canonical settings file* (`resources.mjs`, `CANONICAL_MIGRATIONS_KEY`), and `canonicalMigrationComplete` reads it back. Pi WebUI's `normalizeResourceDefaults`/`normalizeWebuiSettings` preserve this key only incidentally, via object spread (`{ ...source, ... }` in `resource-selection.mjs` and `git-workflow-preferences.mjs`). The prior plan's decision record (2026-08-27, W1 escalation) shows exactly what breaks when this marker is lost: legacy values resurrect after an explicit user clear.

**Impact.** A core reimplementation of normalization that builds fresh objects (the natural style for a "pure, validated" module) silently drops the marker on the next write, re-triggering migration or reviving cleared legacy state. This is a data-integrity regression in users' real `~/.pi/webui/settings.json`.

**Proposed amendment (required).** Write "normalization and locked-update round-trips preserve unknown keys at every object level of the envelope" into the core's public contract, with a dedicated fixture both clients consume.

### F6 — Medium — Two acceptance criteria cannot prove their claims as written

**Evidence.** (a) "Pi WebUI and Qt WebUI can upgrade independently within the declared compatible range" — no test or artifact demonstrates this; nothing defines the compatible range, and no version-matrix testing exists. (b) "Keep Pi WebUI compatibility re-exports for one release cycle" — the two packages version independently; whose cycle, and how long, is undefined. 4.2 says "Add semver and deprecation rules" but the gate doesn't verify them.

**Impact.** The first genuinely shared-code release is exactly when cross-package version skew bites (Qt pinned `^0.9.9` today per `package.json:37`). An unverifiable gate gives false confidence; an ambiguous deprecation window invites premature shim removal.

**Proposed amendment (required).** Define the policy numerically in 4.2 (e.g., "core exports follow semver; breaking changes only in majors; Pi WebUI re-export shims retained for at least one Pi WebUI major and removed only after Qt WebUI's declared core range no longer intersects the shimmed API"), and add a gate: CI/test jobs run each UI's contract fixtures against the *oldest* and *newest* in-range packed core versions.

### F7 — Medium — The step does not enumerate the existing contract tests it invalidates, and misses the helper-extension resolution environment

**Evidence.** `pi-package-qt-webui/tests/package-contract.test.mjs:16` asserts the dependency pin `/^\^0\.9\.9$/` on `@firstpick/pi-package-webui`. `tests/packed-install.test.mjs` (~lines 85–170) fabricates a fake `pi-package-webui` tarball with stub `lib/resource-selection.mjs` and `lib/git-workflow-preferences.mjs`, then asserts it installs alongside the packed Qt package and that `createResourceStore` resolves through it. Step 4 rewrites or deletes both fixtures, but neither file appears in any work package. Separately, `qt-webui-helper.mjs` runs *inside the Pi process* via `--extension`; its import of the shared module resolves in that process's module environment, which the packed-install probe never exercises (it only probes `createResourceStore`).

**Impact.** Tests fail mid-step in ways that look like regressions but are stale assertions, burning review time; and a helper-resolution breakage (e.g., after dropping the `pi-package-webui` dependency) would only surface live, inside a running Pi session.

**Proposed amendment (required).** List both test files as explicit work items in 4.3 (rewrite the pin assertion to the core dependency; replace the fake-webui fixture with a fake/real packed core fixture), and extend the packed-install probe to resolve the helper module's imports, not just the backend store's.

### F8 — Medium — The step silently reverses an approved ownership decision and ignores the existing shared package

**Evidence.** `qt-webui-shared-tool-skill-state.md` records an approved decision: "**Canonical owner:** `@firstpick/pi-package-webui` remains the single implementation owner", and lists "Move the contract into a third package now" under *Rejected or deferred options* ("deferred as unnecessary repository-wide churn"). `pi-package-webui/DEVELOPMENT.md:697` documents this consumption contract for contributors. Step 4 reverses the decision without citing it or stating what evidence changed. Additionally, a shared package already exists — `@firstpick/pi-utils` (pi-webui depends on it per its `package.json`; Qt carries it transitively) — and the plan never explains why a new `@firstpick/pi-ui-core` instead of a scoped addition to `pi-utils`, or how the two relate.

**Impact.** Reviewers and future maintainers see contradictory canonical-ownership claims across two approved plans and two DEVELOPMENT.md files; the "which package owns what" question the refactor exists to settle gets murkier, not clearer.

**Proposed amendment (required).** Add a short "Supersedes" paragraph to step 4 naming the deferred option, the evidence that changed (deep-import fragility, dependency weight, drift risk), and the intended relationship to `pi-utils`. Add updating `pi-package-webui/DEVELOPMENT.md:697` to 4.3's work items.

### F9 — Low — Core package metadata and dependency-rule wording are underspecified

**Evidence.** The dependency rule bans "process supervisors" without defining the term (is a cross-process file lock one? — see F1). Nothing states the core's `engines`, that it must *not* carry Qt's `"os": ["linux"]` restriction (Pi WebUI supports Windows; `git-workflow-preferences.mjs` contains Windows-specific rename retry), or its `files` allowlist.

**Proposed amendment (optional refinement).** One line each in 4.2: core is platform-neutral with `engines.node >= 22.19.0`; clarify that cross-process file locking and atomic persistence are permitted only in a named Node-storage module if F1's decision moves them.

### F10 — Low — The scoped-models candidate is near-empty and the no-cycle gate has no named mechanism

**Evidence.** `pi-package-webui/lib/scoped-models.mjs` is a ~20-line async wrapper over `resolveModelScopeWithDiagnostics` from `@earendil-works/pi-coding-agent`; Qt has no counterpart (`scopedModelsFrom` in `qt-webui-helper.mjs:39` just passes `ctx.scopedModels` through). The real contract owner is Pi itself, so extraction value is ~zero — the audit will reject it, but listing it as an "initial candidate" overstates the expected yield. Separately, "No dependency cycle exists" names no check.

**Proposed amendment (optional refinement).** Note scoped-models as expected-reject in 4.1 (useful as a worked example of the audit's discipline), and name the cycle check (e.g., a core-package test that walks its own import graph, or an `madge`-style lint) in the gate.

## Missing tests or gates

1. **Version-matrix contract tests** — each UI's shared fixtures run against oldest and newest supported packed core versions (F6). Currently absent from every gate.
2. **Unknown-key pass-through fixture** — round-trip a `resourceDefaults` containing `qtWebuiMigrations` and an invented future key through core normalization and (if moved) the locked updater (F5).
3. **Boundary-limit fixtures** — 255/256/257-char names, 64-vs-512 profile counts, truncate-vs-reject semantics, and `normalizeModelProfiles`' subtle dedupe/remove/reindex path (`resource-selection.mjs`, the `indexes.clear()` + re-index branch), which is easy to port wrong (F4).
4. **`branchResourceDirective` fixtures** — the version-2 inherit branch and the legacy `disabledSkills` fallback, whether moved now or deferred (F1).
5. **Helper-extension resolution in packed install** — assert the packed Qt package's Pi-side helper imports resolve without assuming `@firstpick/pi-package-webui` is installed (F7).
6. **If the lock/store moves (per F1 decision):** stale-lock reclamation, lock timeout, concurrent cross-process updaters, atomic-write durability, and Windows rename-retry tests must exist in the core package itself, not only in Pi WebUI's suite.
7. **Regeneration no-diff check** for any browser-consumable artifact generated from the core (F2) — the plan reuses this pattern in step 1.1 but omits it here.
8. **Named cycle check** for the "No dependency cycle exists" gate (F10).

## Future changeability score: 7/10

After the step as written, resource-profile behavior changes would touch one cohesive core module plus at most one UI — a real improvement over today's cross-package deep imports. The score is held down because (as written) the settings store/lock likely stays behind in Pi WebUI (F1), browser sampling logic stays duplicated (F2/F3), and later candidates (session identity, transcript helpers) are still speculative, so some routine changes continue to coordinate across two packages and a shim layer.

## Maintainability score: 6/10

Ownership of the moved slice becomes clear, fixtures give both clients one behavioral oracle, and the rollback posture is good. But the plan leaves ownership of the lock/store ambiguous (F1), leaves limit semantics poised to drift or change silently (F4), carries an undocumented reversal of the recorded ownership decision (F8), and contains two acceptance criteria that cannot be verified (F6), which weakens the "gates prove what they claim" property.

## Combined impact score: 6/10

Genuine, durable benefit if the first contract lands — smaller Qt dependency tree, one owner for a real shared file format, fixture-driven compatibility — discounted by a reachable-but-mis-stated exit criterion and by the risk that scope quietly expands into the highest-risk shared component (the locked settings store) without its own review.

## Recommended plan edits

1. **(Required)** Split 4.3's acceptance criterion: resource-selection purity move vs. settings-store decision; add `branchResourceDirective` to the move list or defer it explicitly (F1).
2. **(Required)** Add a 4.1 requirement that every candidate declares its delivery surfaces, with a committed-generated-artifact + no-diff-check pattern for browser-consumed logic (F2).
3. **(Required)** Demote sampling to audit-gated; require a behavior-diff document and a separately reviewed alignment change before extraction (F3).
4. **(Required)** Add a limits-inventory deliverable to 4.1 with canonical values, boundary fixtures, and the separately-reviewed-bounds-change routing (F4).
5. **(Required)** Add unknown-key pass-through to the core contract and fixtures (F5).
6. **(Required)** Make the semver/deprecation policy numeric and add oldest/newest-core matrix testing to the release gate (F6).
7. **(Required)** Enumerate `tests/package-contract.test.mjs` and `tests/packed-install.test.mjs` rewrites in 4.3, and extend the packed probe to the Pi-side helper's imports (F7).
8. **(Required)** Add a "Supersedes" note reconciling with `qt-webui-shared-tool-skill-state.md`, state the relationship to `@firstpick/pi-utils`, and add `pi-package-webui/DEVELOPMENT.md:697` to the documentation updates (F8).
9. **(Optional)** Clarify "process supervisors", core package metadata (`engines`, no `os` restriction), the expected-reject status of scoped-models, and name the dependency-cycle check (F9, F10).

## Final recommendation

**Revise.** The step's architecture — a narrow, pure, fixture-verified core with explicit exclusions and conservative rollback — is the right end state and the first contract is correctly chosen. But it should not start until the acceptance criteria are made reachable and provable (F1, F6), the sampling and browser-delivery hazards are gated behind the audit with behavior-alignment handled separately (F2, F3), the bounds and unknown-key contracts are written down (F4, F5), the invalidated tests are planned for (F7), and the reversal of the recorded ownership decision is documented (F8). With edits 1–8 applied, this becomes an accept.
