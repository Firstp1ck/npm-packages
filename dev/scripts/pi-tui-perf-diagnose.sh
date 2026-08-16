#!/usr/bin/env bash
# Diagnose Pi TUI performance by collecting startup timings, TUI render logs,
# and optional per-extension probes.
#
# Default output: /tmp/pi-tui-perf-YYYYmmdd-HHMMSS

set -u
set -o pipefail

PI_BIN_DEFAULT="$(command -v pi 2>/dev/null || true)"
PI_BIN="${PI_BIN:-$PI_BIN_DEFAULT}"
LOG_DIR="${PI_TUI_PERF_LOG_DIR:-/tmp/pi-tui-perf-$(date +%Y%m%d-%H%M%S)}"
IDLE_SECONDS=15
DEEP=0
EXTENSION_IDLE=0
CPU_PROFILE=0
STARTUP_ONLY=0
TUI_ONLY=0
OFFLINE=1
BLOCK_GIT_FETCH=1
TOOLS="read,bash,edit,write,grep,find,ls"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SHIM_BIN_DIR="$LOG_DIR/bin"
REAL_GIT="$(command -v git 2>/dev/null || true)"

usage() {
  cat <<'EOF'
Usage: ./dev/scripts/pi-tui-perf-diagnose.sh [options]

Runs step-by-step Pi TUI performance diagnostics and writes logs + summary.

Options:
  --log-dir DIR          Output directory (default: /tmp/pi-tui-perf-<timestamp>)
  --pi-bin PATH          Pi executable (default: command -v pi)
  --idle-seconds N       Seconds to let each automated TUI probe sit idle (default: 15)
  --deep                 Also run startup probes for each discovered extension
  --extension-idle       Slow: run idle TUI probe for each discovered extension
  --cpu-profile          Capture one normal-session Node CPU profile during idle probe
  --startup-only         Skip automated TUI idle probes
  --tui-only             Skip startup benchmark probes
  --no-offline           Do not force PI_OFFLINE=1
  --allow-git-fetch      Do not install the default git-fetch-blocking shim
  -h, --help             Show this help

Recommended first run:
  ./dev/scripts/pi-tui-perf-diagnose.sh

Deeper extension isolation:
  ./dev/scripts/pi-tui-perf-diagnose.sh --deep

Very slow but thorough render-loop isolation:
  ./dev/scripts/pi-tui-perf-diagnose.sh --extension-idle --idle-seconds 8
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    --pi-bin)
      PI_BIN="${2:-}"
      shift 2
      ;;
    --idle-seconds)
      IDLE_SECONDS="${2:-}"
      shift 2
      ;;
    --deep)
      DEEP=1
      shift
      ;;
    --extension-idle)
      EXTENSION_IDLE=1
      DEEP=1
      shift
      ;;
    --cpu-profile)
      CPU_PROFILE=1
      shift
      ;;
    --startup-only)
      STARTUP_ONLY=1
      shift
      ;;
    --tui-only)
      TUI_ONLY=1
      shift
      ;;
    --no-offline)
      OFFLINE=0
      shift
      ;;
    --allow-git-fetch)
      BLOCK_GIT_FETCH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PI_BIN" || ! -x "$PI_BIN" ]]; then
  echo "Could not find executable pi. Use --pi-bin /path/to/pi or set PI_BIN." >&2
  exit 2
fi

if ! [[ "$IDLE_SECONDS" =~ ^[0-9]+$ ]] || [[ "$IDLE_SECONDS" -lt 1 ]]; then
  echo "--idle-seconds must be a positive integer" >&2
  exit 2
fi

mkdir -p "$LOG_DIR" "$LOG_DIR/startup" "$LOG_DIR/tui" "$LOG_DIR/config" "$LOG_DIR/profiles" "$SHIM_BIN_DIR"
STARTUP_TSV="$LOG_DIR/startup-timings.tsv"
TUI_TSV="$LOG_DIR/tui-idle.tsv"
EXT_TSV="$LOG_DIR/extension-startup.tsv"
SUMMARY="$LOG_DIR/summary.md"

