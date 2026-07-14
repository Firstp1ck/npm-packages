#!/usr/bin/env bash
set -euo pipefail

: "${PI_CLI_PATH:?PI_CLI_PATH is required}"
: "${PI_WORKBOOK_ROOT:?PI_WORKBOOK_ROOT is required}"
: "${PI_WORKBOOK_TEST_PATH:?PI_WORKBOOK_TEST_PATH is required}"

output_file="${TMPDIR:-/tmp}/pi-workbook-tui-${$}.log"
cleanup() {
  rm -f "$output_file"
  if [[ -n "${tui_pid:-}" ]] && kill -0 "$tui_pid" 2>/dev/null; then
    if [[ -n "${write_fd:-}" ]]; then printf '\004' >&"$write_fd" 2>/dev/null || true; fi
    sleep 0.2
    taskkill.exe //PID "$tui_pid" //T //F >/dev/null 2>&1 || kill "$tui_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cli_path="$(cygpath -u "$PI_CLI_PATH" 2>/dev/null || printf '%s' "$PI_CLI_PATH")"
root_path="$(cygpath -u "$PI_WORKBOOK_ROOT" 2>/dev/null || printf '%s' "$PI_WORKBOOK_ROOT")"

command=(
  node "$cli_path"
  --offline --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --approve
  --extension "$root_path/index.ts"
  --extension "$root_path/tests/pi/mock-provider.ts"
  --provider workbook-test --model workbook-test/mock
  --no-builtin-tools --tools workbook_inspect
  "Inspect the workbook with the registered workbook tool."
)
printf -v quoted_command '%q ' "${command[@]}"

coproc TUI { script -q -e -c "$quoted_command" /dev/null; }
tui_pid="$TUI_PID"
exec {read_fd}<&"${TUI[0]}"
exec {write_fd}>&"${TUI[1]}"
tail_text=""
deadline=$((SECONDS + 35))
sentinel=0

while (( SECONDS < deadline )); do
  char=""
  if IFS= read -r -n 1 -t 0.1 char <&"$read_fd"; then
    printf '%s' "$char" >>"$output_file"
    tail_text="${tail_text}${char}"
    if (( ${#tail_text} > 80 )); then tail_text="${tail_text: -80}"; fi
    if [[ "$tail_text" == *$'\033[6n'* ]]; then
      printf '\033[1;1R' >&"$write_fd"
      tail_text=""
    fi
    if [[ "$tail_text" == *$'\033[?996n'* ]]; then
      printf '\033[?997;1n' >&"$write_fd"
      tail_text=""
    fi
    if [[ "$tail_text" == *"WORKBOOK_MODE_PASS"* ]]; then
      sentinel=1
      printf '\004' >&"$write_fd"
      break
    fi
  elif ! kill -0 "$tui_pid" 2>/dev/null; then
    break
  fi
done

if (( sentinel == 0 )); then
  echo "TUI sentinel was not observed" >&2
  strings "$output_file" >&2 || true
  exit 1
fi

for _ in {1..30}; do
  if ! kill -0 "$tui_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if kill -0 "$tui_pid" 2>/dev/null; then
  printf '\004' >&"$write_fd" 2>/dev/null || true
  taskkill.exe //PID "$tui_pid" //T //F >/dev/null 2>&1 || kill "$tui_pid" 2>/dev/null || true
fi
wait "$tui_pid" 2>/dev/null || true

echo "tui_status=PASS sentinel=WORKBOOK_MODE_PASS"
