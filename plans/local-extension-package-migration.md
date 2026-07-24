# Local Pi Extension Package Migration

**Status:** Complete — packages, runtime migration, review quorum, validation, and report verified  
**Feature classification:** Complex — four standalone runtime extensions become independently publishable packages, their tests and metadata move with them, local runtime discovery changes from hardcoded files to repository-managed symlinks, and the migration crosses the pi-coding-agent-forge and dotfiles repositories.
**Integration owner:** Main agent  
**Primary repository:** `/home/firstpick/pi-coding-agent-forge`
**Secondary runtime repository:** `/home/firstpick/.dotfiles`  
**Report:** [`../reports/local-extension-package-migration.html`](../reports/local-extension-package-migration.html)

## Objective and measurable success criteria

Migrate every locally owned standalone Pi extension currently stored as a regular file under `~/.pi/agent/extensions` into a reusable package in this repository, generalize package metadata and user-facing documentation, and preserve local behavior through repository-managed symlinks.

Success requires:

- four standalone sources become npm-ready Pi packages:
  - `@firstpick/pi-extension-anthropic-auth-recovery`;
  - `@firstpick/pi-extension-conditional-system-prompts`;
  - `@firstpick/pi-extension-feature-system-prompt`;
  - `@firstpick/pi-extension-subagent-minimum-fanout`;
- each package has a valid npm manifest, `pi.extensions`, public-facing README, MIT license, focused tests, and a clean `npm pack --dry-run` result;
- wording describes reusable behavior, configuration, requirements, security boundaries, and limitations without assuming one machine, username, or checkout path;
- runtime behavior remains compatible with the current local configuration and existing extension tests;
- the previous regular files and migrated standalone tests under `.dotfiles/.pi/agent/` are removed after package sources are verified;
- `dev/scripts/sync-pi-package-symlinks.sh` creates canonical symlinks for package extension entries;
- the existing local-only `workflow-test-extension.ts` remains owned by `pi-extension-workflows`, is not published as a separate package, and keeps its repository-generated wrapper because Pi's loader resolves relative imports incorrectly through a direct file symlink;
- unrelated dirty `pi-package-webui` files and unrelated dotfiles model inventory changes remain untouched;
- two distinct implementation worker deliverables, integrated checks, two-provider independent review, and a strict HTML report are recorded.

## Scope

### New or promoted packages

1. `pi-extension-conditional-system-prompts/`
2. `pi-extension-feature-system-prompt/`
3. `pi-extension-subagent-minimum-fanout/`
4. `pi-extension-anthropic-auth-recovery/`

### Integration-owned files

- `README.md`
- `dev/scripts/sync-pi-package-symlinks.sh`
- `plans/local-extension-package-migration.md`
- `reports/local-extension-package-migration.html`
- exact migrated source/test/ignore entries under `/home/firstpick/.dotfiles/.pi/agent/`
- `patches/pi-anthropic-agent-sdk-subscription-auth/PATCH.md`
- `patches/pi-anthropic-agent-sdk-subscription-auth/patch.manifest.json`

## Non-goals

- Publishing packages to npm, changing package versions outside the four new packages, or running the release workflow.
- Bundling personal `APPEND_*.md` policy files into public packages.
- Changing the substantive feature-development policy or zero-or-multiple invariant.
- Publishing the workflow runtime's local TUI self-test as a production extension.
- Refactoring unrelated Pi extensions or touching the existing dirty WebUI work.
- Adding package-level enforcement for human slash commands or extension RPC spawning.

## Approved decisions and invariants

1. **One package per standalone extension.** Existing repository convention and independent runtime responsibilities favor four separate packages rather than one bundle.
2. **Preserve extension filenames.** Each `pi.extensions` entry points to the existing standalone filename so the sync script creates the same runtime entry name.
3. **Promote, do not duplicate, Anthropic recovery.** The private installer source under `patches/pi-anthropic-auth-recovery` becomes the root npm package. Obsolete patch-installer-only files are removed unless still needed by focused package tests.
4. **Workflow test boundary.** `workflow-test-extension.ts` is generated development glue whose real source already lives in `pi-extension-workflows`; it does not get a redundant package. A direct file symlink was tested and rejected because Pi/jiti resolved `../src/*.ts` relative to `~/.pi/agent/extensions`; the generated absolute-URL wrapper is therefore the required compatibility adapter, not an unmigrated source of truth.
5. **Portability.** Public docs and defaults must avoid user-specific absolute paths. Environment overrides and documented standard agent paths remain supported where discovery is required.
6. **External policies stay external.** Conditional and feature prompt packages document required `APPEND_*.md` files but do not publish local policy text.
7. **Behavioral compatibility.** Commands, event hooks, classifier taxonomy, fail-soft behavior, fanout semantics, and security safeguards remain stable unless a package-specific portability fix is validated by tests.
8. **No implicit publish.** Packaging/readiness checks are authorized; registry publication requires a separate user request.
9. **Dirty-worktree safety.** The npm repository already contains unrelated WebUI edits, so implementation workers run sequentially in the shared worktree with disjoint ownership. No automatic worktree fanout is allowed.
10. **One integration owner.** Workers do not edit this plan, the root README, sync script, dotfiles, or report.

