import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Static guard for the Light / Dark / Auto theme scheme switch: the picker stores
// theme picks in the matching light/dark slot, "auto" follows the OS prefers-color-scheme,
// and existing users keep their theme (auto is opt-in). This locks the wiring across
// app.js / index.html / styles.css, including the persistence rules: theme names are
// only stored after a pick was validated and applied, never from degraded loads.

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
assert.match(
  app,
  /function seedThemeSchemeFromStoredTheme\(\)[\s\S]*?if \(!storedTheme\) return "dark";[\s\S]*?storeThemeMode\(scheme\);/,
  "migration must not persist mode or slots when the stored theme is unresolvable (degraded bundle load)",
);

// Persistence lives inside applyTheme's validated persist branch (matching light/dark
// scheme slot + legacy key), reached only after setThemeByName found and classified
// the theme. chooseTheme is the single persist:true entry point; applySchemeTheme
// (init, mode switches, OS changes) never persists, so a degraded bundle load cannot
// clobber stored picks.
assert.match(
  app,
  /if \(persist\) \{\s*storeSchemeTheme\(isLight \? "light" : "dark", theme\.name\);\s*storeThemeName\(theme\.name\);\s*\}/,
  "applyTheme's persist branch must write the theme's matching scheme slot and the legacy key",
);
assert.equal(
  (app.match(/persist: true/g) || []).length,
  1,
  "chooseTheme must be the only persist:true call site",
);
assert.match(
  app,
  /async function chooseTheme\(name, options = \{\}\) \{\s*await setThemeByName\(name, \{ \.\.\.options, persist: true \}\);\s*\}/,
  "chooseTheme should delegate persistence to the validated setThemeByName path",
);
assert.match(
  app,
  /async function applySchemeTheme\(options = \{\}\) \{\s*await setThemeByName\(effectiveThemeName\(\), \{ \.\.\.options, persist: false \}\);\s*\}/,
  "applySchemeTheme must never persist",
);

// Auto mode also works on MediaQueryList implementations without addEventListener
// (legacy addListener API), matching the mobileViewMedia wiring.
assert.match(
  app,
  /colorSchemeMedia\.addListener\?\.\(handleOsSchemeChange\)/,
  "updateColorSchemeListener should fall back to the legacy addListener API",
);
assert.match(app, /elements\.themeSelect\.addEventListener\("change"[\s\S]*?chooseTheme\(/, "select change should call chooseTheme");
assert.match(
  app,
  /elements\.themeSchemeToggle\?\.querySelectorAll\("\[data-scheme-mode\]"\)[\s\S]*?setThemeSchemeMode\(button\.dataset\.schemeMode/,
  "toggle buttons should call setThemeSchemeMode",
);
assert.ok(app.includes('themeSchemeToggle: $("#themeSchemeToggle")'), "themeSchemeToggle element should be registered");
assert.match(
  app,
  /theme-search-result-scheme[\s\S]*?themeIsLight\(theme\) \? "Light" : "Dark"/,
  "theme search rows should show a Light/Dark scheme label next to each theme name",
);

// ── index.html: the switch markup ────────────────────────────────────────────
assert.match(html, /id="themeSchemeToggle"[^>]*role="group"/, "index.html should contain the theme scheme toggle group");
for (const mode of ["light", "dark", "auto"]) {
  assert.match(html, new RegExp(`data-scheme-mode="${mode}"`), `toggle should have a ${mode} button`);
}

// ── styles.css: the switch styling ───────────────────────────────────────────
assert.match(css, /\.theme-scheme-toggle\s*\{/, "styles.css should style the toggle");
assert.match(css, /\.theme-scheme-toggle button\.active\s*\{/, "styles.css should style the active mode");
assert.match(css, /\.theme-search-result-title\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/, "theme rows should place the scheme label beside the name");
assert.match(css, /\.theme-search-result-scheme\s*\{/, "styles.css should style theme scheme labels");

console.log("theme-scheme-mode: all assertions passed");
