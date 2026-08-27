import { watch as watchFs } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  DefaultPackageManager,
  ProjectTrustStore,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

export const THEME_LIMITS = Object.freeze({
  maxThemes: 128,
  maxResourceEntries: 256,
  maxThemeFileBytes: 128 * 1024,
  maxThemeNameCharacters: 64,
  maxVariables: 128,
  maxVariableDepth: 16,
  maxDiagnostics: 64,
  maxDiagnosticCharacters: 200,
  reloadDebounceMs: 120,
});

export const REQUIRED_THEME_TOKENS = Object.freeze([
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
]);

export const OPTIONAL_THEME_TOKENS = Object.freeze(["thinkingMax", "scrollbarThumb", "searchMatchBg", "searchMatchText"]);
const BACKGROUND_TOKENS = new Set(["selectedBg", "scrollbarThumb", "searchMatchBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
const EXPORT_FIELDS = new Set(["pageBg", "cardBg", "infoBg"]);

export const SEMANTIC_PALETTE_ROLES = Object.freeze([
  "mainSurface", "sidebarSurface", "sidebarBorder", "panelSurface", "windowBackground", "surface", "surfaceRaised", "assistantBubble", "userBubble",
  "foreground", "heading", "muted", "border", "frameBorder", "accent", "accentForeground", "link", "focusRing", "userBorder", "assistantBorder",
  "controlSurface", "controlHover", "controlPressed", "controlActive", "controlSelected", "controlBorder", "controlActiveBorder", "controlSelectedBorder",
  "disabledSurface", "disabledForeground", "primaryButtonBackground", "primaryButtonHover", "primaryButtonPressed", "primaryButtonForeground", "primaryButtonHoverForeground", "primaryButtonPressedForeground",
  "destructiveButtonBackground", "destructiveButtonHover", "destructiveButtonPressed", "destructiveButtonForeground", "destructiveButtonHoverForeground", "destructiveButtonPressedForeground",
  "warningButtonBackground", "warningButtonHover", "warningButtonPressed", "warningButtonForeground", "buttonForeground", "composerSurface", "composerBorder",
  "destructive", "warning", "urgentBackground", "urgentBorder", "urgentForeground", "selection", "selectionForeground", "searchHighlight",
  "codeBackground", "codeForeground", "codeBorder", "quoteBorder", "tableBorder", "thinkingForeground", "thinkingBackground", "thinkingBorder", "dialogOverlay",
  "syntaxKeyword", "syntaxString", "syntaxComment", "syntaxNumber", "syntaxConstant", "syntaxType", "syntaxFunction", "syntaxAttribute", "syntaxTag", "syntaxVariable", "syntaxOperator", "syntaxPunctuation",
  "diffAdded", "diffRemoved", "diffAddedForeground", "diffRemovedForeground", "diffHunk", "success", "readyBackground", "readyBorder", "readyForeground",
  "runningBackground", "runningBorder", "runningForeground", "toolBackground", "toolBorder", "toolForeground", "errorBackground", "errorBorder", "errorForeground",
  "neutralBackground", "neutralBorder", "neutralForeground", "errorPanelBackground", "errorPanelBorder", "errorPanelForeground", "infoPanelBackground", "infoPanelBorder", "infoPanelForeground",
  "warningPanelBackground", "warningPanelBorder", "warningPanelForeground",
]);

const COMMON_TEXT_FOREGROUNDS = Object.freeze(["foreground", "heading", "muted", "accentForeground", "link", "buttonForeground"]);
const COMMON_TEXT_BACKGROUNDS = Object.freeze([
  "mainSurface", "sidebarSurface", "panelSurface", "windowBackground", "surface", "surfaceRaised", "assistantBubble", "userBubble",
  "controlSurface", "controlHover", "controlPressed", "controlActive", "controlSelected", "composerSurface", "searchHighlight",
]);
const NORMAL_TEXT_PAIRS = Object.freeze([
  ["disabledForeground", "disabledSurface"], ["selectionForeground", "selection"], ["codeForeground", "codeBackground"],
  ["codeForeground", "diffHunk"], ["thinkingForeground", "thinkingBackground"],
  ["syntaxKeyword", "codeBackground"], ["syntaxString", "codeBackground"], ["syntaxComment", "codeBackground"], ["syntaxNumber", "codeBackground"],
  ["syntaxConstant", "codeBackground"], ["syntaxType", "codeBackground"], ["syntaxFunction", "codeBackground"], ["syntaxAttribute", "codeBackground"],
  ["syntaxTag", "codeBackground"], ["syntaxVariable", "codeBackground"], ["syntaxOperator", "codeBackground"], ["syntaxPunctuation", "codeBackground"],
  ["diffAddedForeground", "diffAdded"], ["diffRemovedForeground", "diffRemoved"],
  ["primaryButtonForeground", "primaryButtonBackground"], ["primaryButtonHoverForeground", "primaryButtonHover"], ["primaryButtonPressedForeground", "primaryButtonPressed"],
  ["destructiveButtonForeground", "destructiveButtonBackground"], ["destructiveButtonHoverForeground", "destructiveButtonHover"], ["destructiveButtonPressedForeground", "destructiveButtonPressed"],
  ["warningButtonForeground", "warningButtonBackground"], ["urgentForeground", "urgentBackground"], ["readyForeground", "readyBackground"],
  ["runningForeground", "runningBackground"], ["toolForeground", "toolBackground"], ["errorForeground", "errorBackground"], ["neutralForeground", "neutralBackground"],
  ["errorPanelForeground", "errorPanelBackground"], ["infoPanelForeground", "infoPanelBackground"], ["warningPanelForeground", "warningPanelBackground"],
]);
const INDICATOR_PAIRS = Object.freeze([
  ["focusRing", "windowBackground"], ["controlActiveBorder", "controlSurface"], ["controlSelectedBorder", "controlSelected"],
  ["urgentBorder", "urgentBackground"], ["readyBorder", "readyBackground"], ["runningBorder", "runningBackground"], ["toolBorder", "toolBackground"], ["errorBorder", "errorBackground"],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function themeName(value) {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= THEME_LIMITS.maxThemeNameCharacters
    && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function rgbToHex(rgb) {
  return `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;
}

export function xtermColor(index) {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error("color index must be an integer from 0 to 255");
  const ansi = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ];
  if (index < 16) return ansi[index];
  if (index < 232) {
    const cube = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return rgbToHex([levels[Math.floor(cube / 36)], levels[Math.floor(cube / 6) % 6], levels[cube % 6]]);
  }
  const gray = 8 + (index - 232) * 10;
  return rgbToHex([gray, gray, gray]);
}

function luminance(color) {
  const rgb = hexToRgb(color);
  if (!rgb) throw new Error(`invalid RGB color ${color}`);
  const linear = rgb.map((part) => {
    const channel = part / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first, second) {
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

export function blend(first, second, amount) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  if (!a || !b) throw new Error("blend colors must be six-digit RGB hex values");
  return rgbToHex(a.map((part, index) => part + (b[index] - part) * amount));
}

function repairContrast(foreground, background, minimum) {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const target = contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff";
  let low = 0;
  let high = 1;
  for (let index = 0; index < 16; index += 1) {
    const middle = (low + high) / 2;
    if (contrastRatio(blend(foreground, target, middle), background) >= minimum) high = middle;
    else low = middle;
  }
  return blend(foreground, target, high);
}

function repairContrastAcross(foreground, target, backgrounds, minimum) {
  if (backgrounds.every((background) => contrastRatio(foreground, background) >= minimum)) return foreground;
  for (let step = 1; step <= 256; step += 1) {
    const candidate = blend(foreground, target, step / 256);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum)) return candidate;
  }
  return target;
}

function colorResolver(raw) {
  const variables = raw.vars ?? {};
  if (!isObject(variables) || Object.keys(variables).length > THEME_LIMITS.maxVariables) throw new Error(`vars must be an object with at most ${THEME_LIMITS.maxVariables} entries`);
  for (const name of Object.keys(variables)) {
    if (name.length === 0 || name.length > THEME_LIMITS.maxThemeNameCharacters || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error("variable names must be non-empty, bounded, and contain no control character");
    }
  }
  function resolve(value, stack = []) {
    if (Number.isInteger(value) && value >= 0 && value <= 255) return xtermColor(value);
    if (value === "") return null;
    if (typeof value !== "string") throw new Error("colors must be six-digit hex, xterm indexes, variables, or an empty terminal default");
    const rgb = hexToRgb(value);
    if (rgb) return value.toLowerCase();
    if (!Object.hasOwn(variables, value)) throw new Error(`unknown color variable ${value}`);
    if (stack.includes(value)) throw new Error(`color variable cycle at ${value}`);
    if (stack.length >= THEME_LIMITS.maxVariableDepth) throw new Error(`color variables exceed depth ${THEME_LIMITS.maxVariableDepth}`);
    return resolve(variables[value], [...stack, value]);
  }
  for (const name of Object.keys(variables)) resolve(variables[name]);
  return resolve;
}

export function parsePiTheme(raw) {
  if (!isObject(raw)) throw new Error("theme must be a JSON object");
  if (raw.$schema !== undefined && typeof raw.$schema !== "string") throw new Error("$schema must be a string");
  if (!themeName(raw.name)) throw new Error(`name must be 1-${THEME_LIMITS.maxThemeNameCharacters} characters with no slash or control character`);
  if (!isObject(raw.colors)) throw new Error("colors must be an object");
  for (const token of REQUIRED_THEME_TOKENS) if (!Object.hasOwn(raw.colors, token)) throw new Error(`missing required color ${token}`);
  const resolve = colorResolver(raw);
  const colors = {};
  for (const token of [...REQUIRED_THEME_TOKENS, ...OPTIONAL_THEME_TOKENS]) {
    if (Object.hasOwn(raw.colors, token)) colors[token] = resolve(raw.colors[token]);
  }
  colors.thinkingMax ??= colors.thinkingXhigh;
  colors.scrollbarThumb ??= colors.selectedBg;
  colors.searchMatchBg ??= colors.selectedBg;
  colors.searchMatchText ??= colors.text;
  const exported = {};
  if (raw.export !== undefined) {
    if (!isObject(raw.export)) throw new Error("export must be an object");
    for (const key of EXPORT_FIELDS) {
      if (Object.hasOwn(raw.export, key)) exported[key] = resolve(raw.export[key]);
    }
  }
  return { name: raw.name, colors, export: exported };
}

function inferredDefaults(theme) {
  const explicitBackground = theme.export.pageBg ?? theme.colors.userMessageBg ?? theme.colors.customMessageBg;
  const background = explicitBackground ?? "#181818";
  const foreground = theme.colors.userMessageText ?? theme.colors.customMessageText
    ?? (contrastRatio("#e6e6e6", background) >= 4.5 ? "#e6e6e6" : "#202020");
  return { background, foreground };
}

function resolvedColors(theme) {
  const defaults = inferredDefaults(theme);
  const colors = {};
  for (const [token, color] of Object.entries(theme.colors)) colors[token] = color ?? (BACKGROUND_TOKENS.has(token) ? defaults.background : defaults.foreground);
  return { colors, defaults };
}

function diagnostic(message, code = "theme_adjusted", theme = "") {
  return {
    level: "warning",
    code,
    message: String(message).replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").slice(0, THEME_LIMITS.maxDiagnosticCharacters),
    ...(theme ? { theme } : {}),
  };
}

export function mapThemePalette(theme) {
  const { colors: c, defaults } = resolvedColors(theme);
  const bg = defaults.background;
  const surface = c.customMessageBg;
  const raised = c.userMessageBg;
  const palette = {
    mainSurface: bg, sidebarSurface: raised, sidebarBorder: c.borderMuted, panelSurface: surface,
    windowBackground: bg, surface, surfaceRaised: raised, assistantBubble: surface, userBubble: c.userMessageBg,
    foreground: c.text, heading: c.mdHeading, muted: c.muted, border: c.borderMuted, frameBorder: c.border, accent: c.accent,
    accentForeground: c.accent, link: c.mdLink, focusRing: c.borderAccent, userBorder: c.accent, assistantBorder: c.borderMuted,
    controlSurface: raised, controlHover: blend(raised, c.accent, 0.12), controlPressed: blend(raised, c.accent, 0.22), controlActive: c.userMessageBg,
    controlSelected: c.selectedBg, controlBorder: c.borderMuted, controlActiveBorder: c.borderAccent, controlSelectedBorder: c.accent,
    disabledSurface: blend(surface, c.muted, 0.12), disabledForeground: c.dim,
    primaryButtonBackground: c.accent, primaryButtonHover: blend(c.accent, c.text, 0.16), primaryButtonPressed: blend(c.accent, bg, 0.2),
    primaryButtonForeground: c.text, primaryButtonHoverForeground: c.text, primaryButtonPressedForeground: c.text,
    destructiveButtonBackground: c.error, destructiveButtonHover: blend(c.error, c.text, 0.16), destructiveButtonPressed: blend(c.error, bg, 0.2),
    destructiveButtonForeground: c.text, destructiveButtonHoverForeground: c.text, destructiveButtonPressedForeground: c.text,
    warningButtonBackground: c.warning, warningButtonHover: blend(c.warning, c.text, 0.16), warningButtonPressed: blend(c.warning, bg, 0.2), warningButtonForeground: c.text,
    buttonForeground: c.text, composerSurface: surface, composerBorder: c.border,
    destructive: c.error, warning: c.warning, urgentBackground: c.toolErrorBg, urgentBorder: c.error, urgentForeground: c.error,
    selection: c.selectedBg, selectionForeground: c.searchMatchText, searchHighlight: c.searchMatchBg,
    codeBackground: c.toolPendingBg, codeForeground: c.mdCodeBlock, codeBorder: c.mdCodeBlockBorder, quoteBorder: c.mdQuoteBorder, tableBorder: c.borderMuted,
    thinkingForeground: c.thinkingText, thinkingBackground: blend(surface, c.thinkingMedium, 0.12), thinkingBorder: c.thinkingMedium,
    dialogOverlay: "#99000000",
    syntaxKeyword: c.syntaxKeyword, syntaxString: c.syntaxString, syntaxComment: c.syntaxComment, syntaxNumber: c.syntaxNumber,
    syntaxConstant: c.syntaxVariable, syntaxType: c.syntaxType, syntaxFunction: c.syntaxFunction, syntaxAttribute: c.syntaxVariable,
    syntaxTag: c.syntaxKeyword, syntaxVariable: c.syntaxVariable, syntaxOperator: c.syntaxOperator, syntaxPunctuation: c.syntaxPunctuation,
    diffAdded: blend(surface, c.toolDiffAdded, 0.18), diffRemoved: blend(surface, c.toolDiffRemoved, 0.18),
    diffAddedForeground: c.toolDiffAdded, diffRemovedForeground: c.toolDiffRemoved, diffHunk: c.selectedBg,
    success: c.success, readyBackground: c.toolSuccessBg, readyBorder: c.success, readyForeground: c.success,
    runningBackground: blend(surface, c.accent, 0.14), runningBorder: c.accent, runningForeground: c.accent,
    toolBackground: c.toolPendingBg, toolBorder: c.warning, toolForeground: c.toolTitle,
    errorBackground: c.toolErrorBg, errorBorder: c.error, errorForeground: c.error,
    neutralBackground: raised, neutralBorder: c.borderMuted, neutralForeground: c.text,
    errorPanelBackground: c.toolErrorBg, errorPanelBorder: c.error, errorPanelForeground: c.error,
    infoPanelBackground: blend(surface, c.accent, 0.14), infoPanelBorder: c.accent, infoPanelForeground: c.accent,
    warningPanelBackground: c.toolPendingBg, warningPanelBorder: c.warning, warningPanelForeground: c.warning,
  };
  const diagnostics = [];
  const baseForeground = repairContrast(palette.foreground, palette.windowBackground, 4.5);
  if (baseForeground !== palette.foreground) {
    palette.foreground = baseForeground;
    diagnostics.push(diagnostic("Adjusted foreground to meet 4.5:1 contrast", "contrast_repaired", theme.name));
  }
  for (const background of COMMON_TEXT_BACKGROUNDS) {
    const repaired = repairContrast(palette[background], palette.foreground, 4.5);
    if (repaired !== palette[background]) {
      palette[background] = repaired;
      if (background === "controlSelected") palette.selection = repaired;
      diagnostics.push(diagnostic(`Adjusted ${background} to preserve 4.5:1 text contrast`, "contrast_repaired", theme.name));
    }
  }
  const commonBackgrounds = COMMON_TEXT_BACKGROUNDS.map((role) => palette[role]);
  for (const foreground of COMMON_TEXT_FOREGROUNDS) {
    const repaired = repairContrastAcross(palette[foreground], palette.foreground, commonBackgrounds, 4.5);
    if (repaired !== palette[foreground]) {
      palette[foreground] = repaired;
      diagnostics.push(diagnostic(`Adjusted ${foreground} across text surfaces to meet 4.5:1 contrast`, "contrast_repaired", theme.name));
    }
  }
  for (const [foreground, background] of NORMAL_TEXT_PAIRS) {
    const repaired = repairContrast(palette[foreground], palette[background], 4.5);
    if (repaired !== palette[foreground]) {
      palette[foreground] = repaired;
      diagnostics.push(diagnostic(`Adjusted ${foreground} to meet 4.5:1 contrast`, "contrast_repaired", theme.name));
    }
  }
  for (const [foreground, background] of INDICATOR_PAIRS) {
    const repaired = repairContrast(palette[foreground], palette[background], 3);
    if (repaired !== palette[foreground]) {
      palette[foreground] = repaired;
      diagnostics.push(diagnostic(`Adjusted ${foreground} to meet 3:1 contrast`, "contrast_repaired", theme.name));
    }
  }
  for (const role of SEMANTIC_PALETTE_ROLES) if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(palette[role])) throw new Error(`palette role ${role} is incomplete`);
  return { palette, diagnostics };
}

export async function resolveInstalledThemeResources({
  cwd,
  agentDir,
  SettingsManagerClass = SettingsManager,
  ProjectTrustStoreClass = ProjectTrustStore,
  PackageManagerClass = DefaultPackageManager,
}) {
  const bootstrap = SettingsManagerClass.create(cwd, agentDir, { projectTrusted: false });
  const saved = new ProjectTrustStoreClass(agentDir).get(cwd);
  const projectTrusted = saved === null ? bootstrap.getDefaultProjectTrust() === "always" : saved === true;
  const settingsManager = SettingsManagerClass.create(cwd, agentDir, { projectTrusted });
  const packageManager = new PackageManagerClass({ cwd, agentDir, settingsManager });
  const resolved = await packageManager.resolve(async () => "skip");
  return { resources: resolved.themes, projectTrusted };
}

async function filesForResource(resource, fsApi) {
  const details = await fsApi.stat(resource.path);
  if (details.isFile()) return resource.path.endsWith(".json") ? [resource.path] : [];
  if (!details.isDirectory()) return [];
  return (await fsApi.readdir(resource.path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(resource.path, entry.name))
    .sort();
}

function safeDiagnosticMessage(value) {
  return String(value || "Theme error")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/(?:[A-Za-z]:\\|\/)[^\s,;:]+/g, "<path>")
    .slice(0, THEME_LIMITS.maxDiagnosticCharacters);
}

function boundedDiagnostics(entries) {
  return entries.slice(0, THEME_LIMITS.maxDiagnostics).map((entry) => ({
    level: entry.level === "error" ? "error" : "warning",
    code: String(entry.code || "theme_error").slice(0, 64),
    message: safeDiagnosticMessage(entry.message),
    ...(themeName(entry.theme) ? { theme: entry.theme } : {}),
  }));
}

function builtInIdentity(name) {
  return { kind: "builtin", name };
}

function externalIdentity(name) {
  return { kind: "external", name };
}

export function createThemeService({
  cwd = process.cwd(),
  agentDir = getAgentDir(),
  settingsStore,
  resolveResources = resolveInstalledThemeResources,
  piApi = {},
  fsApi = { readFile, readdir, stat },
  watch = watchFs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onChange = () => {},
} = {}) {
  if (!settingsStore || typeof settingsStore.read !== "function" || typeof settingsStore.write !== "function") throw new Error("theme service requires a settings store");
  let generation = 0;
  let stable = null;
  let refreshQueue = Promise.resolve();
  let watcher = null;
  let watchedDirectory = "";
  let reloadTimer = null;
  let stopped = false;
  let lastActiveSource = "";

  function requestedFromSettings() {
    const settings = settingsStore.read().settings;
    return settings.selectedThemeName ? externalIdentity(settings.selectedThemeName) : builtInIdentity(settings.appearanceMode);
  }

  function inventoryFor(themes) {
    return ["automatic", "light", "dark"].map((name) => ({ identity: builtInIdentity(name), label: name === "automatic" ? "Automatic" : name[0].toUpperCase() + name.slice(1) }))
      .concat([...themes.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ identity: externalIdentity(name), label: name })));
  }

  function watchDirectory(directory) {
    if (stopped || directory === watchedDirectory) return;
    if (watcher) watcher.close();
    watcher = null;
    watchedDirectory = directory;
    if (!directory) return;
    try {
      watcher = watch(directory, { persistent: false }, () => {
        if (reloadTimer) clearTimer(reloadTimer);
        reloadTimer = setTimer(() => {
          reloadTimer = null;
          refresh({ reason: "watch" }).then((state) => onChange(state), () => {});
        }, THEME_LIMITS.reloadDebounceMs);
      });
      watcher.on?.("error", () => {});
    } catch {
      watchedDirectory = "";
    }
  }

  async function discover() {
    const diagnostics = [];
    let result;
    try {
      result = await resolveResources({ cwd, agentDir, ...piApi });
    } catch (error) {
      return { themes: new Map(), diagnostics: [diagnostic(`Theme discovery failed: ${error?.message ?? error}`, "discovery_failed")], projectTrusted: false };
    }
    const themes = new Map();
    const allResources = Array.isArray(result?.resources) ? result.resources : [];
    const resources = allResources.slice(0, THEME_LIMITS.maxResourceEntries);
    if (allResources.length > resources.length) diagnostics.push(diagnostic(`Theme resources are limited to ${THEME_LIMITS.maxResourceEntries} entries`, "resources_limited"));
    let examined = 0;
    for (const resource of resources) {
      if (examined >= THEME_LIMITS.maxThemes) {
        diagnostics.push(diagnostic(`Theme catalog is limited to ${THEME_LIMITS.maxThemes} files`, "catalog_limited"));
        break;
      }
      if (!resource || resource.enabled !== true || typeof resource.path !== "string") continue;
      if (resource.metadata?.scope === "project" && result.projectTrusted !== true) continue;
      let files;
      try {
        files = await filesForResource(resource, fsApi);
      } catch {
        diagnostics.push(diagnostic("An installed theme resource could not be read", "resource_unreadable"));
        continue;
      }
      for (const file of files) {
        if (examined >= THEME_LIMITS.maxThemes) break;
        examined += 1;
        try {
          const details = await fsApi.stat(file);
          if (details.size > THEME_LIMITS.maxThemeFileBytes) throw new Error(`theme file exceeds ${THEME_LIMITS.maxThemeFileBytes} bytes`);
          const text = await fsApi.readFile(file, "utf8");
          if (Buffer.byteLength(text, "utf8") > THEME_LIMITS.maxThemeFileBytes) throw new Error(`theme file exceeds ${THEME_LIMITS.maxThemeFileBytes} bytes`);
          const parsed = parsePiTheme(JSON.parse(text));
          if (themes.has(parsed.name)) {
            diagnostics.push(diagnostic(`Ignored duplicate theme ${parsed.name}; earlier resolved resource wins`, "duplicate_theme", parsed.name));
            continue;
          }
          const mapped = mapThemePalette(parsed);
          themes.set(parsed.name, { ...parsed, palette: mapped.palette, sourcePath: file });
          diagnostics.push(...mapped.diagnostics);
        } catch (error) {
          diagnostics.push(diagnostic(`Ignored invalid theme: ${error?.message ?? error}`, "invalid_theme"));
        }
      }
    }
    return { themes, diagnostics: boundedDiagnostics(diagnostics), projectTrusted: result?.projectTrusted === true };
  }

  function publish(discovered, currentGeneration) {
    const requested = requestedFromSettings();
    const active = requested.kind === "external" ? discovered.themes.get(requested.name) : null;
    if (active) lastActiveSource = active.sourcePath;
    const fallbackReason = requested.kind === "external" && !active ? "requested_theme_unavailable" : "";
    const effective = active ? requested : builtInIdentity(settingsStore.read().settings.appearanceMode);
    stable = Object.freeze({
      generation: currentGeneration,
      requested,
      effective,
      fallbackReason,
      inventory: inventoryFor(discovered.themes),
      diagnostics: boundedDiagnostics(discovered.diagnostics),
      palette: active ? { ...active.palette } : null,
      projectTrusted: discovered.projectTrusted,
    });
    const watchSource = active?.sourcePath ?? (requested.kind === "external" ? lastActiveSource : "");
    watchDirectory(watchSource ? path.dirname(watchSource) : "");
    return stable;
  }

  function refresh() {
    const operation = async () => {
      if (stopped) return stable;
      const currentGeneration = ++generation;
      const discovered = await discover();
      if (stopped) return stable;
      return publish(discovered, currentGeneration);
    };
    refreshQueue = refreshQueue.then(operation, operation);
    return refreshQueue;
  }

  async function list() {
    return refresh();
  }

  async function select(selection) {
    if (!stable) await refresh();
    if (!isObject(selection) || !["builtin", "external"].includes(selection.kind) || !themeName(selection.name)) throw new Error("theme selection must be a typed built-in or external identity");
    if (selection.kind === "builtin") {
      if (!["automatic", "light", "dark"].includes(selection.name)) throw new Error("unknown built-in theme");
      settingsStore.write({ appearanceMode: selection.name, selectedThemeName: "" });
    } else {
      const available = stable.inventory.some((entry) => entry.identity.kind === "external" && entry.identity.name === selection.name);
      if (!available) {
        const error = new Error("selected external theme is no longer available");
        error.code = "theme_unavailable";
        throw error;
      }
      settingsStore.write({ selectedThemeName: selection.name });
    }
    return refresh();
  }

  function snapshot() {
    return stable;
  }

  function stop() {
    stopped = true;
    generation += 1;
    if (reloadTimer) clearTimer(reloadTimer);
    reloadTimer = null;
    if (watcher) watcher.close();
    watcher = null;
    watchedDirectory = "";
  }

  return { refresh, list, select, snapshot, stop };
}
