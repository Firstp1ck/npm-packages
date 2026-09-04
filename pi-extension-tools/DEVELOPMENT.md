# Development guide: Tools for Pi

Contributor-only implementation, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Resource lifecycle

The extension owns `/tools` and applies tool state only in TUI mode. `@firstpick/pi-utils/scoped-resource-command` owns the shared Session, Global, and Model command flow. `@firstpick/pi-utils/resource-management` owns profile resolution and compatible settings writes.

Tool names remain the stable selection identifiers. The extension passes `ToolInfo.sourceInfo.source` as discovery metadata and `ToolInfo.description` as selected-item help to the shared selector. Presentation metadata is never stored in resource profiles.

Use `webui-tools-config` for session branch entries so WebUI and TUI resume the same explicit or inherited choice. Capture Pi's runtime tool baseline before applying a saved selection. Do not let WebUI register a second `/tools` command.