FAST_BASE=(
  --no-extensions
  --no-skills
  --no-prompt-templates
  --no-themes
  --no-context-files
  --tools "$TOOLS"
  --append-system-prompt ""
)
FAST_COMMON=(--tools "$TOOLS" --append-system-prompt "")

base_env_common() {
  local envs=(PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 GIT_TERMINAL_PROMPT=0)
  if [[ "$OFFLINE" -eq 1 ]]; then
    envs+=(PI_OFFLINE=1)
  fi
  if [[ "$BLOCK_GIT_FETCH" -eq 1 && -n "$REAL_GIT" ]]; then
    envs+=(PATH="$SHIM_BIN_DIR:$PATH" PI_TUI_PERF_REAL_GIT="$REAL_GIT")
  fi
  printf '%s\0' "${envs[@]}"
}

startup_env() {
  local envs=()
  while IFS= read -r -d '' item; do envs+=("$item"); done < <(base_env_common)
  envs+=(PI_TIMING=1 PI_STARTUP_BENCHMARK=1)
  printf '%s\0' "${envs[@]}"
}

tui_env() {
  local ansi_log="$1"
  local envs=()
  while IFS= read -r -d '' item; do envs+=("$item"); done < <(base_env_common)
  envs+=(PI_TUI_WRITE_LOG="$ansi_log" TERM="${TERM:-xterm-256color}" COLUMNS="${COLUMNS:-120}" LINES="${LINES:-40}")
  printf '%s\0' "${envs[@]}"
}

sanitize_label() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._+-' '_' | sed 's/^_\+//; s/_\+$//; s/__\+/_/g'
}

write_command_file() {
  local path="$1"
  shift
  {
    printf '# working directory: %s\n' "$(pwd)"
    printf '# generated: %s\n' "$(date -Is)"
    printf 'Command:\n  '
    printf '%q ' "$@"
    printf '\n'
  } > "$path"
}

extract_timing_ms() {
  local label="$1"
  local file="$2"
  awk -v label="$label" '$0 ~ label ":" {gsub(/ms/, "", $2); value=$2; gsub(/\r/, "", value)} END {print value}' "$file"
}

run_startup_case() {
  local raw_label="$1"
  shift
  local label
  label="$(sanitize_label "$raw_label")"
  local stdout="$LOG_DIR/startup/${label}.stdout.log"
  local stderr="$LOG_DIR/startup/${label}.stderr.log"
  local pty_log="$LOG_DIR/startup/${label}.pty.log"
  local command_file="$LOG_DIR/startup/${label}.command.txt"
  local envs=()
  while IFS= read -r -d '' item; do envs+=("$item"); done < <(startup_env)

  echo "[startup] $raw_label"
  write_command_file "$command_file" env "${envs[@]}" "$PI_BIN" "$@"

  local start_ns end_ns wall_ms rc timing_source
  start_ns="$(date +%s%N)"
  if command -v script >/dev/null 2>&1; then
    local quoted_cmd
    printf -v quoted_cmd '%q ' env "${envs[@]}" "$PI_BIN" "$@"
    timeout --foreground 90 script -qfec "$quoted_cmd" "$pty_log" >"$stdout" 2>"$stderr" < /dev/null
    rc=$?
    timing_source="$pty_log"
  else
    env "${envs[@]}" "$PI_BIN" "$@" >"$stdout" 2>"$stderr"
    rc=$?
    timing_source="$stderr"
  fi
  end_ns="$(date +%s%N)"
  wall_ms=$(( (end_ns - start_ns) / 1000000 ))

  local total_ms create_runtime_ms agent_runtime_ms init_theme_ms interactive_init_ms
  total_ms="$(extract_timing_ms TOTAL "$timing_source")"
  create_runtime_ms="$(extract_timing_ms createRuntime "$timing_source")"
  agent_runtime_ms="$(extract_timing_ms createAgentSessionRuntime "$timing_source")"
  init_theme_ms="$(extract_timing_ms initTheme "$timing_source")"
  interactive_init_ms="$(extract_timing_ms interactiveMode.init "$timing_source")"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$label" "$rc" "$wall_ms" "${total_ms:-}" "${create_runtime_ms:-}" \
    "${agent_runtime_ms:-}" "${init_theme_ms:-}" "${interactive_init_ms:-}" \
    "$stdout" "$stderr" "$pty_log" "$command_file" >> "$STARTUP_TSV"
}

