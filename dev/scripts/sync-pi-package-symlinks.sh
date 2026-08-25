#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="${PI_NPM_PACKAGES_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}"
# Pi auto-discovers global extensions from ~/.pi/agent/extensions and global skills from ~/.pi/agent/skills.
# Keep DOTFILES_* env vars as backwards-compatible aliases for older usage.
EXT_DIR="${PI_EXT_DIR:-${DOTFILES_EXT_DIR:-$HOME/.pi/agent/extensions}}"
SKILL_DIR="${PI_SKILL_DIR:-${DOTFILES_SKILL_DIR:-$HOME/.pi/agent/skills}}"
THEME_DIR="${PI_THEME_DIR:-${DOTFILES_THEME_DIR:-$HOME/.pi/agent/themes}}"
PROMPT_DIR="${PI_PROMPT_DIR:-${DOTFILES_PROMPT_DIR:-$HOME/.pi/agent/prompts}}"
DRY_RUN=0
USE_COLOR=0
SUMMARY_LINES=()
DEP_TOTAL=0
DEP_OK=0
DEP_LINKED=0
DEP_RELINKED=0
DEP_RENAMED=0
DEP_SKIPPED=0
STALE_CHECKED=0
STALE_REMOVED=0
ENSURE_RESULT=""
RESOURCE_CACHE=""

cleanup_resource_cache() {
  if [[ -n "${RESOURCE_CACHE:-}" ]]; then
    rm -f "$RESOURCE_CACHE"
  fi
  return 0
}
trap cleanup_resource_cache EXIT

