#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

PACKAGE_NAME="@firstpick/pi-package-webui"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="31415"
SERVER_PID=""
PI_WEBUI_COMMAND=""

script_dir() {
  local source dir
  source="${BASH_SOURCE[0]}"

  while [[ -L "$source" ]]; do
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done

  cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd
}

package_root() {
  cd -P "$(script_dir)/../.." >/dev/null 2>&1 && pwd
}

local_pi_webui_bin() {
  local candidate
  candidate="$(package_root)/bin/pi-webui.mjs"

  if [[ ! -f "$candidate" ]]; then
    echo "--dev expected the local Pi Web UI server at: $candidate" >&2
    return 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to run the local Pi Web UI server in --dev mode." >&2
    return 1
  fi

  printf '%s\n' "$candidate"
}

dev_update_pi_runtime_package() {
  local root package_name current latest
  root="$1"
  package_name="@earendil-works/pi-coding-agent"

  latest="$(cd "$root" && npm view "$package_name" version --silent 2>/dev/null || true)"
  latest="${latest//$'\r'/}"
  latest="${latest//$'\n'/}"

  if [[ -z "$latest" ]]; then
    echo "Dev mode: could not check latest $package_name version; continuing with installed local package." >&2
    return 0
  fi

  current="$(node -e '
const fs = require("fs");
const path = require("path");
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.argv[1], "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8"));
  if (!pkg.version) process.exit(1);
  process.stdout.write(pkg.version);
} catch {
  process.exit(1);
}
' "$root" 2>/dev/null || true)"

  if [[ "$current" == "$latest" ]]; then
    echo "Dev mode: $package_name is current ($current)."
    return 0
  fi

  if [[ -n "$current" ]]; then
    echo "Dev mode: updating $package_name from $current to latest ($latest)..."
  else
    echo "Dev mode: installing latest $package_name ($latest)..."
  fi

  if ! (cd "$root" && npm install "$package_name@latest"); then
    echo "Dev mode: failed to update $package_name; refusing to start with a stale local Pi runtime." >&2
    echo "Set PI_WEBUI_DEV_SKIP_UPDATE=1 to skip this preflight if you need to start anyway." >&2
    return 1
  fi

  echo "Dev mode: $package_name is now at latest ($latest)."
}

dev_update_local_packages() {
  local root tmp_dir outdated_json outdated_err status has_updates
  root="$(package_root)"

  case "${PI_WEBUI_DEV_SKIP_UPDATE:-}" in
    1|true|TRUE|yes|YES|on|ON)
      echo "Dev mode: skipping local npm package update because PI_WEBUI_DEV_SKIP_UPDATE is set."
      return 0
      ;;
  esac

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to check and update local packages in --dev mode." >&2
    return 1
  fi

  if [[ ! -f "$root/package.json" ]]; then
    echo "--dev expected package.json at: $root/package.json" >&2
    return 1
  fi

  echo "Dev mode: checking local npm packages in: $root"

  if [[ ! -d "$root/node_modules" ]]; then
    echo "Dev mode: node_modules is missing; running npm install..."
    (cd "$root" && npm install)
    return $?
  fi

  tmp_dir="$(mktemp -d)"
  outdated_json="$tmp_dir/outdated.json"
  outdated_err="$tmp_dir/outdated.err"
  has_updates=0

  if (cd "$root" && npm outdated --json >"$outdated_json" 2>"$outdated_err"); then
    status=0
  else
    status=$?
  fi

  if node -e '
