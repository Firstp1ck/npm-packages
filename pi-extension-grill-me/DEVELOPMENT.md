# Development guide: Grill Me for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Development symlink

For local development, symlink Pi's global extension entry to this package:

```bash
ln -s /home/firstpick/pi-coding-agent-forge/pi-extension-grill-me/index.ts ~/.pi/agent/extensions/grill-me.ts
```

Then run `/reload` in Pi.

## Validation

Run the extension regression tests and static checks from this package directory:

```bash
npm test
npm run check
npm run smoke
```

The regression harness registers the extension against a mock Pi API and exercises the record/save flow in temporary project directories.
