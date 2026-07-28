# pi-extension-git-footer-status

Enhanced Pi footer with git health and model/token telemetry.

![Status bar with metrics and git context](https://unpkg.com/@firstpick/pi-extension-git-footer-status/images/Statusbar_v0.1.5.png)

## What it does

- Shows compact runtime metrics in the footer:
  - input/output/cache tokens
  - export-backed initial prompt estimate (`PI: X tok`, same estimator as `/stats-pi`, compacted as `k` for thousands; falls back to live context data if Pi HTML export is unavailable)
  - always-visible cumulative session output counter + token output speed (`tok/s`) measured from assistant streaming lifecycle events; the latest speed remains visible while idle and falls back to session history
  - cost + context-window usage
  - current model and reasoning level
- Shows git status context on the path line:
  - branch/detached state
  - ahead/behind
  - staged/unstaged/untracked/conflicts
  - operation state (rebase/merge/cherry-pick/revert/bisect)
  - stash/submodule/worktree/tag/last-commit-age/signing mismatch indicators
- Publishes the same footer data as a structured `git-footer-webui` status payload so Pi Web UI can render the extension-owned footer instead of duplicating this logic in the Web UI package.

## Install

```bash
pi install npm:@firstpick/pi-extension-git-footer-status
```

## Configuration

No required configuration.

Performance-related environment toggles:

- `PI_GIT_FOOTER_FETCH=0` — disable startup `git fetch`. Enabled by default.
- `PI_GIT_FOOTER_AUTO_REFRESH_MS=10000` — git status auto-refresh interval. Set `0` to disable.
- `PI_GIT_FOOTER_DISABLE_PROMPT_ESTIMATE=1` — disable the background `PI: X tok` prompt estimate.

Visibility controls:

Changes made with `/git-footer-visibility` or the WebUI Git-footer Visibility dialog are saved globally in `~/.pi/agent/git-footer-visibility.json` and reloaded by every Pi session. `PI_CODING_AGENT_DIR` relocates the agent directory; `PI_GIT_FOOTER_SETTINGS_FILE` can override this settings file directly.

- `PI_GIT_FOOTER_HIDE=cost,context` — hide keys everywhere.
- `PI_GIT_FOOTER_NATIVE_HIDE=model,thinking` — hide keys only in the native TUI footer.
- `PI_GIT_FOOTER_WEBUI_HIDE=webui-refresh-button,webui-details-button` — hide keys only in Web UI.
- `PI_GIT_FOOTER_<KEY>=0|1`, `PI_GIT_FOOTER_NATIVE_<KEY>=0|1`, or `PI_GIT_FOOTER_WEBUI_<KEY>=0|1` — explicit per-key overrides, with dashes written as underscores, e.g. `PI_GIT_FOOTER_WEBUI_CHANGES_MODAL=0`.

Useful keys include metric cards (`tokens`, `cache`, `pi`, `speed`, `cost`, `context`), metadata cards (`cwd`, `git`, `git-state`, `sync`, `changes`, `git-extra`, `worktree`, `model`, `thinking`), git subitems (`git-branch-indicator`, `git-ahead`, `git-behind`, `git-staged`, `git-unstaged`, `git-untracked`, `git-conflicted`, `git-clean`, `git-stash`, `git-submodules`, `git-worktrees`, `git-tag`, `git-last-commit-age`, `git-signing-mismatch`), native footer areas (`cwd-branch`, `git-status`, `extension-statuses`), and Web UI affordances (`webui-fetch-state`, `webui-refresh-button`, `webui-details-button`, `webui-cwd-picker`, `webui-pi-calibration`, `webui-context-auto-compaction`, `webui-branch-picker`, `webui-git-init`, `webui-sync-push`, `webui-changes-modal`, `webui-git-tools-modal`, `webui-model-picker`, `webui-thinking-picker`, `webui-changed-files-popover`).

The initial prompt estimate and session-usage recompute run lazily after the TUI is ready, so the footer should not block startup.

## Commands

- `/git-footer-refresh` — refresh git/footer information immediately.
- `/git-footer-visibility` — in native TUI mode, open an interactive searchable visibility selector. Use Enter/Space to toggle items, Ctrl+S to apply, and Esc/q to cancel.
- `/git-footer-visibility select [all|native|webui]` — open the native TUI selector for both targets or a specific target.
- `/git-footer-visibility [status|keys]` — inspect available visibility keys and their native/Web UI state.
- `/git-footer-visibility show|hide|toggle|reset [all|native|webui] <key> [key...]` — save global visibility overrides for future Pi sessions, e.g. `/git-footer-visibility hide webui cost context webui-changes-modal`. `reset` removes saved overrides and restores environment/default behavior.

## Tools

None.

## Example view

```text
🪙 ↑126k · ↓11k │ 💾 R1.4M │ PI: 6.8k tok │ ⚡ 11k tok @ 48.6 tok/s │ 💸 $1.667 (sub) │ 🧠 19.0%/272k                                                                                                                (openai-codex) gpt-5.5 • low
~/pi-coding-agent-forge (main) │ ✎15 │ ⏱15m · Agent
```

At a glance you can see token flow, cache reads, prompt-injection size, streaming speed, cost/subscription state, context pressure, model/reasoning level, current repo/branch, dirty-file count, and session time without running `git status`.