run_tui_idle_case() {
  local raw_label="$1"
  shift
  local label
  label="$(sanitize_label "$raw_label")"
  local ansi_log="$LOG_DIR/tui/${label}.ansi.log"
  local pty_log="$LOG_DIR/tui/${label}.pty.log"
  local stdout="$LOG_DIR/tui/${label}.stdout.log"
  local stderr="$LOG_DIR/tui/${label}.stderr.log"
  local command_file="$LOG_DIR/tui/${label}.command.txt"
  local debug_copy="$LOG_DIR/tui/${label}.pi-debug.log"
  local envs=()
  while IFS= read -r -d '' item; do envs+=("$item"); done < <(tui_env "$ansi_log")

  echo "[tui-idle] $raw_label (${IDLE_SECONDS}s idle + /debug + /quit)"
  rm -f "$ansi_log" "$debug_copy"
  write_command_file "$command_file" env "${envs[@]}" "$PI_BIN" "$@"

  if ! command -v script >/dev/null 2>&1; then
    echo "The 'script' command is not available; skipping automated TUI probe." > "$stderr"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$label" "127" "$IDLE_SECONDS" "" "" "" "" "$ansi_log" "$pty_log" "$stderr" >> "$TUI_TSV"
    return
  fi

  local quoted_cmd
  printf -v quoted_cmd '%q ' env "${envs[@]}" "$PI_BIN" "$@"

  local timeout_seconds=$(( IDLE_SECONDS + 30 ))
  local rc
  (
    sleep "$IDLE_SECONDS"
    printf '/debug\r'
    sleep 1
    printf '/quit\r'
  ) | timeout --foreground "$timeout_seconds" script -qfec "$quoted_cmd" "$pty_log" >"$stdout" 2>"$stderr"
  rc=${PIPESTATUS[1]}

  local debug_src="$AGENT_DIR/pi-debug.log"
  if [[ -f "$debug_src" ]]; then
    cp "$debug_src" "$debug_copy" 2>/dev/null || true
  fi

  local ansi_bytes="" ansi_lines="" pty_bytes="" debug_total_lines=""
  if [[ -f "$ansi_log" ]]; then
    ansi_bytes="$(wc -c < "$ansi_log" | tr -d ' ')"
    ansi_lines="$(wc -l < "$ansi_log" | tr -d ' ')"
  fi
  if [[ -f "$pty_log" ]]; then
    pty_bytes="$(wc -c < "$pty_log" | tr -d ' ')"
  fi
  if [[ -f "$debug_copy" ]]; then
    debug_total_lines="$(awk -F': ' '/^Total lines:/ {print $2; exit}' "$debug_copy")"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$label" "$rc" "$IDLE_SECONDS" "${ansi_bytes:-}" "${ansi_lines:-}" \
    "${pty_bytes:-}" "${debug_total_lines:-}" "$ansi_log" "$pty_log" "$stderr" >> "$TUI_TSV"
}

discover_extensions() {
  local ext_dir="$AGENT_DIR/extensions"
  [[ -d "$ext_dir" ]] || return 0
  # Match Pi auto-discovery shape: direct *.ts files and one-level */index.ts
  # entries. Do not descend into extension helper src/tests files.
  find -L "$ext_dir" -maxdepth 2 \
    \( -path '*/node_modules/*' -o -path '*/tests/*' -o -path '*/dev/*' \) -prune -o \
    -type f \( -path "$ext_dir/*.ts" -o -path "$ext_dir/*/index.ts" \) -print 2>/dev/null | sort
}