const fs = require("fs");
let data;
try {
  const text = fs.readFileSync(process.argv[1], "utf8").trim();
  data = text ? JSON.parse(text) : {};
} catch {
  process.exit(1);
}
process.exit(data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0 ? 0 : 1);
' "$outdated_json"; then
    has_updates=1
  fi

  if [[ "$has_updates" -eq 1 ]]; then
    echo "Dev mode: local npm package updates are available; running npm update..."
    if ! (cd "$root" && npm update); then
      rm -rf "$tmp_dir"
      echo "Dev mode: npm update failed; refusing to start with a partially updated local package tree." >&2
      echo "Set PI_WEBUI_DEV_SKIP_UPDATE=1 to skip this preflight if you need to start anyway." >&2
      return 1
    fi

    echo "Dev mode: local npm packages updated within configured version ranges."
  elif [[ "$status" -ne 0 ]]; then
    echo "Dev mode: npm outdated could not check for updates; continuing with existing local packages." >&2
    if [[ -s "$outdated_err" ]]; then
      sed 's/^/npm outdated: /' "$outdated_err" >&2 || true
    fi
  else
    echo "Dev mode: local npm packages are up to date within configured version ranges."
  fi

  rm -rf "$tmp_dir"
  dev_update_pi_runtime_package "$root"
}

pi_managed_pi_webui_bin() {
  local candidates candidate

  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  candidates="$(node <<'NODE'
const { homedir } = require("node:os");
const { join } = require("node:path");

let agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
if (agentDir === "~") {
  agentDir = homedir();
} else if (agentDir.startsWith("~/") || (process.platform === "win32" && agentDir.startsWith("~\\"))) {
  agentDir = join(homedir(), agentDir.slice(2));
}

const binName = process.platform === "win32" ? "pi-webui.cmd" : "pi-webui";
for (const candidate of [
  join(agentDir, "npm", "node_modules", ".bin", "pi-webui"),
  join(agentDir, "npm", "node_modules", ".bin", binName),
]) {
  process.stdout.write(`${candidate.replace(/\\/g, "/")}\n`);
}
NODE
)"

  while IFS= read -r candidate; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done <<< "$candidates"

  return 1
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}

choose_cwd() {
  local cwd="${PI_WEBUI_CWD:-${PWD:-}}"

  if [[ -z "$cwd" || ! -d "$cwd" ]]; then
    cwd="${HOME:-}"
  fi

  if [[ -z "$cwd" || ! -d "$cwd" ]]; then
    cwd="$(pwd -P)"
  fi

  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then
        cwd="$(cygpath -m "$cwd")"
      fi
      ;;
  esac

  printf '%s\n' "$cwd"
}

ensure_pi_webui() {
  local managed_bin

  if managed_bin="$(pi_managed_pi_webui_bin 2>/dev/null)" && [[ -n "$managed_bin" ]]; then
    PI_WEBUI_COMMAND="$managed_bin"
    return 0
  fi

  if command -v pi-webui >/dev/null 2>&1; then
    PI_WEBUI_COMMAND="$(command -v pi-webui)"
    return 0
  fi

  echo "pi-webui is not installed or not available on PATH."

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install it globally. Install Node.js/npm, then run:" >&2
    echo "  npm install -g $PACKAGE_NAME" >&2
    return 1
  fi

  if [[ ! -t 0 ]]; then
    echo "Non-interactive shell; refusing to install without confirmation." >&2
    echo "Run manually:" >&2
    echo "  npm install -g $PACKAGE_NAME" >&2
    return 1
  fi

  local answer=""
  if ! read -r -p "Install $PACKAGE_NAME globally now? [y/N] " answer; then
    answer=""
  fi

  case "$answer" in
    y|Y|yes|YES|Yes)
      npm install -g "$PACKAGE_NAME"
      ;;
    *)
      echo "Aborted. Install later with:" >&2
      echo "  npm install -g $PACKAGE_NAME" >&2
      return 1
      ;;
  esac

  if ! command -v pi-webui >/dev/null 2>&1; then
    echo "Installed, but pi-webui is still not on PATH. Check your npm global bin directory." >&2
    return 1
  fi

  PI_WEBUI_COMMAND="$(command -v pi-webui)"
}

browser_host_for_url() {
  local host="$1"

  case "$host" in
    ""|"0.0.0.0") printf '%s\n' "127.0.0.1" ;;
    "::") printf '%s\n' "[::1]" ;;
    \[*\]) printf '%s\n' "$host" ;;
    *:*) printf '[%s]\n' "$host" ;;
    *) printf '%s\n' "$host" ;;
  esac
}

