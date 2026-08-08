// Pure, browser-independent state helpers for the opt-in Mobile Experience v2
// shell. Rendering remains in app.js until functional mobile destinations land.

export const MOBILE_SHELL_V2_DEFAULT = false;
export const TABLET_SHELL_V2_DEFAULT = false;
export const MOBILE_SHELL_STORAGE_KEY = "pi-webui-mobile-shell-v2";
export const TABLET_SHELL_STORAGE_KEY = "pi-webui-tablet-shell-v2";
export const MOBILE_ROUTES = new Set(["chat", "sessions", "activity", "project"]);
export const MOBILE_SURFACES = new Set(["none", "more", "actionSheet", "file", "dialog"]);
export const MOBILE_TARGET_VERSION = 1;

const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const FEATURE_MODES = new Set(["legacy", "preview", "v2"]);

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function opaqueId(value) {
  const normalized = safeString(value);
  return OPAQUE_ID.test(normalized) ? normalized : null;
}

export function classifyMobileViewport({ width = 0, height = 0, coarsePointer = false, hover = true } = {}) {
  const safeWidth = Number.isFinite(width) ? width : 0;
  const safeHeight = Number.isFinite(height) ? height : 0;
  const compactLandscapePhone = coarsePointer === true && hover === false && safeHeight <= 500 && safeWidth <= 950;
  if (safeWidth <= 720 || compactLandscapePhone) {
    return { viewportMode: "phone", posture: compactLandscapePhone ? "compactLandscapePhone" : "regular" };
  }
  if (safeWidth <= 1050) return { viewportMode: "tablet", posture: "regular" };
  return { viewportMode: "desktop", posture: "regular" };
}

export function resolveMobileShellFeatureMode({ urlValue, storedValue, defaultEnabled = MOBILE_SHELL_V2_DEFAULT } = {}) {
  if (urlValue === "legacy") return "legacy";
  if (urlValue === "v2") return "v2";
  if (storedValue === "legacy") return "legacy";
  if (storedValue === "preview") return "preview";
  return defaultEnabled === true ? "v2" : "legacy";
}

export function resolveTabletShellFeatureMode({ urlValue, storedValue, defaultEnabled = TABLET_SHELL_V2_DEFAULT } = {}) {
  return resolveMobileShellFeatureMode({ urlValue, storedValue, defaultEnabled });
}

export function isMobileShellV2Enabled(featureMode, viewportMode, tabletFeatureMode = "legacy") {
  if (viewportMode === "phone") return featureMode === "preview" || featureMode === "v2";
  if (viewportMode === "tablet") return tabletFeatureMode === "preview" || tabletFeatureMode === "v2";
  return false;
}

export function createMobileShellState({ viewport = {}, featureMode = "legacy", tabletFeatureMode = "legacy", route = "chat" } = {}) {
  const { viewportMode, posture } = classifyMobileViewport(viewport);
  return {
    viewportMode,
    posture,
    featureMode: FEATURE_MODES.has(featureMode) ? featureMode : "legacy",
    tabletFeatureMode: FEATURE_MODES.has(tabletFeatureMode) ? tabletFeatureMode : "legacy",
    route: MOBILE_ROUTES.has(route) ? route : "chat",
    surface: "none",
    surfacePage: "root",
    routeHistory: [],
  };
}

function normalizedState(state) {
  const next = state && typeof state === "object" ? state : {};
  return {
    viewportMode: ["phone", "tablet", "desktop"].includes(next.viewportMode) ? next.viewportMode : "desktop",
    posture: ["regular", "compactLandscapePhone"].includes(next.posture) ? next.posture : "regular",
    featureMode: FEATURE_MODES.has(next.featureMode) ? next.featureMode : "legacy",
    tabletFeatureMode: FEATURE_MODES.has(next.tabletFeatureMode) ? next.tabletFeatureMode : "legacy",
    route: MOBILE_ROUTES.has(next.route) ? next.route : "chat",
    surface: MOBILE_SURFACES.has(next.surface) ? next.surface : "none",
    surfacePage: safeString(next.surfacePage) || "root",
    routeHistory: Array.isArray(next.routeHistory) ? next.routeHistory.filter((route) => MOBILE_ROUTES.has(route)).slice(-16) : [],
  };
}

