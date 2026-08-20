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

## How your selection is saved

Skills are enabled by default. Saving records only the ones you switched off, which is what keeps later installs working.

For local skills, each deselected skill is written to the `skills` array in `~/.pi/agent/settings.json` as a `-` entry holding its full path:

```json
{
  "skills": ["-/home/you/.pi/agent/skills/example/SKILL.md"]
}
```

For package-bundled skills, the package entry is preserved. When you keep every skill in a package, the entry carries no `skills` filter at all, so skills added by a later package update load on their own. When you switch one off, only that skill is excluded:

```json
{
  "packages": [
    { "source": "npm:example-package", "skills": ["-skills/example/SKILL.md"] }
  ]
}
```

Entries you added yourself, such as an extra skills directory, are left untouched. When no opt-outs remain, the `skills` key is removed rather than left empty.

## Upgrading from earlier versions

Earlier versions saved the opposite way: a blanket `"!**"` that switched every skill off, plus one `+` entry per enabled skill. That made each newly installed skill invisible until you opened `/skills` again, and it pinned a fixed skill list onto every package entry.

The list still reads those older settings correctly, so your current enabled and disabled skills appear as you left them. The first save converts them: `"!**"` is dropped, `+` entries for skills you kept are no longer needed, and pinned package lists become exclusions. No manual migration is required.

If you deliberately want a deny-all baseline, add `"!**"` back to the `skills` array by hand. Note that the next save from `/skills` removes it again.