## Execution DAG and waves

| Wave | Workstreams | Prerequisite | Completion signal |
|---|---|---|---|
| 1 | W1 | Plan exists; baseline recorded | Two prompt-routing packages, tests, metadata, and handoff verified |
| 2 | W2 | W1 integrated; shared worktree idle | Fanout and recovery packages, tests, metadata, and handoff verified |
| 3 | W3 integration | W1 + W2 verified | Root docs/sync behavior updated; local copies replaced by symlinks; combined checks pass |
| 4 | R1 + R2 | Integrated state stable | Two fresh, read-only, provider-diverse reviews and finding dispositions |
| 5 | Report | Accepted fixes and checks current | Linked HTML report passes strict validation |

## Workstream registry and ownership

| ID | Owner | Write boundary | Deliverables | Validation | Handoff |
|---|---|---|---|---|---|
| W1 | Implementation worker 1 — `83155167-f1f3-4259-af84-0ab309ec59e6/child-0` | `pi-extension-conditional-system-prompts/**`, `pi-extension-feature-system-prompt/**` only | Verified: two complete packages with migrated source/tests, reusable metadata, READMEs, licenses | 4/4 + 12/12 tests, syntax/import smoke, exact pack contents; sequential validator PASS | `/tmp/local-extension-package-migration-w1.md` |
| W2 | Implementation worker 2 — `9d0f9a13-8f00-466c-8642-dd5136bb0e49/child-0` | `pi-extension-subagent-minimum-fanout/**`, `pi-extension-anthropic-auth-recovery/**`, and removal of `patches/pi-anthropic-auth-recovery/**` only | Verified: two complete packages; promoted recovery source; migrated tests and security documentation | 9/9 + 8/8 tests, syntax/import smoke, exact pack contents; sequential validator PASS | `/tmp/local-extension-package-migration-w2.md` |
| W3 | Integration owner | root README, sync script, plan/report, umbrella patch index, exact dotfiles migration paths | Verified: repository index, four runtime symlinks, compatible workflow wrapper, removed old copies/tests, checks, dispositions, and report | 33/33 tests, four readiness passes, sync idempotence, runtime child startup, patch verify, diff/hash checks, strict report validation | This plan and report |

Workers must preserve all paths outside their boundary, must not stage or commit, must not spawn subagents, and must stop for unapproved interface, security, dependency, package-name, or ownership decisions. Handoffs must identify the run, changed files, validation commands/results, omissions, assumptions, unresolved risks, and integration notes.

## Acceptance and validation contract

1. Every new package manifest has:
   - scoped npm name and initial semver;
   - general description and `pi-package` keyword;
   - repository/homepage metadata with the correct package directory;
   - `pi.extensions` pointing to an existing source;
   - runtime imports declared as `peerDependencies` or `dependencies` per Pi package docs;
   - a restrictive `files` list containing all required runtime and documentation files.
2. Every package README includes purpose, install command, behavior, configuration, requirements, security/privacy boundaries, limitations, testing, and no user-specific path assumptions.
3. Migrated deterministic tests pass from their package directories.
4. Package entry imports succeed without registering side effects before factory invocation.
5. `npm pack --dry-run --json` includes the expected source, README, license, and package metadata but excludes tests and local-only artifacts unless deliberately required.
6. Existing classifier and minimum-fanout behavior remains covered after tests move out of dotfiles.
7. Anthropic recovery tests retain provider-scoped classification, plan-only flow, secure endpoint validation, temporary-file permissions, model selection, and portable discovery coverage.
8. Conditional prompt routing gains focused tests for platform/tool conditions, chained prompt preservation, caching, and missing-file behavior as implemented.
9. `sync-pi-package-symlinks.sh --dry-run` resolves all package resources without duplicate names or unresolved sources.
10. Applied sync produces symlinks for all four migrated standalone files and the expected generated wrapper for `workflow-test-extension.ts`; no standalone source owned by this migration remains a regular file.
11. Runtime discovery/import smoke confirms the four symlinks resolve into `/home/firstpick/pi-coding-agent-forge`, the workflow wrapper imports its repository source by absolute file URL, and child Pi startup succeeds.
12. Root and package `git diff --check` pass; no files are staged; unrelated dirty files are byte-preserved.
13. Repository publish-readiness checks pass for all four packages without publishing.
14. The final HTML report passes the strict report validator.

