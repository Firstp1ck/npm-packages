import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Static guard for the Light / Dark / Auto theme scheme switch: the picker chooses
// the theme for the active scheme, "auto" follows the OS prefers-color-scheme, and
// existing users keep their theme (auto is opt-in). Full behavior is exercised by the
// Playwright harness; this locks the wiring across app.js / index.html / styles.css.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const html = await readFile(join(root, "public", "index.html"), "utf8");
const css = await readFile(join(root, "public", "styles.css"), "utf8");

// ── app.js: state, storage, and scheme resolution ────────────────────────────
for (const decl of [
  'const THEME_MODE_STORAGE_KEY = "pi-webui-theme-mode"',
  'const THEME_LIGHT_STORAGE_KEY = "pi-webui-theme-light"',
  'const THEME_DARK_STORAGE_KEY = "pi-webui-theme-dark"',
  'const THEME_SCHEME_MODES = new Set(["light", "dark", "auto"])',
  'window.matchMedia?.("(prefers-color-scheme: dark)")',
]) {
  assert.ok(app.includes(decl), `app.js should declare: ${decl}`);
}

for (const fn of [
  "function osPrefersDark(",
  "function effectiveScheme(",
  "function effectiveThemeName(",
  "function renderThemeSchemeToggle(",
  "async function applySchemeTheme(",
  "async function chooseTheme(",
  "function handleOsSchemeChange(",
  "function updateColorSchemeListener(",
  "async function setThemeSchemeMode(",
  "function seedThemeSchemeFromStoredTheme(",
  "function storedThemeMode(",
  "function storedSchemeTheme(",
]) {
  assert.ok(app.includes(fn), `app.js should define ${fn.replace(/\($/, "")}`);
}

// Auto follows the OS only while the auto mode is active.
assert.match(
  app,
  /function updateColorSchemeListener\(\)[\s\S]*?addEventListener\("change", handleOsSchemeChange\)/,
  "auto mode should attach an OS prefers-color-scheme listener",
);
assert.match(
  app,
  /function handleOsSchemeChange\(\)\s*\{\s*if \(themeSchemeMode !== "auto"\) return;/,
  "OS listener must be a no-op outside auto mode",
);

// Existing users keep their theme: migration seeds the matching slot, mode is the
// stored theme's own scheme (never forced to auto).
assert.match(
  app,
  /themeSchemeMode = storedThemeMode\(\) \?\? seedThemeSchemeFromStoredTheme\(\)/,
  "init should reuse a stored mode or migrate the existing theme",
);
assert.ok(
  !/seedThemeSchemeFromStoredTheme[\s\S]*?return "auto"/.test(app),
  "migration must not default existing users to auto",
);

// Every user-initiated theme pick is assigned to the active scheme via chooseTheme,
// never the raw setThemeByName(..., { persist: true }) path.
assert.ok(
  !app.includes('setThemeByName(') || !/setThemeByName\([^)]*persist:\s*true/.test(app),
  "theme picks must route through chooseTheme, not setThemeByName persist:true",
);
assert.match(app, /elements\.themeSelect\.addEventListener\("change"[\s\S]*?chooseTheme\(/, "select change should call chooseTheme");
assert.match(
  app,
  /elements\.themeSchemeToggle\?\.querySelectorAll\("\[data-scheme-mode\]"\)[\s\S]*?setThemeSchemeMode\(button\.dataset\.schemeMode/,
  "toggle buttons should call setThemeSchemeMode",
);
assert.ok(app.includes('themeSchemeToggle: $("#themeSchemeToggle")'), "themeSchemeToggle element should be registered");

// ── index.html: the switch markup ────────────────────────────────────────────
assert.match(html, /id="themeSchemeToggle"[^>]*role="group"/, "index.html should contain the theme scheme toggle group");
for (const mode of ["light", "dark", "auto"]) {
  assert.match(html, new RegExp(`data-scheme-mode="${mode}"`), `toggle should have a ${mode} button`);
}

// ── styles.css: the switch styling ───────────────────────────────────────────
assert.match(css, /\.theme-scheme-toggle\s*\{/, "styles.css should style the toggle");
assert.match(css, /\.theme-scheme-toggle button\.active\s*\{/, "styles.css should style the active mode");

console.log("theme-scheme-mode: all assertions passed");