extension_label_for_path() {
  local path="$1"
  local base parent
  base="$(basename "$path")"
  if [[ "$base" == "index.ts" ]]; then
    parent="$(basename "$(dirname "$path")")"
    sanitize_label "$parent"
  else
    sanitize_label "${base%.ts}"
  fi
}

setup_shims() {
  [[ "$BLOCK_GIT_FETCH" -eq 1 ]] || return 0
  [[ -n "$REAL_GIT" ]] || return 0

  cat > "$SHIM_BIN_DIR/git" <<'EOF'
#!/usr/bin/env bash
set -u
real_git="${PI_TUI_PERF_REAL_GIT:-}"
if [[ -z "$real_git" || ! -x "$real_git" ]]; then
  real_git="/usr/bin/git"
fi

# Keep diagnostics local/read-only by default. The git-footer-status extension
# may run `git -c credential.interactive=false fetch` on session start.
args=("$@")
if [[ " ${args[*]} " == *" fetch "* ]]; then
  echo "pi-tui-perf-diagnose: blocked git fetch by default; rerun with --allow-git-fetch to permit it" >&2
  exit 128
fi
exec "$real_git" "$@"
EOF
  chmod +x "$SHIM_BIN_DIR/git"
}

collect_context() {
  {
    echo "# Pi TUI performance diagnostic context"
    echo "date=$(date -Is)"
    echo "cwd=$(pwd)"
    echo "pi_bin=$PI_BIN"
    echo "agent_dir=$AGENT_DIR"
    echo "log_dir=$LOG_DIR"
    echo "offline=$OFFLINE"
    echo "block_git_fetch=$BLOCK_GIT_FETCH"
    echo "real_git=$REAL_GIT"
    echo "shim_bin_dir=$SHIM_BIN_DIR"
    echo "idle_seconds=$IDLE_SECONDS"
    echo
    echo "## Versions"
    "$PI_BIN" --version 2>&1 | sed 's/^/pi_version=/' || true
    command -v node >/dev/null 2>&1 && node --version | sed 's/^/node_version=/' || true
    command -v npm >/dev/null 2>&1 && npm --version | sed 's/^/npm_version=/' || true
    command -v bun >/dev/null 2>&1 && bun --version | sed 's/^/bun_version=/' || true
    echo
    echo "## Terminal"
    echo "TERM=${TERM:-}"
    echo "COLORTERM=${COLORTERM:-}"
    echo "COLUMNS=${COLUMNS:-}"
    echo "LINES=${LINES:-}"
    echo "TTY=$(tty 2>/dev/null || true)"
    echo
    echo "## System"
    uname -a || true
  } > "$LOG_DIR/context.txt"

  if [[ -f "$AGENT_DIR/settings.json" ]]; then
    cp "$AGENT_DIR/settings.json" "$LOG_DIR/config/settings.json" 2>/dev/null || true
  fi

  if [[ -d "$AGENT_DIR/extensions" ]]; then
    find "$AGENT_DIR/extensions" -maxdepth 2 -printf '%M %p -> %l\n' 2>/dev/null | sort > "$LOG_DIR/config/extensions-tree.txt" || true
  fi
  if [[ -d "$AGENT_DIR/skills" ]]; then
    find -L "$AGENT_DIR/skills" -maxdepth 3 -name 'SKILL.md' -print 2>/dev/null | sort > "$LOG_DIR/config/skills.txt" || true
  fi
  if [[ -d "$AGENT_DIR/themes" ]]; then
    find -L "$AGENT_DIR/themes" -maxdepth 1 -name '*.json' -print 2>/dev/null | sort > "$LOG_DIR/config/themes.txt" || true
  fi
  if [[ -d "$AGENT_DIR/prompts" ]]; then
    find -L "$AGENT_DIR/prompts" -maxdepth 1 -name '*.md' -print 2>/dev/null | sort > "$LOG_DIR/config/prompts.txt" || true
  fi
}

