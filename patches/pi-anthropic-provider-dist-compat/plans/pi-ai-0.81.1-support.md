# Plan — pi-ai 0.81.1 compatibility patch support

**Status:** complete  
**Report:** `reports/pi-ai-0.81.1-support.html`

## Objective and success criteria

Enable the `pi.anthropic-provider-dist-compat` lifecycle package to classify the discovered native TUI and WebUI RPC `@earendil-works/pi-ai` `0.81.x` files as applicable only when their semantic legacy anchors match; validate offline; then apply from a newly generated deterministic plan.

Success requires:

- the manifest supports only the verified `0.81.1` layout in addition to its existing range;
- the real `0.81.1` fixture is transformable and idempotent;
- unknown layouts and future versions remain blocked;
- `patchctl status` and `plan` discover both installed runtime targets as applicable;
- `patchctl apply` uses the immediately preceding plan hash and transactionally writes both targets;
- offline `patchctl verify` succeeds without network or Anthropic billing.

## Scope / non-goals

**In scope:** manifest range/version/documentation, `0.81.1` regression fixture/test, lifecycle-package tests, offline application to the discovered native and WebUI `pi-ai` runtimes.

**Out of scope:** package installation/update, changes to upstream Pi sources, live Anthropic/provider verification, credential changes, and modifying unknown or future layouts.

## Decisions and assumptions

- **Decision:** extend package support through `<0.82.0`, not unbounded support. The installed `0.81.1` target retains every existing semantic anchor and the transformer’s exact-match postconditions; `<0.82.0` keeps the next minor release fail-closed.
- **Decision:** preserve semantic fingerprints and all current transactional/rollback behavior. Version support alone never permits mutation.
- **Assumption:** the two discovered files with hash `99bbeeb84f99ac7d3d5a3167d6fd1efad5aaf84d4e5c3445720af08f2275ec6b` represent the `0.81.1` layout covered by the new fixture.
- **Safety:** live Anthropic validation remains explicitly deferred because it can use network/billing.

## Architecture and interfaces

`PATCH.md` → `patch.manifest.json` (package range/profile) → `scripts/lifecycle.mjs` (semantic discovery/transform/transaction) → `patchctl.mjs` (strict parsing, deterministic plan, apply receipt, verification).

Runtime roles are separately resolved (`native-tui`, optional `webui-rpc`), but writes are prepared and committed as one transaction.

## Work items

- [x] Inspect current blocked plan and the installed `0.81.1` target layout.
- [x] Add bounded `0.81.x` support, a regression fixture, and tests preserving future-version blocking.
- [x] Run strict extraction and lifecycle-package checks.
- [x] Obtain two independent cross-provider read-only reviews; disposition every finding.
- [x] Add the accepted `0.81.1` discovery-plan regression test, then generate a new plan, apply with its exact hash, and run offline verification.
- [x] Write the final HTML report and update this plan with evidence.

## Dependencies and merge order

One writer modifies only the patch package. Reviews run read-only after package checks. Installed-runtime application follows a reviewed fresh plan. No parallel writers.

## Acceptance tests

1. `node /home/firstpick/.pi/agent/skills/patch-md/scripts/patch_md_extract.mjs --patch PATCH.md --strict`
2. `npm run check`
3. `patchctl status` and `patchctl plan` find both runtime roles and report two applicable writes.
4. `patchctl apply --plan-hash <fresh-hash>` writes exactly both targets and returns a receipt.
5. `patchctl verify` passes syntax, semantic postconditions, and local HTTP capture with `networkUsed: false`, `billingUsed: false`.
6. A second plan is a zero-write no-op. (Deferred if it would be redundant after verification; no mutation is expected.)

## Execution evidence

- Strict extraction passed: `patch_md_extract.mjs --patch PATCH.md --strict`.
- Package checks passed twice, finally with **14/14** tests: `npm run check`.
- Fresh plan (`2026-07-21T18:31:53.835Z`) was unblocked with two applicable writes and hash `46873abdea1c785f731156ff810cd0711ac9fd1a8090f2a323970a8dd2379632`.
- Applied exactly that plan hash: two writes completed. Receipt: `/home/firstpick/.pi/agent/patch-state/pi.anthropic-provider-dist-compat.json`.
- Offline `patchctl verify` passed for native TUI and WebUI RPC: syntax, semantic postconditions, local HTTP capture, and both mode-0600 receipt backups. It reported `networkUsed: false` and `billingUsed: false`.
- A post-apply plan reported `writes: 0`, `noop: true`; both targets are `already-applied` at after-hash `c55f88d0829b60904b73b16626380c0f9da2b3dbad5dc4858099f05a3c03bde4`.
- Native Pi and WebUI child RPC processes must be restarted to load the patched files.

## Risks

- This is an installed-`dist/` compatibility shim, not an upstream API contract.
- The application must not run if semantic anchors, hashes, or package discovery drift.
- Applying changes runtime files; native Pi and WebUI child RPC processes require restart afterward.

## Review status

Two qualifying independent read-only reviews completed after strict extraction and `npm run check` passed:

| Run | Model/provider family | Result |
|---|---|---|
| `96d2a757-a3be-4c3c-978a-1fd2e8da3933` child 1 | Anthropic Claude Opus 4.6 / Anthropic | No blockers; verified all 0.81.1 anchors and transform regexes match exactly once. |
| `49b81d5c-4024-4d99-bd7c-cd8e2f5a22fe` | Grok 4.5 / xAI (via OpenRouter) | No blockers; verified the range, fixture/install identity, lifecycle safety, and plan applicability. |

The initial Google reviewer child in run `96d2a757-a3be-4c3c-978a-1fd2e8da3933` failed because its configured API key was invalid; it is not counted. A Moonshot replacement launch failed before execution because the requested model ID was unavailable; it is not counted.

| Finding | Disposition | Evidence / rationale |
|---|---|---|
| Incorrect plan fixture hash | accepted | Corrected to the observed 64-character SHA-256 above; it never affected runtime behavior. |
| Automated checks not evidenced | rejected as stale | Strict extraction and `npm run check` already passed before review; post-apply verification remains required below. |
| No isolated 0.81.1 discovery-plan test | accepted | Add a non-mutating discovery/plan regression using the captured 0.81.1 fixture. Full runtime capture remains the installed offline verification gate. |
| Plan says “only 0.81.1” while the manifest permits anchor-gated 0.81.x | accepted | Objective now accurately states bounded anchor-gated 0.81.x support. |
| Fixture directory omits patch version | deferred | `pi-ai-0.81` intentionally denotes the supported minor; the test label and plan name identify the captured 0.81.1 release. Renaming adds churn without safety benefit. |
| Pre-existing prerelease parsing / TOCTOU observations | deferred | Not introduced by this bounded support change; out of approved scope and still guarded by semantic fingerprints/hashes.