## Integration verification evidence

| Check | Result | Evidence |
|---|---|---|
| Four package suites | Pass | Conditional 4/4, feature router 12/12, minimum fanout 9/9, recovery 8/8: 33/33 total. |
| Syntax/import smoke | Pass | Every package `check` and `smoke` script passed; final runtime entries export extension factories. |
| Npm pack contents | Pass | Each dry-run tarball contains exactly its source, `README.md`, `LICENSE`, and `package.json`; tests/local artifacts excluded. |
| Publish readiness | Pass | All four `check-publish-readiness.sh` targets passed with auth/registry lookup intentionally skipped; npm publish dry-runs succeeded. |
| Runtime resource sync | Pass | Applied sync created four package symlinks; post-fix dry-run reports 47/47 extensions already correct with zero relinks, renames, or skips. |
| Workflow dev compatibility | Pass after remediation | Direct symlink caused both first reviewer slots to fail before child creation. Restored generated absolute-file-URL wrapper; corrected two-provider reviewer run then started and completed both child Pi sessions. |
| Anthropic umbrella patch | Pass after accepted fix | Removed dangling required recovery component; strict extraction, status, and offline verify report `ok=true`, `blocked=false`, and zero writes. |
| Portability scan | Pass | Published files contain no `/home/firstpick`, `.dotfiles`, or fixed `~/pi-coding-agent-forge` assumptions beyond expected public `@firstpick` package metadata. |
| Unrelated dirty files | Pass | Saved SHA-256 hashes for four WebUI files and both model inventory files remained unchanged. |
| Repository hygiene | Pass with deferred index note | Both repos pass `git diff --check`; no files are staged. Two dotfiles paths remain tracked as typechanged symlinks until a future explicit index/commit operation. |
| HTML completion report | Pass | `reports/local-extension-package-migration.html` passed strict validation with zero errors and zero warnings. |

## Independent review quorum and dispositions

The qualifying fresh-context review quorum completed under run `0587d315-f471-4b2e-af46-11c43b4a5b2f`. Both providers differ from each other and from the OpenAI implementation workers. The earlier run `c0f225ad-3c3b-4ff3-8ce8-3bbfd4ab918e` failed before either child session was created because of the workflow dev direct-symlink regression; it does not count toward quorum.

| Reviewer | Run identity | Model/provider family | Verdict | Artifact |
|---|---|---|---|---|
| R1 | `0587d315-f471-4b2e-af46-11c43b4a5b2f/child-0` | Claude Opus 4.8 / Anthropic | ACCEPT; no blockers, two follow-ups | `/tmp/local-extension-package-migration-review-anthropic.md` |
| R2 | `0587d315-f471-4b2e-af46-11c43b4a5b2f/child-1` | Kimi K3 / Moonshot AI via OpenRouter | PASS; no blockers | `/tmp/local-extension-package-migration-review-kimi.md` |

| ID | Finding | Disposition | Integration-owner evidence and rationale |
|---|---|---|---|
| R1-F1 | Umbrella Anthropic patch still required removed `../pi-anthropic-auth-recovery/PATCH.md` | Accepted and fixed | Removed the obsolete target/component, documented npm-package recovery ownership, then passed strict extraction plus status/verify with two remaining components and zero writes. |
| R1-F2 | Two dotfiles source paths remain tracked as absolute symlink typechanges | Deferred to commit/index operation | Runtime migration is correct and `.gitignore` now covers the links, but stopping Git tracking requires `git rm --cached` and an eventual commit. This task deliberately leaves both repositories unstaged and does not commit without authorization. Before committing dotfiles, run `git rm --cached .pi/agent/extensions/conditional-system-prompts.ts .pi/agent/extensions/feature-system-prompt.ts`; the working symlinks remain present and ignored. |
| R1-N1 | Inventory-time byte-identical statement no longer describes final recovery source | Clarified | The statement records the pre-promotion baseline. Final source intentionally differs only in approved portable discovery; W2 tests and source comparison verify the delta. |
| R2-N1 | Old implicit `~/pi-coding-agent-forge` recovery fallback removed | Accepted portability change | Standard agent paths, cwd/module ancestors, and explicit environment overrides replace the personal checkout assumption; failure degrades safely. |
| R2-N2 | Unknown future subagent execution action could bypass current aliases | Accepted residual | Current installed semantics are covered; README requires compatibility review after schema upgrades. |
| R2-N3 | Full child startup was not re-run by R2 | Verified independently | The corrected reviewer workflow itself started and completed both child Pi sessions after wrapper restoration, directly covering the prior startup failure. |

## Integration and rollout

