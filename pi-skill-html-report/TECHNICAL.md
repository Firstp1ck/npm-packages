# Technical reference: HTML Report

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Portable Pi/Agent Skill package for creating polished, self-contained HTML reports that explain complex or multi-step material.

The visual system reproduces the approved dark technical report style:

- deep navy radial background;
- rounded dark panels and restrained shadows;
- semantic status badges and callouts;
- hero conclusions, metric/finding cards, numbered steps, evidence tables, and print styling;
- responsive browser-readable output without a build step.

It adds the requested capabilities:

- a mandatory overview table;
- data-grounded graphs when quantitative comparisons or trends warrant them;
- process, dependency, decision, and architecture diagrams when relationships warrant them;
- meaningful inline SVG or local media with accessibility/provenance rules;
- accessible tabs for long reports, including keyboard navigation, URL hashes, no-JavaScript fallback, and print-all-panels behavior.

## Install or enable

Install the published package with:

```bash
pi install npm:@firstpick/pi-skill-html-report
```

For local package development, `pi install <absolute-path-to-package>` remains available. Installing either form changes the active Pi runtime configuration and should be intentional.

## Dependencies

- Generated reports: modern browser only.
- Validator/tests: Python 3.10+ standard library.
- No npm runtime dependencies and no required CDN.
