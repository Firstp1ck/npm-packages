# WS-B Frontend/Docs Handoff: Pi-managed WebUI Optional Features

## Identity and status

- Worker: WS-B frontend/docs implementation worker
- Status: implemented; required syntax and focused static validation passed
- Canonical plan: `plans/planned/webui-optional-features-pi-install.md` (read-only in this workstream)
- Backend handoff: `plans/handoffs/webui-optional-features-backend.md`
- Approved decisions: D1-D10 followed
- Classification: inherited complex classification retained; no second plan or reclassification created
- Base revision: `1897d26e2caacdec031dd470780bd2beeab3ee45`
- Result revision: `1897d26e2caacdec031dd470780bd2beeab3ee45` (working-tree changes only; no commit created)

## Changed files

1. `pi-package-webui/public/app.js`
   - Replaced optional-feature npm-install copy and progress assumptions with the exact unpinned `pi install npm:<package>` manual fallback and selected-Pi execution copy.
   - Treats physical installation and Pi registration separately; installed-but-unregistered rows remain installable/registerable rather than offering only Reload.
   - Preserves per-row Install/Update, loaded-feature enable/disable, Tools management, Reload, failure diagnostics, copy-command, and activity-log behavior.
   - Adds a dynamic panel toolbar with **Install all** and a per-section **Install missing** button.
   - Selects only rows whose backend status is physically missing or `configured !== true`; update-only rows are excluded from bulk selection.
   - Confirms a batch once, calls `POST /api/optional-feature-install-batch` once, marks all selected rows busy with bounded positional state, consumes ordered results, settles every row independently, reports aggregate counts, and prompts for reload once after a completed response.
   - Keeps successful batch installs aligned with existing single-install semantics by clearing browser-side disabled state only for successful rows.
   - Disables conflicting row/bulk mutations while a single or batch install is active and exposes `aria-busy`, live status, and descriptive labels.
2. `pi-package-webui/public/styles.css`
   - Adds responsive toolbar, aggregate status, section action, hover, warning, and narrow-screen styles for the new bulk controls.
3. `pi-package-webui/README.md`
   - Documents core-only WebUI installation, separately registered optional Pi packages, distinct installed/registered status, per-row and bulk controls, partial-failure behavior, the batch endpoint, and manual `pi install npm:<package>` installation/update.
   - Removes obsolete optional-feature npm prefix/npm binary guidance and corrects local companion development guidance to use Pi registration/settings.
4. `pi-package-webui/tests/mobile-static.test.mjs`
   - Adds focused assertions for missing/unregistered-only selection, exact Pi fallback commands, copyability before an attempt, retained per-row updates, **Install all**, **Install missing**, one batch route call, per-result settlement, aggregate results, and one reload prompt.
   - Updates integrated backend/catalog/resource/manifest and README assertions to the WS-A Pi-managed contract.
5. `plans/handoffs/webui-optional-features-frontend.md`
   - This handoff.

`pi-package-webui/public/index.html` was not changed because the existing `#optionalFeaturesBox` is a sufficient dynamic mount for the toolbar, sections, live aggregate status, and rows.

No files outside the assigned WS-B write boundary were modified by this worker.

## Backend interface consumed

- `GET /api/optional-features`: consumes `featureId`, `installed`, `configured`, `ready`, `installedVersion`, `declaredSpec`, `updateAvailable`, and `updateReason`.
- `POST /api/optional-feature-install`: remains the per-row operation.
- `POST /api/optional-feature-install-batch`: sends `{ featureIds }` once after confirmation and consumes `results`, `total`, `succeeded`, and `failed` semantics. Each ordered result is treated independently; failed rows use `optionalFeatureInstall.command`, `hint`, and bounded `outputTail`.
- Browser/server presentation catalog parity was verified for all 19 IDs/package names.

## Validation evidence

Commands were run from repository root.

| Command | Exit | Result |
|---|---:|---|
| `node --check pi-package-webui/public/app.js` | 0 | Frontend JavaScript parsed successfully. |
| `node --check pi-package-webui/tests/mobile-static.test.mjs` | 0 | Focused static test module parsed successfully. |
| `node pi-package-webui/tests/mobile-static.test.mjs` | 0 | Printed `mobile static checks passed`; optional-feature frontend, integrated backend-contract, manifest, docs, and existing static assertions passed. |
| Catalog parity here-doc shown exactly below | 0 | Printed `optional feature catalog parity passed (19 entries)`. |
| `git diff --check -- pi-package-webui/public/app.js pi-package-webui/public/styles.css pi-package-webui/README.md pi-package-webui/tests/mobile-static.test.mjs` | 0 | No whitespace errors in implementation/test/doc files. |
| `git diff --cached --name-only` | 0 | No output; no staged files. |

