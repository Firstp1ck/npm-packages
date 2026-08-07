# Technical reference: Setup Skills for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md)

Adds `/skills`, an interactive Pi UI for enabling/disabling skills.

![Interactive skill manager](https://unpkg.com/@firstpick/pi-extension-setup-skills/images/setup_skills_v0.1.3.png)

## Usage

```text
/skills
```

Controls:

- `↑` / `↓`: navigate
- `Enter` / `Space`: toggle selected skill
- Type: search/filter
- `Esc` or `q`: cancel
- `Ctrl+S`: save

The command updates Pi settings and prompts for `/reload` after changes.

## What it manages

The extension discovers skills from Pi's standard local locations and configured Pi packages:

- `~/.pi/agent/skills`
- `~/.agents/skills`
- project `.pi/skills`
- project `.agents/skills`
- skills exposed by entries in `settings.json` `packages`

For local skill selection it writes explicit `skills` filters. For package-bundled skills it preserves the package entry and updates its `skills` filter.