function closeSurface(state) {
  return { ...state, surface: "none", surfacePage: "root" };
}

export function reduceMobileShellState(state, event = {}) {
  const current = normalizedState(state);
  switch (event.type) {
    case "viewport": {
      const viewport = classifyMobileViewport(event.viewport);
      const next = { ...current, ...viewport };
      if (!isMobileShellV2Enabled(next.featureMode, next.viewportMode, next.tabletFeatureMode)) return closeSurface(next);
      return next;
    }
    case "feature": {
      const next = { ...current, featureMode: FEATURE_MODES.has(event.featureMode) ? event.featureMode : "legacy" };
      return isMobileShellV2Enabled(next.featureMode, next.viewportMode, next.tabletFeatureMode) ? next : closeSurface(next);
    }
    case "tablet-feature": {
      const next = { ...current, tabletFeatureMode: FEATURE_MODES.has(event.featureMode) ? event.featureMode : "legacy" };
      return isMobileShellV2Enabled(next.featureMode, next.viewportMode, next.tabletFeatureMode) ? next : closeSurface(next);
    }
    case "route": {
      const route = MOBILE_ROUTES.has(event.route) ? event.route : current.route;
      const routeHistory = event.replace === true || route === current.route
        ? current.routeHistory
        : [...current.routeHistory, current.route].slice(-16);
      return { ...closeSurface(current), route, routeHistory };
    }
    case "surface": {
      if (!MOBILE_SURFACES.has(event.surface) || event.surface === "none") return closeSurface(current);
      return { ...current, surface: event.surface, surfacePage: event.page || "root" };
    }
    case "surface-page": {
      if (current.surface === "none" || !safeString(event.page)) return current;
      return { ...current, surfacePage: event.page };
    }
    case "back": {
      if (current.surface === "dialog") return closeSurface(current);
      if (current.surface !== "none" && current.surfacePage !== "root") return { ...current, surfacePage: "root" };
      if (current.surface !== "none") return closeSurface(current);
      const previousRoute = current.routeHistory.at(-1);
      if (!previousRoute) return current;
      return { ...current, route: previousRoute, routeHistory: current.routeHistory.slice(0, -1) };
    }
    default:
      return current;
  }
}

export function normalizeMobileNavigationTarget(value) {
  const target = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (target.v !== MOBILE_TARGET_VERSION || !MOBILE_ROUTES.has(target.route)) return null;
  const tabId = opaqueId(target.tabId);
  const runId = opaqueId(target.runId);
  const blockerId = opaqueId(target.blockerId);
  if (!tabId && !runId && !blockerId) return null;
  return {
    v: MOBILE_TARGET_VERSION,
    route: target.route,
    ...(tabId ? { tabId } : {}),
    ...(runId ? { runId } : {}),
    ...(blockerId ? { blockerId } : {}),
  };
}

export function mobileNavigationTargetFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const target = {
    v: MOBILE_TARGET_VERSION,
    route: params.get("mobileRoute"),
    tabId: params.get("tab"),
    runId: params.get("run"),
    blockerId: params.get("blocker"),
  };
  return normalizeMobileNavigationTarget(target);
}

export function mobileNavigationTargetSearch(target) {
  const normalized = normalizeMobileNavigationTarget(target);
  if (!normalized) return "";
  const params = new URLSearchParams({ mobileRoute: normalized.route });
  if (normalized.tabId) params.set("tab", normalized.tabId);
  if (normalized.runId) params.set("run", normalized.runId);
  if (normalized.blockerId) params.set("blocker", normalized.blockerId);
  return params.toString();
}