run_startup_suite() {
  printf 'label\trc\twall_ms\ttotal_ms\tcreateRuntime_ms\tcreateAgentSessionRuntime_ms\tinitTheme_ms\tinteractiveMode.init_ms\tstdout\tstderr\tpty_log\tcommand\n' > "$STARTUP_TSV"

  run_startup_case normal
  run_startup_case fast_minimal "${FAST_BASE[@]}"

  run_startup_case normal_minus_extensions --no-extensions
  run_startup_case normal_minus_skills --no-skills
  run_startup_case normal_minus_prompt_templates --no-prompt-templates
  run_startup_case normal_minus_themes --no-themes
  run_startup_case normal_minus_context_files --no-context-files

  run_startup_case only_extensions --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"
  run_startup_case only_skills --no-extensions --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"
  run_startup_case only_prompt_templates --no-extensions --no-skills --no-themes --no-context-files "${FAST_COMMON[@]}"
  run_startup_case only_themes --no-extensions --no-skills --no-prompt-templates --no-context-files "${FAST_COMMON[@]}"
  run_startup_case only_context_files --no-extensions --no-skills --no-prompt-templates --no-themes "${FAST_COMMON[@]}"
}

run_extension_startup_suite() {
  printf 'label\textension_path\trc\twall_ms\ttotal_ms\tcreateRuntime_ms\tcreateAgentSessionRuntime_ms\tinitTheme_ms\tinteractiveMode.init_ms\tstdout\tstderr\tpty_log\tcommand\n' > "$EXT_TSV"

  local ext path label stdout stderr pty_log command_file envs start_ns end_ns wall_ms rc timing_source total_ms create_runtime_ms agent_runtime_ms init_theme_ms interactive_init_ms
  while IFS= read -r ext; do
    [[ -n "$ext" ]] || continue
    label="ext_$(extension_label_for_path "$ext")"
    path="$ext"
    stdout="$LOG_DIR/startup/${label}.stdout.log"
    stderr="$LOG_DIR/startup/${label}.stderr.log"
    pty_log="$LOG_DIR/startup/${label}.pty.log"
    command_file="$LOG_DIR/startup/${label}.command.txt"
    envs=()
    while IFS= read -r -d '' item; do envs+=("$item"); done < <(startup_env)

    echo "[extension-startup] $(extension_label_for_path "$ext")"
    write_command_file "$command_file" env "${envs[@]}" "$PI_BIN" --no-extensions -e "$path" --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"

    start_ns="$(date +%s%N)"
    if command -v script >/dev/null 2>&1; then
      local quoted_cmd
      printf -v quoted_cmd '%q ' env "${envs[@]}" "$PI_BIN" --no-extensions -e "$path" --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"
      timeout --foreground 90 script -qfec "$quoted_cmd" "$pty_log" >"$stdout" 2>"$stderr" < /dev/null
      rc=$?
      timing_source="$pty_log"
    else
      env "${envs[@]}" "$PI_BIN" --no-extensions -e "$path" --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}" >"$stdout" 2>"$stderr"
      rc=$?
      timing_source="$stderr"
    fi
    end_ns="$(date +%s%N)"
    wall_ms=$(( (end_ns - start_ns) / 1000000 ))

    total_ms="$(extract_timing_ms TOTAL "$timing_source")"
    create_runtime_ms="$(extract_timing_ms createRuntime "$timing_source")"
    agent_runtime_ms="$(extract_timing_ms createAgentSessionRuntime "$timing_source")"
    init_theme_ms="$(extract_timing_ms initTheme "$timing_source")"
    interactive_init_ms="$(extract_timing_ms interactiveMode.init "$timing_source")"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$label" "$path" "$rc" "$wall_ms" "${total_ms:-}" "${create_runtime_ms:-}" \
      "${agent_runtime_ms:-}" "${init_theme_ms:-}" "${interactive_init_ms:-}" \
      "$stdout" "$stderr" "$pty_log" "$command_file" >> "$EXT_TSV"
  done < <(discover_extensions)
}

