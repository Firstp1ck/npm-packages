# Wiki Tools for Pi

Create and maintain local documentation-search extensions from a reusable template.

## What you can do

- Creates a new local-documentation search extension from a template.
- Updates existing generated extensions safely.
- Checks package structure and documentation indexes.
- Lists the templates available for new wiki packages.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-wiki-tools
```

Restart Pi if the package does not appear in your current session.

## How to use it

1. Run `/wiki-templates` to see the available starting points.
2. Create a package from a documentation repository:

```text
/wiki-create https://github.com/example/example-wiki.git
```

3. Review the generated package and run `/wiki-validate <folder>`.
4. Use `/wiki-update` later when you want to preview a template refresh.

Creation refuses to overwrite an existing target by default, and updates start as a preview. Format choices, unattended creation, review controls, and update options are in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-wiki-tools/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
