import assert from "node:assert/strict";
import {
  MOBILE_SHELL_V2_DEFAULT,
  TABLET_SHELL_V2_DEFAULT,
  classifyMobileViewport,
  createMobileShellState,
  isMobileShellV2Enabled,
  mobileNavigationTargetFromSearch,
  mobileNavigationTargetSearch,
  normalizeMobileNavigationTarget,
  reduceMobileShellState,
  resolveMobileShellFeatureMode,
  resolveTabletShellFeatureMode,
} from "../public/mobile-shell-state.mjs";

assert.equal(MOBILE_SHELL_V2_DEFAULT, false, "the package default must remain rollback-safe");
assert.equal(TABLET_SHELL_V2_DEFAULT, false, "the independent tablet package default must remain rollback-safe");
assert.deepEqual(classifyMobileViewport({ width: 719, height: 844, coarsePointer: false, hover: true }), { viewportMode: "phone", posture: "regular" });
assert.deepEqual(classifyMobileViewport({ width: 720, height: 844, coarsePointer: false, hover: true }), { viewportMode: "phone", posture: "regular" });
assert.deepEqual(classifyMobileViewport({ width: 721, height: 844, coarsePointer: false, hover: true }), { viewportMode: "tablet", posture: "regular" });
assert.deepEqual(classifyMobileViewport({ width: 844, height: 390, coarsePointer: true, hover: false }), { viewportMode: "phone", posture: "compactLandscapePhone" });
assert.deepEqual(classifyMobileViewport({ width: 1049, height: 700, coarsePointer: false, hover: true }), { viewportMode: "tablet", posture: "regular" });
assert.deepEqual(classifyMobileViewport({ width: 1050, height: 700, coarsePointer: false, hover: true }), { viewportMode: "tablet", posture: "regular" });
assert.deepEqual(classifyMobileViewport({ width: 1051, height: 700, coarsePointer: false, hover: true }), { viewportMode: "desktop", posture: "regular" });

assert.equal(resolveMobileShellFeatureMode({ urlValue: "legacy", storedValue: "preview", defaultEnabled: true }), "legacy", "URL legacy must be the emergency rollback");
assert.equal(resolveMobileShellFeatureMode({ urlValue: "v2", storedValue: "legacy" }), "v2", "URL v2 must override browser storage");
assert.equal(resolveMobileShellFeatureMode({ storedValue: "preview" }), "preview");
assert.equal(resolveMobileShellFeatureMode({ storedValue: "unknown" }), "legacy", "unknown values must fail closed");
assert.equal(isMobileShellV2Enabled("v2", "phone"), true);
assert.equal(isMobileShellV2Enabled("legacy", "tablet", "v2"), true, "tablet activation is independently flagged");
assert.equal(isMobileShellV2Enabled("v2", "tablet", "legacy"), false, "phone v2 must not implicitly activate tablet");
assert.equal(resolveTabletShellFeatureMode({ urlValue: "legacy", storedValue: "preview" }), "legacy", "tablet URL rollback must override storage");
assert.equal(isMobileShellV2Enabled("preview", "desktop", "v2"), false, "desktop must preserve its legacy architecture");

let state = createMobileShellState({ viewport: { width: 390, height: 844, coarsePointer: true, hover: false }, featureMode: "v2" });
state = reduceMobileShellState(state, { type: "surface", surface: "more", page: "settings" });
assert.equal(state.surface, "more");
assert.equal(state.surfacePage, "settings");
state = reduceMobileShellState(state, { type: "back" });
assert.equal(state.surfacePage, "root", "Back leaves a sheet child before dismissing its parent");
state = reduceMobileShellState(state, { type: "back" });
assert.equal(state.surface, "none");
state = reduceMobileShellState(state, { type: "route", route: "activity" });
state = reduceMobileShellState(state, { type: "route", route: "project" });
state = reduceMobileShellState(state, { type: "back" });
assert.equal(state.route, "activity", "route history restores the preceding route after surfaces are closed");
state = reduceMobileShellState(state, { type: "viewport", viewport: { width: 1280, height: 800, coarsePointer: false, hover: true } });
assert.equal(state.surface, "none");
assert.equal(isMobileShellV2Enabled(state.featureMode, state.viewportMode), false, "desktop resize deactivates the v2 architecture without changing the selected flag");

let tabletState = createMobileShellState({ viewport: { width: 820, height: 1180, coarsePointer: true, hover: false }, featureMode: "legacy", tabletFeatureMode: "v2" });
assert.equal(isMobileShellV2Enabled(tabletState.featureMode, tabletState.viewportMode, tabletState.tabletFeatureMode), true);
tabletState = reduceMobileShellState(tabletState, { type: "surface", surface: "more", page: "settings" });
tabletState = reduceMobileShellState(tabletState, { type: "viewport", viewport: { width: 1024, height: 768, coarsePointer: true, hover: false } });
assert.equal(tabletState.surface, "more", "tablet rotation preserves compatible right-sheet state");
tabletState = reduceMobileShellState(tabletState, { type: "tablet-feature", featureMode: "legacy" });
assert.equal(tabletState.surface, "none", "tablet rollback closes only adaptive shell surfaces");

const validTarget = normalizeMobileNavigationTarget({ v: 1, route: "activity", tabId: "tab_12345678", runId: "run_12345678" });
assert.deepEqual(validTarget, { v: 1, route: "activity", tabId: "tab_12345678", runId: "run_12345678" });
assert.equal(normalizeMobileNavigationTarget({ v: 2, route: "activity", tabId: "tab_12345678" }), null, "unknown target versions must fail closed");
assert.equal(normalizeMobileNavigationTarget({ v: 1, route: "activity", tabId: "private title" }), null, "navigation targets accept opaque IDs only");
const targetSearch = mobileNavigationTargetSearch(validTarget);
assert.equal(targetSearch, "mobileRoute=activity&tab=tab_12345678&run=run_12345678");
assert.deepEqual(mobileNavigationTargetFromSearch(`?${targetSearch}`), validTarget);
assert.equal(mobileNavigationTargetFromSearch("?mobileRoute=activity&tab=unsafe%20title"), null);

console.log("mobile-shell-state.test.mjs passed");
