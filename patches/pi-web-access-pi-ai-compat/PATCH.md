# PATCH.md — Replace removed pi-ai compat imports in pi-web-access

## Purpose

Fix Pi Web UI startup when the installed `pi-web-access` package is loaded alongside current Pi packages. The patch updates `pi-web-access` to import AI helpers from the exported `@earendil-works/pi-ai` package entrypoint instead of the removed legacy `@earendil-works/pi-ai/compat` subpath.

### Root cause

`pi-web-access` still imports `StringEnum`, `complete`, `Model`, and `getModel` from `@earendil-works/pi-ai/compat`. Current `@earendil-works/pi-ai@0.79.8` does not export the `./compat` subpath, so extension loading fails during Pi RPC startup with a module resolution error for `@earendil-works/pi-ai/dist/index.js/compat` or `@earendil-works/pi-ai/compat`.

### Expected outcome

Starting the Pi Web UI no longer fails while loading `/home/firstpick/.pi/agent/npm/node_modules/pi-web-access/index.ts`. `pi-web-access` uses the supported `@earendil-works/pi-ai` package entrypoint for the same runtime helpers.

---

## Scope (exact files changed)

> Use POSIX-style paths for portability on Linux/macOS.

Path variables:

- `PI_AGENT_DIR=${HOME}/.pi/agent`

Files:
1. `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/index.ts`
2. `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/summary-review.ts`
3. `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/openai-search.ts`

---

## Change 1 — Update main extension pi-ai import

**File:** `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/index.ts`

### What was changed

Changed the top-level import from the removed compat subpath to the package entrypoint.

Before:

```ts
import { StringEnum, complete, type Model } from "@earendil-works/pi-ai/compat";
```

After:

```ts
import { StringEnum, complete, type Model } from "@earendil-works/pi-ai";
```

### Why

`index.ts` is the extension entrypoint loaded during Pi RPC startup. Importing the removed `@earendil-works/pi-ai/compat` subpath aborts extension loading before the Web UI becomes ready.

---

## Change 2 — Update summary generation pi-ai import

**File:** `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/summary-review.ts`

### What was changed

Changed the summary-generation import from the removed compat subpath to the package entrypoint.

Before:

```ts
import { complete, type Message, type Model } from "@earendil-works/pi-ai/compat";
```

After:

```ts
import { complete, type Message, type Model } from "@earendil-works/pi-ai";
```

### Why

`summary-review.ts` is imported by `index.ts`; leaving this static compat import would still break extension loading after the entrypoint import is fixed.

---

## Change 3 — Update OpenAI auth dynamic pi-ai import

**File:** `${PI_AGENT_DIR}/npm/node_modules/pi-web-access/openai-search.ts`

### What was changed

Changed the dynamic import used while resolving OpenAI auth candidates from the removed compat subpath to the package entrypoint.

Before:

```ts
const { getModel } = await import("@earendil-works/pi-ai/compat");
```

After:

```ts
const { getModel } = await import("@earendil-works/pi-ai");
```

### Why

The dynamic compat import can fail later when OpenAI-backed web search checks model credentials. Updating it prevents a delayed runtime failure after Web UI startup succeeds.

---

## Verification steps

Run from any directory:

```bash
if grep -R -n '@earendil-works/pi-ai/compat' "${HOME}/.pi/agent/npm/node_modules/pi-web-access" --include='*.ts'; then
  echo "Unexpected compat import remains" >&2
  exit 1
else
  echo "No pi-ai compat imports remain"
fi

grep -R -n '@earendil-works/pi-ai' "${HOME}/.pi/agent/npm/node_modules/pi-web-access" --include='*.ts' \
  | grep -E 'index\.ts|summary-review\.ts|openai-search\.ts'

tmp_log="$(mktemp)"
set +e
timeout 25s "${HOME}/npm-packages/pi-package-webui/dev/scripts/start-webui.sh" --dev --port 31416 --cwd "${HOME}/.dotfiles/.config/hypr" >"${tmp_log}" 2>&1
status=$?
set -e
cat "${tmp_log}"
grep -q 'Pi Web UI is ready\.' "${tmp_log}"
test "${status}" -eq 0 -o "${status}" -eq 124
```

Expected:
- The first command prints `No pi-ai compat imports remain`.
- The second command shows `index.ts`, `summary-review.ts`, and `openai-search.ts` importing from `@earendil-works/pi-ai` without `/compat`.
- The Web UI startup log includes `Pi Web UI is ready.`.
- Exit status `124` is acceptable for the startup command because `timeout` intentionally stops the otherwise-running Web UI after readiness is observed.

---

## Operational notes

- Restart Pi / the Web UI after applying this patch so `pi-web-access` is reloaded.
- This patch edits an installed package under `${PI_AGENT_DIR}/npm/node_modules/pi-web-access`; it may be overwritten by `pi update --extensions`, package reinstall, or package upgrade.
- For a durable upstream fix, apply the same import changes in the `pi-web-access` source package and publish/update the installed package.
- Running `node --test` directly inside this installed `node_modules` package is not a valid verification on the current Node setup because Node refuses built-in TypeScript stripping for `.ts` files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Use the import grep and Web UI startup check above for this installed-package patch.
