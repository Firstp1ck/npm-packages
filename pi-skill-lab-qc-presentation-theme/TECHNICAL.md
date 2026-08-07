# Technical reference: Lab QC Presentation Theme

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Pi package containing the `lab-qc-presentation-theme` Agent Skill.

Use it to create or restyle browser-based HTML/CSS/JS presentations for chemical production quality-control laboratory audiences:

- laboratory technicians;
- scientists;
- quality-control teamleaders.

The skill captures the reusable **styling, theming, deck mechanics, and audience framing** from the successful green laboratory-themed presentation. It intentionally ignores previous presentation content and instructs agents to regenerate slides only from the current source material.

## What it provides

The package provides a static, browser-openable green laboratory deck system with keyboard navigation, overview, notes, and print/PDF support. It also includes detailed theme guidance for consistent QC-laboratory presentation work. Contributor file layout and contract tests are documented in `DEVELOPMENT.md`.

## Install

From npm after publishing:

```bash
pi install npm:@firstpick/pi-skill-lab-qc-presentation-theme
```

From a local checkout:

```bash
pi install <absolute-path-to-package>
```

Installing or enabling packages changes the active Pi runtime configuration; review the skill first.

## Notes

- No build step or runtime dependencies are required.
- Generated presentations should remain static and browser-openable.
- Company logos should be supplied per deck and referenced locally, not bundled by default.