run_tui_suite() {
  printf 'label\trc\tidle_seconds\tansi_bytes\tansi_lines\tpty_bytes\tdebug_total_lines\tansi_log\tpty_log\tstderr\n' > "$TUI_TSV"

  run_tui_idle_case normal
  run_tui_idle_case fast_minimal "${FAST_BASE[@]}"
  run_tui_idle_case normal_no_extensions --no-extensions
  run_tui_idle_case only_extensions --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"

  local suspect
  for suspect in \
    "$AGENT_DIR/extensions/git-footer-status/index.ts" \
    "$AGENT_DIR/extensions/todo-progress/index.ts" \
    "$AGENT_DIR/extensions/webui/index.ts" \
    "$AGENT_DIR/extensions/remote-webui/index.ts"; do
    if [[ -f "$suspect" ]]; then
      run_tui_idle_case "only_$(extension_label_for_path "$suspect")" --no-extensions -e "$suspect" --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"
    fi
  done

  if [[ "$EXTENSION_IDLE" -eq 1 ]]; then
    local ext
    while IFS= read -r ext; do
      [[ -n "$ext" ]] || continue
      run_tui_idle_case "idle_ext_$(extension_label_for_path "$ext")" --no-extensions -e "$ext" --no-skills --no-prompt-templates --no-themes --no-context-files "${FAST_COMMON[@]}"
    done < <(discover_extensions)
  fi
}

run_cpu_profile() {
  [[ "$CPU_PROFILE" -eq 1 ]] || return 0
  echo "[cpu-profile] normal session (${IDLE_SECONDS}s idle + /quit)"

  local label="cpu_profile_normal"
  local ansi_log="$LOG_DIR/tui/${label}.ansi.log"
  local pty_log="$LOG_DIR/tui/${label}.pty.log"
  local stdout="$LOG_DIR/tui/${label}.stdout.log"
  local stderr="$LOG_DIR/tui/${label}.stderr.log"
  local command_file="$LOG_DIR/tui/${label}.command.txt"
  local envs=()
  while IFS= read -r -d '' item; do envs+=("$item"); done < <(tui_env "$ansi_log")
  envs+=(NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$LOG_DIR/profiles --cpu-prof-name=pi-normal.cpuprofile")

  write_command_file "$command_file" env "${envs[@]}" "$PI_BIN"
  local quoted_cmd
  printf -v quoted_cmd '%q ' env "${envs[@]}" "$PI_BIN"

  if command -v script >/dev/null 2>&1; then
    (
      sleep "$IDLE_SECONDS"
      printf '/quit\r'
    ) | timeout --foreground "$((IDLE_SECONDS + 30))" script -qfec "$quoted_cmd" "$pty_log" >"$stdout" 2>"$stderr" || true
  else
    echo "The 'script' command is not available; skipping CPU profile." > "$stderr"
  fi
}

append_tsv_as_md() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo '```tsv'
    cat "$file"
    echo '```'
  else
    echo '_Not run._'
  fi
}