Exact catalog parity command:

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OPTIONAL_FEATURE_CATALOG } from './pi-package-webui/lib/optional-feature-catalog.mjs';
const app = await readFile('./pi-package-webui/public/app.js', 'utf8');
const block = app.slice(app.indexOf('const OPTIONAL_FEATURES = ['), app.indexOf('const OPTIONAL_FEATURE_BY_ID'));
const browserEntries = [...block.matchAll(/\bid:\s*"([^"]+)"[\s\S]*?\bpackageName:\s*"([^"]+)"/g)].map((match) => ({ featureId: match[1], packageName: match[2] }));
assert.equal(browserEntries.length, OPTIONAL_FEATURE_CATALOG.length);
assert.deepEqual(new Map(browserEntries.map((item) => [item.featureId, item.packageName])), new Map(OPTIONAL_FEATURE_CATALOG.map((item) => [item.featureId, item.packageName])));
console.log(`optional feature catalog parity passed (${browserEntries.length} entries)`);
NODE
```

### Earlier iterative validation attempts

- The exact command `node pi-package-webui/tests/mobile-static.test.mjs` exited 1 on nine earlier attempts while stale pre-WS-A static expectations were migrated in sequence (old controlled-package update name, async helper extraction, old frontend npm copy, old WebUI-controlled resource filtering, inline catalog assumptions, old installer-source assertion, old README resource/loading copy, and old optional-dependency/manifest assertions). These failures were not treated as passing. The final command above exited 0 after the assertions were aligned with the actual integrated contract.
- Earlier `node --check` runs for both changed JavaScript files and earlier scoped `git diff --check` runs also exited 0.

## Tests added or updated

`pi-package-webui/tests/mobile-static.test.mjs` now checks:

- bulk eligibility is exactly `status.installed !== true || status.configured !== true`;
- fallback/copy commands are exact unpinned `pi install npm:<package>` commands;
- per-row update action and single endpoint remain present;
- panel **Install all** and section **Install missing** controls are rendered dynamically;
- one batch confirmation precedes one batch endpoint call;
- every requested row receives success or failure state from the batch response;
- aggregate success/failure output is present and one post-batch reload prompt is issued;
- backend catalog, selected-Pi route, bounds/deduplication/sequencing, normal Pi resource loading, core-only package manifest, and README contract remain integrated.

## Omissions

- Did not run Playwright/browser geometry or axe checks, the full `npm test`, `npm run check`, the full endpoint harness, or pack/tarball checks; these remain Wave 2 integration-owner checks.
- Did not modify `public/index.html`; no static mount was necessary.
- Did not modify backend/package files, package locks, the canonical plan, root files, user Pi settings, or install real packages.
- Did not perform a real package batch against a workstation Pi installation; focused backend execution is covered by WS-A's isolated harness, while this workstream validates the browser/static contract.

## Assumptions and deviations

- No deviation from D1-D10.
- The existing dynamic optional-features mount is the approved panel location; no new static HTML surface was required.
- Because the backend returns the batch only after sequential completion and exposes no per-item streaming event, selected rows show bounded queued/position/busy state during the request and then settle individually from the complete response.
- A successful batch row clears its browser-side disabled preference, matching existing successful per-row install behavior; failed rows retain their prior preference.
- An empty bulk selection is handled client-side and does not send a no-op request.

## Residual risks

1. Browser interaction, responsive geometry, focus behavior, and axe results were not exercised in a real browser; static accessibility attributes and responsive CSS are covered, but Playwright remains required centrally.
2. Full package/check/pack validation remains for the integration owner. The shared package lock is intentionally out of this worker's boundary and was already dirty.
3. The unpublished `@firstpick/pi-extension-aur-review` remains cataloged by the approved backend; a bulk attempt can fail for that row and should demonstrate the intended partial-failure UI until publication or local installation.
4. A batch request does not provide incremental server-side item completion, so per-row success/failure appears when the bounded aggregate response arrives rather than as each Pi process exits.

## Integration notes

- Review `optionalFeatureNeedsInstall`, `renderOptionalFeatureBatchToolbar`, `renderOptionalFeatureSection`, `renderOptionalFeatureRow`, and `installOptionalFeatureBatch` together; these own eligibility, conflict disabling, presentation, and result settlement.
- The global label is exactly **Install all** and the section label is exactly **Install missing**.
- Updates remain per-row only. Bulk controls use backend status, not loaded-capability or browser enable/disable state, to decide eligibility.
- Route-level failure marks every selected row failed with a copyable Pi fallback; HTTP 200 partial failures use each returned row's diagnostics and still prompt once for reload after the response is processed.
- Existing unrelated working-tree changes were preserved. No staged files were present at handoff time.
