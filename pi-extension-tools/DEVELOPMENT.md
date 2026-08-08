# Development guide: Tools for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Persistence design

The global `tools.json` file is the cross-session source of truth. The extension also writes custom entries to the current Pi session branch for branch-history and diagnostic compatibility. Startup precedence is global file, then current branch state, then Pi’s current active-tool set.

Keep persistence changes backward compatible with existing `active` and `inactive` lists.