connect_host_for_port() {
  local host="$1"

  case "$host" in
    ""|"0.0.0.0") printf '%s\n' "127.0.0.1" ;;
    "::") printf '%s\n' "::1" ;;
    \[*\])
      host="${host#\[}"
      host="${host%\]}"
      printf '%s\n' "$host"
      ;;
    *) printf '%s\n' "$host" ;;
  esac
}

print_manual_url() {
  local url="$1"

  echo "Open manually: $url"
}

http_ok() {
  local url="$1"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=2 --tries=1 --spider "$url" >/dev/null 2>&1
  elif command -v node >/dev/null 2>&1; then
    node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1));' "$url" >/dev/null 2>&1
  else
    return 1
  fi
}

webui_is_running() {
  local base_url="${1%/}"

  http_ok "$base_url/api/webui-status" || http_ok "$base_url/api/webui-status?detailed=1"
}

http_get() {
  local url="$1"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=5 --tries=1 -O - "$url"
  elif command -v node >/dev/null 2>&1; then
    node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then(async (r) => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); }, () => process.exit(1));' "$url"
  else
    return 1
  fi
}

http_post_json() {
  local url="$1"
  local body="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 10 -X POST "$url" -H "Content-Type: application/json" --data "$body"
  elif command -v node >/dev/null 2>&1; then
    node -e 'fetch(process.argv[1], { method: "POST", headers: { "Content-Type": "application/json" }, body: process.argv[2], signal: AbortSignal.timeout(10000) }).then(async (r) => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); }, () => process.exit(1));' "$url" "$body"
  else
    return 1
  fi
}

json_quote() {
  local value="$1"

  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$value"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$value"
  else
    return 1
  fi
}