1. Inspect and accept W1 and W2 diffs sequentially.
2. Update root package inventory and sync-script behavior.
3. Verify package sources/tests before removing the old dotfiles source and test files.
4. Remove only the exact migrated files and now-obsolete `.gitignore` exceptions; preserve unrelated dotfiles changes.
5. Run the sync script to create canonical symlinks.
6. Run package tests, pack dry-runs, publish-readiness checks, runtime import/discovery smoke, and diff integrity checks.
7. Obtain review quorum, disposition findings, apply only accepted fixes, and rerun affected checks.
8. Run `/reload` after completion so the current Pi process uses the symlinked package sources.

## Rollback

- Before removing local copies, package sources are byte-verified and git-visible.
- If package validation fails before symlink activation, retain the original local files and stop.
- If activation fails, remove the affected symlink and restore the original source from the pre-migration repository revision or the promoted package copy, then `/reload`.
- Revert only migration-owned root README/sync changes; do not reset unrelated dirty files.
- npm publication is not part of this migration, so registry rollback is unnecessary.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Missing external `APPEND_*.md` files break prompt routing | Document requirements; test failure/fallback semantics; do not bundle private policy content. |
| Symlink sync renames or overwrites local files unexpectedly | Verify package copies first; remove exact owned files intentionally before sync; run dry-run and inspect targets. |
| Generated workflow wrapper is mistaken for a standalone package | Record its source ownership and local-only publication boundary; keep the generated absolute-file-URL adapter because direct symlinking fails Pi/jiti relative-import resolution. |
| Anthropic recovery keeps duplicate installer/source copies | Promote the private patch source into one root package and remove the obsolete duplicate package. |
| Package metadata leaks machine-specific assumptions | Audit READMEs/manifests/source for `/home/firstpick`, `.dotfiles`, and checkout-specific defaults. |
| Runtime package imports fail after linking | Use documented peer dependencies and direct import/discovery smoke through the final symlinks. |
| Existing dirty work is overwritten | Sequential workers with exact boundaries; hash/status checks for unrelated WebUI and model inventory paths. |
| Package upgrade changes `pi-subagents` execution aliases | Keep installed-version parity tests and document the compatibility boundary. |

## Review quorum requirements

After integration, run two fresh-context, read-only reviewers on the actual combined diff. Their provider families must differ from each other and from the primary OpenAI implementation workers. Each review covers architecture, correctness, security/privacy, packaging, portability, test quality, symlink behavior, maintainability, and this plan's acceptance criteria. The integration owner records run identities, models, findings, evidence, severity, and one disposition per finding.

## Decision and progress log

- 2026-07-23: Inventory found five regular `.ts` entries under the global extensions directory. Four are standalone local sources; `workflow-test-extension.ts` is a generated wrapper whose source already belongs to `pi-extension-workflows` and is intentionally excluded from npm publication.
- 2026-07-23: Selected one package per standalone extension to match repository conventions and preserve independent installation/configuration.
- 2026-07-23: Confirmed the local Anthropic recovery file is byte-identical to `patches/pi-anthropic-auth-recovery/src/anthropic-subscription-auth-recovery.ts`; chose promotion over another copy.
- 2026-07-23: Confirmed the npm repository has unrelated dirty WebUI work and the dotfiles repository has unrelated model inventory changes; selected sequential shared-worktree workers and explicit preservation checks.
- 2026-07-23: Read Pi extension/package documentation and the repository's package/symlink conventions. No blocking user-owned design decision remains.
- 2026-07-23: W1 and W2 produced four package deliverables with passing package-local tests, import smoke, and pack dry-runs; sequential validators accepted both workstreams.
- 2026-07-23: Integrated root documentation and symlink migration. Four standalone runtime sources became repository symlinks and their dotfiles tests moved into package-local suites.
- 2026-07-23: A direct symlink experiment for the existing workflow dev extension failed real child Pi startup because Pi/jiti resolved `../src/errors.ts` relative to the symlink location. Restored the generated absolute-file-URL wrapper, verified sync idempotence, and classified both failed reviewer launches as pre-child diagnostic failures eligible for one corrected retry.
- 2026-07-23: Corrected reviewer run `0587d315-f471-4b2e-af46-11c43b4a5b2f` completed with Anthropic ACCEPT and Moonshot PASS; both reported no blockers.
- 2026-07-23: Accepted R1's dangling umbrella-patch finding, removed the obsolete required recovery patch component, documented the npm package replacement, and passed strict extraction/status/verify with zero writes. Deferred Git index untracking of two dotfiles symlinks because this task intentionally leaves repositories unstaged and uncommitted.
- 2026-07-23: Created `reports/local-extension-package-migration.html`; strict validation passed with zero errors/warnings. Final package suites remained 33/33, resource sync remained idempotent, unrelated hashes remained unchanged, and W3 was marked complete.
