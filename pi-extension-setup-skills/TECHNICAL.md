# Technical reference: Skills for Pi

Advanced user setup, configuration, compatibility, and troubleshooting information.

[Back to README](README.md)

## Command

`/skills` opens the scope chooser in Pi's interactive TUI:

1. **Session only**
2. **Global default**
3. **Model default**

Session choices take precedence over an exact case-sensitive provider/model profile. A model profile takes precedence over the global default, which takes precedence over Pi's runtime skill set. **Use inherited defaults** removes the selected override. An empty saved selection intentionally enables no skills.

The selector discovers skills from Pi's standard user and project locations and configured Pi packages. It keeps saved names that are temporarily unavailable so reinstalling a package does not silently erase a profile.

## Runtime behavior

The extension applies scoped skill choices in TUI mode. It updates the skill list in the system prompt, blocks explicit invocation of disabled skills, and can expand a selected installed skill even when Pi's base settings did not register its native `/skill:name` command.

When Pi starts with `--no-skills` or `-ns`, `/skills` lists only the skills Pi loaded for that session, including explicit `--skill` paths. It does not scan the normal skill locations, so disabling discovery still has its intended effect.

Model changes and session-tree navigation recompute inherited choices immediately. No reload is required after saving.

## Storage and WebUI compatibility

Global and model selections use the shared resource defaults in `~/.pi/webui/settings.json`. Session selections use `webui-skills-config` entries on the active session branch. WebUI reads and writes the same data, but it does not register the TUI `/skills` command.

The extension preserves unrelated settings and uses the same settings lock protocol as WebUI when writing resource defaults.