extract_tab_id_for_cwd() {
  local cwd="$1"

  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const target = normalize(process.argv[1]);
const tabs = data?.data?.tabs || [];
const tab = tabs.find((item) => normalize(item?.cwd) === target);
if (tab?.id) process.stdout.write(String(tab.id));
function normalize(value) {
  let text = String(value || "").replace(/\\/g, "/");
  if (/^\/[a-zA-Z]\//.test(text)) text = `${text[1]}:${text.slice(2)}`;
  return process.platform === "win32" ? text.toLowerCase() : text;
}
' "$cwd"
  else
    return 1
  fi
}

extract_created_tab_id() {
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const id = data?.data?.tab?.id;
if (id) process.stdout.write(String(id));
'
  else
    return 1
  fi
}

webui_url_for_cwd() {
  local base_url cwd tabs_json tab_id json_cwd body created_json
  base_url="${1%/}"
  cwd="$2"

  if tabs_json="$(http_get "$base_url/api/tabs" 2>/dev/null)"; then
    tab_id="$(printf '%s' "$tabs_json" | extract_tab_id_for_cwd "$cwd" 2>/dev/null || true)"
    if [[ -n "$tab_id" ]]; then
      printf '%s/?tab=%s\n' "$base_url" "$tab_id"
      return 0
    fi
  fi

  if json_cwd="$(json_quote "$cwd" 2>/dev/null)"; then
    body="{\"cwd\":$json_cwd}"
    if created_json="$(http_post_json "$base_url/api/tabs" "$body" 2>/dev/null)"; then
      tab_id="$(printf '%s' "$created_json" | extract_created_tab_id 2>/dev/null || true)"
      if [[ -n "$tab_id" ]]; then
        printf '%s/?tab=%s\n' "$base_url" "$tab_id"
        return 0
      fi
    fi
  fi

  printf '%s/\n' "$base_url"
}

port_is_in_use() {
  local host port
  host="$(connect_host_for_port "$1")"
  port="$2"

  if command -v nc >/dev/null 2>&1 && nc -z "$host" "$port" >/dev/null 2>&1; then
    return 0
  fi

  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi

  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk -v port="$port" 'NR > 1 { split($4, parts, ":"); if (parts[length(parts)] == port) found = 1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi

  if [[ "$host" != *:* ]] && (echo >"/dev/tcp/$host/$port") >/dev/null 2>&1; then
    return 0
  fi

  if command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep -E "[.:]${port}[[:space:]]" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

wait_until_ready() {
  local url="$1"
  local pid="$2"

  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 2
    fi

    http_ok "$url" && return 0
    sleep 0.2
  done

  return 1
}

main() {
  local cwd host port browser_host connect_host url target_url i ready_status dev_mode local_webui_bin
  local args=("$@")
  local pass_args=()
  local webui_cmd=()
  cwd="$(choose_cwd)"
  host="${PI_WEBUI_HOST:-$DEFAULT_HOST}"
  port="${PI_WEBUI_PORT:-$DEFAULT_PORT}"
  dev_mode=0

  for ((i = 0; i < ${#args[@]}; i++)); do
    case "${args[$i]}" in
      --)
        pass_args+=("${args[@]:$i}")
        break
        ;;
      --dev)
        dev_mode=1
        ;;
      --cwd)
        if ((i + 1 < ${#args[@]})); then
          cwd="${args[$((i + 1))]}"
          pass_args+=("${args[$i]}" "${args[$((i + 1))]}")
          ((i += 1))
        else
          pass_args+=("${args[$i]}")
        fi
        ;;
      --host)
        if ((i + 1 < ${#args[@]})); then
          host="${args[$((i + 1))]}"
          pass_args+=("${args[$i]}" "${args[$((i + 1))]}")
          ((i += 1))
        else
          pass_args+=("${args[$i]}")
        fi
        ;;
      --port)
        if ((i + 1 < ${#args[@]})); then
          port="${args[$((i + 1))]}"
          pass_args+=("${args[$i]}" "${args[$((i + 1))]}")
          ((i += 1))
        else
          pass_args+=("${args[$i]}")
        fi
        ;;
      *)
        pass_args+=("${args[$i]}")
        ;;
    esac
  done

  browser_host="$(browser_host_for_url "$host")"
  connect_host="$(connect_host_for_port "$host")"
  url="http://$browser_host:$port/"

  if webui_is_running "$url"; then
    target_url="$(webui_url_for_cwd "$url" "$cwd")"
    echo "Pi Web UI already appears to be running at: $url"
    if [[ "$dev_mode" -eq 1 ]]; then
      echo "--dev only affects newly started servers; stop the existing server first to run this checkout."
    fi
    print_manual_url "$target_url"
    exit 0
  fi

  if port_is_in_use "$host" "$port"; then
    echo "Port $port is already in use on $connect_host; not starting Pi Web UI." >&2
    if http_ok "$url"; then
      echo "An HTTP server responded at $url, but it did not expose Pi Web UI status." >&2
    else
      echo "No Pi Web UI status endpoint responded at $url." >&2
    fi
    exit 1
  fi

  if [[ "$dev_mode" -eq 1 ]]; then
    dev_update_local_packages
    local_webui_bin="$(local_pi_webui_bin)"
    webui_cmd=(node "$local_webui_bin")
    export PI_WEBUI_DEV=1
    echo "Dev mode: using local Pi Web UI server: $local_webui_bin"
  else
    ensure_pi_webui
    webui_cmd=("$PI_WEBUI_COMMAND")
    unset PI_WEBUI_DEV
  fi

  echo "Starting Pi Web UI in: $cwd"
  echo "Web UI URL: $url"

  "${webui_cmd[@]}" --cwd "$cwd" --host "$host" --port "$port" "${pass_args[@]}" &
  SERVER_PID="$!"

  trap cleanup EXIT
  trap 'cleanup; exit 130' INT
  trap 'cleanup; exit 143' TERM

  if wait_until_ready "$url" "$SERVER_PID"; then
    echo "Pi Web UI is ready."
    print_manual_url "$url"
  else
    ready_status="$?"
    if [[ "$ready_status" -eq 2 ]]; then
      echo "Pi Web UI exited before it became ready." >&2
      wait "$SERVER_PID"
      exit $?
    fi

    echo "Server did not respond yet; not opening a browser automatically." >&2
    print_manual_url "$url"
  fi

  wait "$SERVER_PID"
}

main "$@"
