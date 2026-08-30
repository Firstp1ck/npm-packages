# Technical reference: Shared Pi extension utilities

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Runtime behavior

This is a shared dependency for other Firstpick Pi packages. It registers no user commands or model tools. Path helpers honor Pi's configured agent directory, including `PI_CODING_AGENT_DIR`, when downstream packages use them.

The resource-management helpers coordinate tool and skill defaults shared by extension-owned TUI commands and WebUI. Callers explicitly trigger reads and writes; the package performs no background work or network access. Resource writes preserve unrelated settings and use WebUI's settings lock protocol.
