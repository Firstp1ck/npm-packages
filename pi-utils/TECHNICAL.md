# Technical reference: Shared Pi extension utilities

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Runtime behavior

This is a shared dependency for other Firstpick Pi packages. It registers no user commands or model tools and has no standalone settings. Path helpers honor Pi’s configured agent directory, including `PI_CODING_AGENT_DIR`, when downstream packages use them. The utility package itself performs no background network access or persistent work; callers decide when exported helpers read, write, execute, or fetch.
