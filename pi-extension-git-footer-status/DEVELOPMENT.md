# Development guide: Git Footer Status for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Diagnostic surfaces

`/git-footer-pi-debug` exposes bounded prompt-estimator diagnostics, and `Ctrl+Shift+G` exposes Git signing-mismatch diagnostics. Keep these outputs free of credentials and private provider payloads.

## Additional implementation details

- Shows compact runtime metrics in the footer:
  - input/output/cache tokens
  - export-backed initial prompt estimate (`PI: X tok`, same estimator as `/stats-pi`, compacted as `k` for thousands; falls back to live context data if Pi HTML export is unavailable)
  - always-visible cumulative session output counter + token output speed (`tok/s`) measured from assistant streaming lifecycle events; the latest speed remains visible while idle and falls back to session history. Optional session speed stats — average (`speed-avg`), 1% low (`speed-low`, mean of the slowest 1% of samples), and max spike (`speed-max`) — are hidden by default and shown only when enabled via `/git-footer-visibility` (e.g. `/git-footer-visibility show all speed-avg speed-low speed-max`)
  - cost + context-window usage
  - provider subscription usage captured passively from `after_provider_response` headers: Codex window labels come from provider-reported `*-window-minutes` metadata (with neutral primary/secondary fallbacks), while Anthropic uses its explicit 5h/7d unified windows; shown only for the matching active provider and hidden for API-key Anthropic auth, unavailable/malformed values, or stale snapshots
  - current model and reasoning level
- Shows git status context on the path line:
  - branch/detached state
  - ahead/behind
  - staged/unstaged/untracked/conflicts
  - operation state (rebase/merge/cherry-pick/revert/bisect)
  - stash/submodule/worktree/tag/last-commit-age/signing mismatch indicators
- Publishes the same footer data as a structured `git-footer-webui` status payload so Pi Web UI can render the extension-owned footer instead of duplicating this logic in the Web UI package.