usage() {
  cat <<'EOF'
Usage:
  sync-pi-package-symlinks.sh [--dry-run] [--color=auto|always|never]

Ensures local pi-coding-agent-forge Pi resources are live-linked for development:

- discovers every top-level pi-* workspace package through Pi's package
  resource resolver, including resources exposed by package.json pi manifests,
  conventional resource directories, bundled dependencies, and vendored paths
- every discovered extension gets a matching development entry under
  ~/.pi/agent/extensions/; index.ts|js resources are linked as directories,
  package standalone files are linked as files, and their direct relative-import
  companion directories are linked beside them so source-relative imports work
- local-only development extensions matching pi-*/dev/*-extension.ts|js use
  generated wrapper files for TUI testing so relative imports resolve from the
  source checkout; they remain excluded from package manifests and npm publication
- every discovered skill gets a matching
  ~/.pi/agent/skills/<skill-name> symlink to that skill directory
- every discovered prompt template gets a matching
  ~/.pi/agent/prompts/<prompt>.md symlink
- every discovered theme gets a matching
  ~/.pi/agent/themes/<theme>.json symlink
- broken symlinks in those target directories, stale symlinks that point
  back into this pi-coding-agent-forge tree, and stale generated dev-extension wrappers
  that no longer match a current resource are removed
- package-local node_modules entries referenced by pi manifests are linked to
  top-level workspace packages before resource discovery, so local development
  packages win over stale installed optional dependencies
- every workspace package gets a matching node_modules symlink by package name
  for local bare-import resolution

If a non-symlink file/directory already exists at the destination, it is renamed to:
  <path>.hardcoded.<timestamp>.bak
then replaced with the canonical symlink.

Options:
  --dry-run                 Show planned actions without changing files
  --color=auto|always|never Colorize action/result labels (default: auto)
  -h, --help                Show this help

Env:
  PI_EXT_DIR          Override target extensions directory
  DOTFILES_EXT_DIR    Backwards-compatible alias for PI_EXT_DIR
  PI_SKILL_DIR        Override target skills directory
  DOTFILES_SKILL_DIR  Backwards-compatible alias for PI_SKILL_DIR
  PI_THEME_DIR         Override target themes directory
  DOTFILES_THEME_DIR   Backwards-compatible alias for PI_THEME_DIR
  PI_PROMPT_DIR        Override target prompts directory
  DOTFILES_PROMPT_DIR  Backwards-compatible alias for PI_PROMPT_DIR
EOF
}

COLOR_MODE="${PI_SYNC_COLOR:-auto}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --color=auto|--color=always|--color=never)
      COLOR_MODE="${1#--color=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option '$1'" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "ERROR: root dir not found: $ROOT_DIR" >&2
  exit 1
fi

case "$COLOR_MODE" in
  always) USE_COLOR=1 ;;
  never) USE_COLOR=0 ;;
  auto) [[ -t 1 && -z "${NO_COLOR:-}" ]] && USE_COLOR=1 || USE_COLOR=0 ;;
  *)
    echo "ERROR: unknown color mode '$COLOR_MODE'" >&2
    usage
    exit 1
    ;;
esac

mkdir -p "$EXT_DIR" "$SKILL_DIR" "$THEME_DIR" "$PROMPT_DIR"

color() {
  local code="$1"
  local text="$2"
  if [[ $USE_COLOR -eq 1 ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$text"
  else
    printf '%s' "$text"
  fi
}

label_ok() { color "32;1" "OK   "; }
label_link() { color "36;1" "LINK "; }
label_fix() { color "33;1" "FIX  "; }
label_move() { color "35;1" "MOVE "; }
label_remove() { color "31;1" "RM   "; }
label_skip() { color "90;1" "SKIP "; }
label_dry_run() { color "34;1" "DRY-RUN:"; }
label_summary() { color "1;4" "Summary:"; }
summary_value() {
  local key="$1"
  local value="$2"
  local code=""
  if [[ "$key" == "ok" ]]; then
    code="32"
  elif [[ "$value" != "0" ]]; then
    case "$key" in
      linked) code="36" ;;
      relinked|renamed|removed) code="33" ;;
      skipped) code="90" ;;
    esac
  fi
  [[ -n "$code" ]] && color "$code" "$value" || printf '%s' "$value"
}

format_summary_line() {
  local label="$1" total="$2" ok="$3" linked="$4" relinked="$5" renamed="$6" skipped="$7"
  printf '%-11s total=%s ok=%s linked=%s relinked=%s renamed=%s skipped=%s' \
    "$label" \
    "$(summary_value total "$total")" \
    "$(summary_value ok "$ok")" \
    "$(summary_value linked "$linked")" \
    "$(summary_value relinked "$relinked")" \
    "$(summary_value renamed "$renamed")" \
    "$(summary_value skipped "$skipped")"
}

format_cleanup_summary_line() {
  local label="$1" checked="$2" removed="$3"
  printf '%-11s checked=%s removed=%s' \
    "$label" \
    "$(summary_value total "$checked")" \
    "$(summary_value removed "$removed")"
}

ts_now() {
  date +"%Y%m%d-%H%M%S"
}

backup_path() {
  local path="$1"
  local stamp="$2"
  local candidate="${path}.hardcoded.${stamp}.bak"
  local i=1
  while [[ -e "$candidate" || -L "$candidate" ]]; do
    candidate="${path}.hardcoded.${stamp}.bak.${i}"
    i=$((i+1))
  done
  printf '%s' "$candidate"
}

realpath_safe() {
  local path="$1"

  # GNU coreutils (Linux, or greadlink/readlink -f when available).
  if command -v realpath >/dev/null 2>&1; then
    realpath "$path" 2>/dev/null && return 0
  fi
  if readlink -f "$path" >/dev/null 2>&1; then
    readlink -f "$path" 2>/dev/null && return 0
  fi

  # Portable macOS fallback. Resolves the containing directory physically and
  # appends the basename. Works for existing files and symlinks to existing files.
  local dir base
  dir="$(dirname "$path")"
  base="$(basename "$path")"
  if [[ -d "$dir" ]]; then
    (cd "$dir" && printf '%s/%s\n' "$(pwd -P)" "$base") 2>/dev/null && return 0
  fi

  return 1
}

run_cmd() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '%s %s\n' "$(label_dry_run)" "$*"
  else
    "$@"
  fi
}

add_summary() {
  SUMMARY_LINES+=("$1")
}

print_summary() {
  echo
  label_summary
  echo
  printf '%s\n' "${SUMMARY_LINES[@]}"
}

ensure_symlink() {
  local source="$1"
  local dest="$2"
  local label="$3"
  ENSURE_RESULT=""

  if [[ -L "$dest" ]]; then
    local dest_real source_real
    dest_real="$(realpath_safe "$dest" || true)"
    source_real="$(realpath_safe "$source" || true)"
    if [[ -n "$dest_real" && -n "$source_real" && "$dest_real" == "$source_real" ]]; then
      printf '%s %s -> %s\n' "$(label_ok)" "$dest" "$source_real"
      ENSURE_RESULT="ok"
      return 0
    fi
    printf '%s %s (wrong %s symlink target)\n' "$(label_fix)" "$dest" "$label"
    run_cmd rm -f "$dest"
    ENSURE_RESULT="relinked"
  elif [[ -e "$dest" ]]; then
    local stamp backup
    stamp="$(ts_now)"
    backup="$(backup_path "$dest" "$stamp")"
    printf '%s %s -> %s\n' "$(label_move)" "$dest" "$backup"
    run_cmd mv "$dest" "$backup"
    ENSURE_RESULT="renamed"
  fi

  printf '%s %s -> %s\n' "$(label_link)" "$dest" "$source"
  run_cmd ln -s "$source" "$dest"
  if [[ -z "$ENSURE_RESULT" ]]; then
    ENSURE_RESULT="linked"
  fi
}

is_dev_extension_path() {
  local extension_path="$1"
  case "$extension_path" in
    "$ROOT_DIR"/pi-*/dev/*-extension.ts|"$ROOT_DIR"/pi-*/dev/*-extension.js) return 0 ;;
    *) return 1 ;;
  esac
}

extension_wrapper_specifier() {
  local source="$1"
  node -e '
    const { pathToFileURL } = require("node:url");
    console.log(JSON.stringify(pathToFileURL(process.argv[1]).href));
  ' "$source"
}

extension_wrapper_content() {
  local source="$1"
  local specifier
  specifier="$(extension_wrapper_specifier "$source")"
  printf '%s\n' \
    "// Generated by sync-pi-package-symlinks.sh: managed extension wrapper." \
    "// Source: $source" \
    "export { default } from $specifier;"
}

is_managed_extension_wrapper() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || return 1
  grep -Fq "Generated by sync-pi-package-symlinks.sh: managed extension wrapper." "$path"
}

write_extension_wrapper() {
  local dest="$1"
  local content="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '%s write managed extension wrapper %s\n' "$(label_dry_run)" "$dest"
  else
    printf '%s\n' "$content" > "$dest"
  fi
}

ensure_extension_wrapper() {
  local source="$1"
  local dest="$2"
  ENSURE_RESULT=""

  local expected_content
  expected_content="$(extension_wrapper_content "$source")"
  if [[ -f "$dest" && ! -L "$dest" ]] && printf '%s\n' "$expected_content" | cmp -s - "$dest"; then
    printf '%s %s -> wrapper for %s\n' "$(label_ok)" "$dest" "$source"
    ENSURE_RESULT="ok"
    return 0
  fi

  if [[ -L "$dest" ]]; then
    printf '%s %s (replace extension symlink with managed wrapper)\n' "$(label_fix)" "$dest"
    run_cmd rm -f "$dest"
    ENSURE_RESULT="relinked"
  elif [[ -e "$dest" ]]; then
    if is_managed_extension_wrapper "$dest"; then
      printf '%s %s (refresh managed extension wrapper)\n' "$(label_fix)" "$dest"
      ENSURE_RESULT="relinked"
    else
      local stamp backup
      stamp="$(ts_now)"
      backup="$(backup_path "$dest" "$stamp")"
      printf '%s %s -> %s\n' "$(label_move)" "$dest" "$backup"
      run_cmd mv "$dest" "$backup"
      ENSURE_RESULT="renamed"
    fi
  fi

  printf '%s %s -> wrapper for %s\n' "$(label_link)" "$dest" "$source"
  write_extension_wrapper "$dest" "$expected_content"
  if [[ -z "$ENSURE_RESULT" ]]; then
    ENSURE_RESULT="linked"
  fi
}

expected_name_in_list() {
  local needle="$1"
  local haystack="$2"
  local item

  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    [[ "$item" == "$needle" ]] && return 0
  done <<< "$haystack"

  return 1
}

link_target_is_repo_managed() {
  local target="$1"
  [[ -n "$target" ]] || return 1
  [[ "$target" == "$ROOT_DIR" || "$target" == "$ROOT_DIR/"* ]]
}

cleanup_stale_symlinks() {
  local dir="$1"
  local expected_names="$2"
  local label="$3"

  [[ -d "$dir" ]] || return 0

  shopt -s nullglob
  for link in "$dir"/*; do
    [[ -L "$link" ]] || continue
    STALE_CHECKED=$((STALE_CHECKED+1))

    local name target reason
    name="$(basename "$link")"
    if expected_name_in_list "$name" "$expected_names"; then
      continue
    fi

    target="$(readlink "$link" 2>/dev/null || true)"
    local is_broken=0 is_repo_managed=0
    [[ ! -e "$link" ]] && is_broken=1
    link_target_is_repo_managed "$target" && is_repo_managed=1

    if [[ $is_broken -ne 1 && $is_repo_managed -ne 1 ]]; then
      continue
    fi

    reason="stale"
    if [[ $is_broken -eq 1 && $is_repo_managed -eq 1 ]]; then
      reason="broken/stale"
    elif [[ $is_broken -eq 1 ]]; then
      reason="broken"
    fi

    printf '%s %s (%s %s symlink target: %s)\n' "$(label_remove)" "$link" "$reason" "$label" "$target"
    run_cmd rm -f "$link"
    STALE_REMOVED=$((STALE_REMOVED+1))
  done
  shopt -u nullglob
}

cleanup_stale_extension_wrappers() {
  local dir="$1"
  local expected_names="$2"

  [[ -d "$dir" ]] || return 0

  shopt -s nullglob
  for file in "$dir"/*.ts "$dir"/*.js; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    is_managed_extension_wrapper "$file" || continue
    STALE_CHECKED=$((STALE_CHECKED+1))

    local name
    name="$(basename "$file")"
    if expected_name_in_list "$name" "$expected_names"; then
      continue
    fi

    printf '%s %s (stale generated extension wrapper)\n' "$(label_remove)" "$file"
    run_cmd rm -f "$file"
    STALE_REMOVED=$((STALE_REMOVED+1))
  done
  shopt -u nullglob
}

get_pi_package_dir() {
  local pi_bin pi_cli candidate parent
  pi_bin="$(command -v pi 2>/dev/null || true)"
  [[ -n "$pi_bin" ]] || return 1
  pi_cli="$(realpath_safe "$pi_bin")"
  [[ -n "$pi_cli" ]] || return 1

  candidate="$(dirname "$pi_cli")"
  while [[ "$candidate" != "/" ]]; do
    if [[ -f "$candidate/package.json" && -f "$candidate/dist/index.js" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    parent="$(dirname "$candidate")"
    [[ "$parent" != "$candidate" ]] || break
    candidate="$parent"
  done

  return 1
}

resolve_from_pi() {
  local name="$1"
  local pi_pkg_dir
  pi_pkg_dir="$(get_pi_package_dir)"
  [[ -n "$pi_pkg_dir" && -f "$pi_pkg_dir/package.json" ]] || return 0

  node -e '
    const { createRequire } = require("node:module");
    const fs = require("node:fs");
    const path = require("node:path");
    const req = createRequire(path.join(process.argv[1], "package.json"));
    let resolved;
    try {
      resolved = req.resolve(process.argv[2] + "/package.json");
    } catch {
      try {
        resolved = req.resolve(process.argv[2]);
      } catch {
        const nodeModulesRoot = path.basename(path.dirname(process.argv[1])).startsWith("@")
          ? path.dirname(path.dirname(process.argv[1]))
          : path.dirname(process.argv[1]);
        const candidate = path.join(nodeModulesRoot, process.argv[2]);
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          console.log(candidate);
          process.exit(0);
        }
        throw new Error(`Cannot resolve ${process.argv[2]}`);
      }
    }
    let dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        console.log(dir);
        process.exit(0);
      }
      dir = path.dirname(dir);
    }
  ' "$pi_pkg_dir" "$name" 2>/dev/null || true
}

discover_pi_resources() {
  local pi_pkg_dir agent_dir
  pi_pkg_dir="$(get_pi_package_dir)"
  [[ -n "$pi_pkg_dir" && -f "$pi_pkg_dir/package.json" ]] || {
    echo "ERROR: could not resolve installed pi package directory." >&2
    return 1
  }
  agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

  node --input-type=module - "$ROOT_DIR" "$agent_dir" "$pi_pkg_dir" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [rootDir, agentDir, piPackageDir] = process.argv.slice(2);
const piIndex = path.join(piPackageDir, "dist", "index.js");
const { DefaultPackageManager, SettingsManager } = await import(pathToFileURL(piIndex).href);

const sources = fs.readdirSync(rootDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("pi-"))
  .map((entry) => path.join(rootDir, entry.name))
  .filter((dir) => {
    const packageJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    // pi-utils intentionally stays a shared dependency symlink only; it is not
    // a loadable development extension despite being a Pi-aware package.
    return pkg.name !== "@firstpick/pi-utils";
  })
  .sort();

const settingsManager = SettingsManager.create(rootDir, agentDir);
const packageManager = new DefaultPackageManager({ cwd: rootDir, agentDir, settingsManager });
const resolved = await packageManager.resolveExtensionSources(sources, { temporary: true });

for (const type of ["extensions", "skills", "prompts", "themes"]) {
  for (const resource of resolved[type] ?? []) {
    if (!resource.enabled) continue;
    process.stdout.write(`${type}\t${resource.path}\0`);
  }
}
NODE
}

ensure_resource_cache() {
  if [[ -n "$RESOURCE_CACHE" && -f "$RESOURCE_CACHE" ]]; then
    return 0
  fi
  RESOURCE_CACHE="$(mktemp)"
  discover_pi_resources > "$RESOURCE_CACHE"
}

dev_extension_paths() {
  local extension_file
  shopt -s nullglob
  for extension_file in "$ROOT_DIR"/pi-*/dev/*-extension.ts "$ROOT_DIR"/pi-*/dev/*-extension.js; do
    [[ -f "$extension_file" ]] || continue
    printf '%s\0' "$extension_file"
  done
  shopt -u nullglob
}

resource_paths() {
  local wanted_type="$1"
  local resource_type resource_path
  ensure_resource_cache
  while IFS=$'\t' read -r -d '' resource_type resource_path; do
    [[ "$resource_type" == "$wanted_type" ]] || continue
    printf '%s\0' "$resource_path"
  done < "$RESOURCE_CACHE"

  if [[ "$wanted_type" == "extensions" ]]; then
    dev_extension_paths
  fi
}

extension_link_name() {
  local extension_path="$1"
  local file_name parent_name
  file_name="$(basename "$extension_path")"
  if [[ "$file_name" == "index.ts" || "$file_name" == "index.js" ]]; then
    parent_name="$(basename "$(dirname "$extension_path")")"
    resource_name_from_dir "$parent_name"
  else
    printf '%s' "$file_name"
  fi
}

extension_link_source() {
  local extension_path="$1"
  local file_name
  file_name="$(basename "$extension_path")"
  if [[ "$file_name" == "index.ts" || "$file_name" == "index.js" ]]; then
    dirname "$extension_path"
  else
    printf '%s' "$extension_path"
  fi
}

extension_companion_dirs() {
  local extension_path="$1"
  node - "$extension_path" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const extensionPath = process.argv[2];
const source = fs.readFileSync(extensionPath, "utf8");
const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.\/[^"']+)["']/g;
const companions = new Set();
let match;
while ((match = importPattern.exec(source)) !== null) {
  const firstSegment = match[1].slice(2).split(/[\\/]/, 1)[0];
  if (!firstSegment) continue;
  const candidate = path.join(path.dirname(extensionPath), firstSegment);
  try {
    if (fs.statSync(candidate).isDirectory()) companions.add(candidate);
  } catch {
    // Missing imports are reported by Pi when it loads the extension.
  }
}
for (const companion of [...companions].sort()) process.stdout.write(`${companion}\0`);
NODE
}

ensure_node_module_symlink() {
  local module_name="$1"
  local source_dir="$2"
  local base_dir="$3"
  local dest_dir dest

  if [[ "$module_name" == @*/* ]]; then
    dest_dir="$base_dir/node_modules/${module_name%/*}"
    dest="$dest_dir/${module_name#*/}"
  else
    dest_dir="$base_dir/node_modules"
    dest="$dest_dir/$module_name"
  fi

  run_cmd mkdir -p "$dest_dir"
  DEP_TOTAL=$((DEP_TOTAL+1))
  ensure_symlink "$source_dir" "$dest" "dependency"
  case "$ENSURE_RESULT" in
    ok) DEP_OK=$((DEP_OK+1)) ;;
    linked) DEP_LINKED=$((DEP_LINKED+1)) ;;
    relinked) DEP_RELINKED=$((DEP_RELINKED+1)) ;;
    renamed) DEP_RENAMED=$((DEP_RENAMED+1)) ;;
    *) DEP_SKIPPED=$((DEP_SKIPPED+1)) ;;
  esac
}