best_effort_interpretation() {
  local startup_file="$STARTUP_TSV"
  [[ -f "$startup_file" ]] || return 0
  awk -F '\t' '
    NR == 1 {next}
    $1 == "normal" {normal=$3}
    $1 == "fast_minimal" {fast=$3}
    $1 == "normal_minus_extensions" {noext=$3}
    END {
      if (normal && fast) {
        printf "- Startup wall time: normal=%sms, fast_minimal=%sms.\n", normal, fast
      }
      if (normal && fast && noext) {
        saved = normal - noext
        gap = normal - fast
        if (gap > 0) {
          pct = saved * 100 / gap
          printf "- Disabling extensions removes %.1f%% of the normal-vs-fast startup gap.\n", pct
        }
      }
    }
  ' "$startup_file"

  if [[ -f "$TUI_TSV" ]]; then
    awk -F '\t' '
      NR == 1 {next}
      $1 == "normal" {normal_bytes=$4; normal_sec=$3}
      $1 == "fast_minimal" {fast_bytes=$4; fast_sec=$3}
      END {
        if (normal_bytes && normal_sec && fast_bytes && fast_sec) {
          printf "- Idle ANSI output rate: normal=%.1f bytes/s, fast_minimal=%.1f bytes/s.\n", normal_bytes / normal_sec, fast_bytes / fast_sec
        }
      }
    ' "$TUI_TSV"
  fi
}

generate_summary() {
  {
    echo "# Pi TUI Performance Diagnostic Summary"
    echo
    echo "Generated: $(date -Is)"
    echo
    echo "Log directory: \`$LOG_DIR\`"
    echo
    echo "## Quick interpretation"
    best_effort_interpretation || true
    echo
    echo "## What was run"
    echo
    echo "- Startup benchmark uses \`PI_TIMING=1 PI_STARTUP_BENCHMARK=1\`."
    echo "- TUI idle probes use \`PI_TUI_WRITE_LOG\`, a pseudo-terminal via \`script\`, wait ${IDLE_SECONDS}s, run \`/debug\`, then \`/quit\`."
    echo "- \`PI_OFFLINE=1\`, \`PI_SKIP_VERSION_CHECK=1\`, and \`PI_TELEMETRY=0\` are set unless \`--no-offline\` was used."
    if [[ "$BLOCK_GIT_FETCH" -eq 1 ]]; then
      echo "- A PATH shim blocks \`git fetch\` by default to keep diagnostics read-only/local. Use \`--allow-git-fetch\` if you want to measure the exact normal network-fetch path."
    fi
    echo
    echo "## Startup timings"
    append_tsv_as_md "$STARTUP_TSV"
    echo
    echo "## TUI idle log sizes"
    append_tsv_as_md "$TUI_TSV"
    echo
    echo "## Per-extension startup timings"
    append_tsv_as_md "$EXT_TSV"
    echo
    echo "## Important files"
    echo
    echo "- Context: \`$LOG_DIR/context.txt\`"
    echo "- Settings snapshot: \`$LOG_DIR/config/settings.json\`"
    echo "- Extension tree: \`$LOG_DIR/config/extensions-tree.txt\`"
    echo "- Startup logs: \`$LOG_DIR/startup/\`"
    echo "- TUI logs: \`$LOG_DIR/tui/\`"
    if [[ "$CPU_PROFILE" -eq 1 ]]; then
      echo "- CPU profiles: \`$LOG_DIR/profiles/\`"
    fi
    echo
    echo "## Next manual checks"
    echo
    echo "1. If \`normal_no_extensions\` is fast and quiet, inspect per-extension startup/idle rows."
    echo "2. Large \`ansi_bytes\` during idle usually means a render loop or frequent status/footer/widget updates."
    echo "3. Open \`*.pi-debug.log\` files to compare rendered line counts and oversized lines."
    echo "4. If CPU profile was collected, open \`$LOG_DIR/profiles/pi-normal.cpuprofile\` in Chromium DevTools."
  } > "$SUMMARY"
}

main() {
  echo "Writing diagnostic logs to: $LOG_DIR"
  setup_shims
  collect_context

  if [[ "$TUI_ONLY" -ne 1 ]]; then
    run_startup_suite
    if [[ "$DEEP" -eq 1 ]]; then
      run_extension_startup_suite
    fi
  fi

  if [[ "$STARTUP_ONLY" -ne 1 ]]; then
    run_tui_suite
    run_cpu_profile
  fi

  generate_summary
  echo
  echo "Done. Summary: $SUMMARY"
}

main "$@"
