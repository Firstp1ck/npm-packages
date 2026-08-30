# Technical reference: Tools for Pi

Advanced user setup, configuration, compatibility, and troubleshooting information.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Command

`/tools` opens the scope chooser in Pi's interactive TUI:

1. **Session only**
2. **Global default**
3. **Model default**

Session choices take precedence over an exact case-sensitive provider/model profile. A model profile takes precedence over the global default, which takes precedence over Pi's runtime tool set. **Use inherited defaults** removes the selected override. An empty saved selection intentionally enables no tools.

The selector keeps saved names that are temporarily unavailable so reinstalling an extension does not silently erase a profile.

## Runtime behavior

The extension applies scoped tool choices in TUI mode. Model changes and session-tree navigation recompute inherited choices immediately. No reload is required after saving.

## Storage and WebUI compatibility

Global and model selections use the shared resource defaults in `~/.pi/webui/settings.json`. Session selections use `webui-tools-config` entries on the active session branch. WebUI reads and writes the same data, but it does not register the TUI `/tools` command.

The extension preserves unrelated settings and uses the same settings lock protocol as WebUI when writing resource defaults.