package_json_name() {
  local pkg_dir="$1"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const pkg = JSON.parse(fs.readFileSync(path.join(process.argv[1], "package.json"), "utf8"));
    if (typeof pkg.name === "string" && pkg.name.length > 0) console.log(pkg.name);
  ' "$pkg_dir"
}

workspace_package_dir_for_name() {
  local wanted_name="$1"
  local pkg_dir workspace_name
  for pkg_dir in "$ROOT_DIR"/pi-*; do
    [[ -d "$pkg_dir" && -f "$pkg_dir/package.json" ]] || continue
    workspace_name="$(package_json_name "$pkg_dir")"
    [[ "$workspace_name" == "$wanted_name" ]] || continue
    printf '%s' "$pkg_dir"
    return 0
  done
  return 1
}

pi_manifest_node_module_packages() {
  local pkg_dir="$1"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const pkg = JSON.parse(fs.readFileSync(path.join(process.argv[1], "package.json"), "utf8"));
    const seen = new Set();
    for (const type of ["extensions", "skills", "prompts", "themes"]) {
      const entries = Array.isArray(pkg.pi?.[type]) ? pkg.pi[type] : [];
      for (const entry of entries) {
        if (typeof entry !== "string") continue;
        const normalized = entry.replace(/\\/g, "/");
        if (!normalized.startsWith("node_modules/")) continue;
        const parts = normalized.slice("node_modules/".length).split("/").filter(Boolean);
        const moduleName = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] || ""}` : parts[0];
        if (moduleName) seen.add(moduleName);
      }
    }
    for (const moduleName of [...seen].sort()) console.log(moduleName);
  ' "$pkg_dir"
}

ensure_workspace_manifest_deps() {
  local pkg_dir module_name source_dir
  for pkg_dir in "$ROOT_DIR"/pi-*; do
    [[ -d "$pkg_dir" && -f "$pkg_dir/package.json" ]] || continue
    while IFS= read -r module_name; do
      [[ -n "$module_name" ]] || continue
      source_dir="$(workspace_package_dir_for_name "$module_name" || true)"
      if [[ -z "$source_dir" || ! -d "$source_dir" ]]; then
        printf '%s %s manifest node_modules reference has no workspace package: %s\n' "$(label_skip)" "$pkg_dir" "$module_name"
        DEP_TOTAL=$((DEP_TOTAL+1))
        DEP_SKIPPED=$((DEP_SKIPPED+1))
        continue
      fi
      ensure_node_module_symlink "$module_name" "$source_dir" "$pkg_dir"
    done < <(pi_manifest_node_module_packages "$pkg_dir")
  done
}

resource_name_from_dir() {
  local pkg_name="$1"
  case "$pkg_name" in
    pi-extension-*) printf '%s' "${pkg_name#pi-extension-}" ;;
    pi-package-*) printf '%s' "${pkg_name#pi-package-}" ;;
    pi-skill-*) printf '%s' "${pkg_name#pi-skill-}" ;;
    pi-*) printf '%s' "${pkg_name#pi-}" ;;
    *) printf '%s' "$pkg_name" ;;
  esac
}

ensure_shared_deps() {
  # Pi/jiti resolves bare imports relative to ~/.pi/agent/extensions/*.ts.
  # If it follows symlinks to the repo, Node may resolve relative to ROOT_DIR too.
  local base_dirs=("$EXT_DIR" "$ROOT_DIR")
  for base_dir in "${base_dirs[@]}"; do
    for pkg_dir in "$ROOT_DIR"/pi-*; do
      [[ -d "$pkg_dir" && -f "$pkg_dir/package.json" ]] || continue

      local workspace_name
      workspace_name="$(package_json_name "$pkg_dir")"
      [[ -n "$workspace_name" ]] || continue
      ensure_node_module_symlink "$workspace_name" "$pkg_dir" "$base_dir"
    done

    for module_name in typebox @earendil-works/pi-coding-agent @earendil-works/pi-tui @earendil-works/pi-ai; do
      local module_dir
      module_dir="$(resolve_from_pi "$module_name")"
      if [[ -n "$module_dir" && -d "$module_dir" ]]; then
        ensure_node_module_symlink "$module_name" "$module_dir" "$base_dir"
      fi
    done
  done
}

sync_extension_symlinks() {
  local count_total=0 count_ok=0 count_linked=0 count_relinked=0 count_renamed=0 count_skipped=0
  local companion_total=0 companion_ok=0 companion_linked=0 companion_relinked=0 companion_renamed=0 companion_skipped=0
  local expected_names=""

  while IFS= read -r -d '' extension_file; do
    [[ -f "$extension_file" ]] || continue
    count_total=$((count_total+1))

    local link_name link_source dest source_real
    link_name="$(extension_link_name "$extension_file")"
    link_source="$(extension_link_source "$extension_file")"
    if expected_name_in_list "$link_name" "$expected_names"; then
      printf '%s duplicate extension link name %s from %s\n' "$(label_skip)" "$link_name" "$extension_file"
      count_skipped=$((count_skipped+1))
      continue
    fi
    expected_names+="$link_name"$'\n'
    dest="$EXT_DIR/$link_name"

    source_real="$(realpath_safe "$link_source" || true)"
    if [[ -z "$source_real" ]]; then
      printf '%s extension %s -> cannot resolve source realpath\n' "$(label_skip)" "$link_source"
      count_skipped=$((count_skipped+1))
      continue
    fi

    if is_dev_extension_path "$extension_file"; then
      ensure_extension_wrapper "$extension_file" "$dest"
    else
      ensure_symlink "$link_source" "$dest" "extension"
    fi
    case "$ENSURE_RESULT" in
      ok) count_ok=$((count_ok+1)) ;;
      linked) count_linked=$((count_linked+1)) ;;
      relinked) count_relinked=$((count_relinked+1)) ;;
      renamed) count_renamed=$((count_renamed+1)) ;;
      *) count_skipped=$((count_skipped+1)) ;;
    esac

    if [[ -f "$link_source" ]] && ! is_dev_extension_path "$extension_file"; then
      local companion_source companion_name companion_dest companion_source_real companion_dest_real
      while IFS= read -r -d '' companion_source; do
        companion_total=$((companion_total+1))
        companion_name="$(basename "$companion_source")"
        companion_dest="$EXT_DIR/$companion_name"
        companion_source_real="$(realpath_safe "$companion_source" || true)"

        if expected_name_in_list "$companion_name" "$expected_names"; then
          companion_dest_real="$(realpath_safe "$companion_dest" || true)"
          if [[ -n "$companion_source_real" && "$companion_dest_real" == "$companion_source_real" ]]; then
            companion_ok=$((companion_ok+1))
          else
            printf '%s extension companion name conflict %s from %s\n' "$(label_skip)" "$companion_name" "$extension_file"
            companion_skipped=$((companion_skipped+1))
          fi
          continue
        fi

        expected_names+="$companion_name"$'\n'
        ensure_symlink "$companion_source" "$companion_dest" "extension companion"
        case "$ENSURE_RESULT" in
          ok) companion_ok=$((companion_ok+1)) ;;
          linked) companion_linked=$((companion_linked+1)) ;;
          relinked) companion_relinked=$((companion_relinked+1)) ;;
          renamed) companion_renamed=$((companion_renamed+1)) ;;
          *) companion_skipped=$((companion_skipped+1)) ;;
        esac
      done < <(extension_companion_dirs "$extension_file")
    fi
  done < <(resource_paths "extensions")

  cleanup_stale_symlinks "$EXT_DIR" "$expected_names" "extension"
  cleanup_stale_extension_wrappers "$EXT_DIR" "$expected_names"

  add_summary "$(format_summary_line "Extensions:" "$count_total" "$count_ok" "$count_linked" "$count_relinked" "$count_renamed" "$count_skipped")"
  if [[ "$companion_total" -gt 0 ]]; then
    add_summary "$(format_summary_line "Ext deps:" "$companion_total" "$companion_ok" "$companion_linked" "$companion_relinked" "$companion_renamed" "$companion_skipped")"
  fi
}

sync_skill_symlinks() {
  local count_total=0 count_ok=0 count_linked=0 count_relinked=0 count_renamed=0 count_skipped=0
  local expected_names=""

  while IFS= read -r -d '' skill_file; do
    [[ -f "$skill_file" ]] || continue
    count_total=$((count_total+1))

    local skill_source skill_name dest source_real
    skill_source="$(dirname "$skill_file")"
    skill_name="$(basename "$skill_source")"
    if expected_name_in_list "$skill_name" "$expected_names"; then
      printf '%s duplicate skill link name %s from %s\n' "$(label_skip)" "$skill_name" "$skill_source"
      count_skipped=$((count_skipped+1))
      continue
    fi
    expected_names+="$skill_name"$'\n'
    dest="$SKILL_DIR/$skill_name"

    source_real="$(realpath_safe "$skill_source" || true)"
    if [[ -z "$source_real" ]]; then
      printf '%s skill %s -> cannot resolve source realpath: %s\n' "$(label_skip)" "$skill_name" "$skill_source"
      count_skipped=$((count_skipped+1))
      continue
    fi

    ensure_symlink "$skill_source" "$dest" "skill"
    case "$ENSURE_RESULT" in
      ok) count_ok=$((count_ok+1)) ;;
      linked) count_linked=$((count_linked+1)) ;;
      relinked) count_relinked=$((count_relinked+1)) ;;
      renamed) count_renamed=$((count_renamed+1)) ;;
      *) count_skipped=$((count_skipped+1)) ;;
    esac
  done < <(resource_paths "skills")

  cleanup_stale_symlinks "$SKILL_DIR" "$expected_names" "skill"

  add_summary "$(format_summary_line "Skills:" "$count_total" "$count_ok" "$count_linked" "$count_relinked" "$count_renamed" "$count_skipped")"
}

sync_prompt_symlinks() {
  local count_total=0 count_ok=0 count_linked=0 count_relinked=0 count_renamed=0 count_skipped=0
  local expected_names=""

  while IFS= read -r -d '' prompt_file; do
    [[ -f "$prompt_file" ]] || continue
    count_total=$((count_total+1))

    local prompt_name dest source_real
    prompt_name="$(basename "$prompt_file")"
    if expected_name_in_list "$prompt_name" "$expected_names"; then
      printf '%s duplicate prompt link name %s from %s\n' "$(label_skip)" "$prompt_name" "$prompt_file"
      count_skipped=$((count_skipped+1))
      continue
    fi
    expected_names+="$prompt_name"$'\n'
    dest="$PROMPT_DIR/$prompt_name"

    source_real="$(realpath_safe "$prompt_file" || true)"
    if [[ -z "$source_real" ]]; then
      printf '%s prompt %s -> cannot resolve source realpath: %s\n' "$(label_skip)" "$prompt_name" "$prompt_file"
      count_skipped=$((count_skipped+1))
      continue
    fi

    ensure_symlink "$prompt_file" "$dest" "prompt"
    case "$ENSURE_RESULT" in
      ok) count_ok=$((count_ok+1)) ;;
      linked) count_linked=$((count_linked+1)) ;;
      relinked) count_relinked=$((count_relinked+1)) ;;
      renamed) count_renamed=$((count_renamed+1)) ;;
      *) count_skipped=$((count_skipped+1)) ;;
    esac
  done < <(resource_paths "prompts")

  cleanup_stale_symlinks "$PROMPT_DIR" "$expected_names" "prompt"

  add_summary "$(format_summary_line "Prompts:" "$count_total" "$count_ok" "$count_linked" "$count_relinked" "$count_renamed" "$count_skipped")"
}

sync_theme_symlinks() {
  local count_total=0 count_ok=0 count_linked=0 count_relinked=0 count_renamed=0 count_skipped=0
  local expected_names=""

  while IFS= read -r -d '' theme_file; do
    [[ -f "$theme_file" ]] || continue
    count_total=$((count_total+1))

    local theme_name dest source_real
    theme_name="$(basename "$theme_file")"
    if expected_name_in_list "$theme_name" "$expected_names"; then
      printf '%s duplicate theme link name %s from %s\n' "$(label_skip)" "$theme_name" "$theme_file"
      count_skipped=$((count_skipped+1))
      continue
    fi
    expected_names+="$theme_name"$'\n'
    dest="$THEME_DIR/$theme_name"

    source_real="$(realpath_safe "$theme_file" || true)"
    if [[ -z "$source_real" ]]; then
      printf '%s theme %s -> cannot resolve source realpath: %s\n' "$(label_skip)" "$theme_name" "$theme_file"
      count_skipped=$((count_skipped+1))
      continue
    fi

    ensure_symlink "$theme_file" "$dest" "theme"
    case "$ENSURE_RESULT" in
      ok) count_ok=$((count_ok+1)) ;;
      linked) count_linked=$((count_linked+1)) ;;
      relinked) count_relinked=$((count_relinked+1)) ;;
      renamed) count_renamed=$((count_renamed+1)) ;;
      *) count_skipped=$((count_skipped+1)) ;;
    esac
  done < <(resource_paths "themes")

  cleanup_stale_symlinks "$THEME_DIR" "$expected_names" "theme"

  add_summary "$(format_summary_line "Themes:" "$count_total" "$count_ok" "$count_linked" "$count_relinked" "$count_renamed" "$count_skipped")"
}

ensure_workspace_manifest_deps
ensure_resource_cache
sync_extension_symlinks
sync_skill_symlinks
sync_prompt_symlinks
sync_theme_symlinks
ensure_shared_deps
add_summary "$(format_summary_line "Node deps:" "$DEP_TOTAL" "$DEP_OK" "$DEP_LINKED" "$DEP_RELINKED" "$DEP_RENAMED" "$DEP_SKIPPED")"
add_summary "$(format_cleanup_summary_line "Cleanup:" "$STALE_CHECKED" "$STALE_REMOVED")"
print_summary
