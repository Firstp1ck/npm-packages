# Pi WebUI Theme Bundle Findings

## Summary

`@firstpick/pi-themes-bundle` is installed and registered correctly, but Pi WebUI `0.8.5` does not discover its browser themes. This is a WebUI package-resolution bug, not a failed installation or browser-cache problem.

## Environment

- Pi WebUI: `@firstpick/pi-package-webui@0.8.5`
- Pi: `@earendil-works/pi-coding-agent@0.83.0`
- Theme bundle: `@firstpick/pi-themes-bundle@0.1.5`
- WebUI URL: `http://127.0.0.1:31415/`

## Evidence

### The package is registered in Pi settings

`C:\Users\Firstpick\.pi\agent\settings.json` contains:

```json
"npm:@firstpick/pi-themes-bundle"
```

### The theme files are installed

The bundle exists at:

```text
C:\Users\Firstpick\.pi\agent\npm\node_modules\@firstpick\pi-themes-bundle
```

Its `themes` directory contains 16 valid theme JSON files, each defining all 51 required color tokens.

### Pi RPC tabs load the themes

The WebUI-managed Pi RPC command includes a `--theme` argument for every theme file. Therefore, Pi's resource resolver finds and loads the package correctly.

### The browser theme endpoint returns no themes

The live endpoint returns an empty list:

```http
GET http://127.0.0.1:31415/api/themes
```

```json
{
  "ok": true,
  "data": {
    "source": "@firstpick/pi-themes-bundle",
    "themes": []
  }
}
```

### WebUI cannot resolve the package

Resolving the bundle from the globally installed WebUI package fails with `MODULE_NOT_FOUND`:

```text
Cannot find module '@firstpick/pi-themes-bundle/package.json'
```

## Root Cause

The WebUI server is globally installed under:

```text
C:\Users\Firstpick\AppData\Roaming\npm\node_modules\@firstpick\pi-package-webui
```

Pi installs optional packages separately under:

```text
C:\Users\Firstpick\.pi\agent\npm\node_modules
```

In `bin/pi-webui.mjs`, `resolveBundledThemesDir()` searches only:

1. The WebUI package's own Node module resolution tree using `require.resolve()`.
2. A sibling development-checkout path.

It does not search Pi's `agentDir/npm/node_modules` package directory. Consequently, the optional-feature audit reports the package as installed and ready, while `/api/themes` independently returns no themes.

Restarting Pi, restarting WebUI tabs, or hard-refreshing the browser cannot fix this unresolved server-side path.

## Proper Code Fix

File:

```text
C:\Users\Firstpick\AppData\Roaming\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs
```

Add the Pi-managed npm package directory as a candidate inside `resolveBundledThemesDir()`, before the development sibling fallback:

```js
candidates.push(
  path.join(
    agentDir,
    "npm",
    "node_modules",
    "@firstpick",
    "pi-themes-bundle",
    "themes",
  ),
);
```

After applying the fix, fully restart the WebUI server and reload the browser. The corrected `/api/themes` response should contain the 16 installed themes.

A durable release should implement this in `@firstpick/pi-package-webui`; directly editing the globally installed file will be overwritten by a package update.

## Temporary Workaround

Install a second copy in the global npm tree so the existing `require.resolve()` lookup can find it:

```powershell
npm install -g @firstpick/pi-themes-bundle@0.1.5
```

Then fully restart the WebUI server.

This global copy is only a workaround. The existing Pi installation is already correct and does not need to be repeated.
