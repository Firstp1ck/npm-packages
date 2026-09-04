# Development guide: Frontend Design Prompts for Pi

Contributor-only implementation, prompt contract, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package structure

The package registers the non-recursive `prompts` directory through the `pi.prompts` manifest field. The `prompts/land-page.md` filename exposes the `/land-page` command.

## Prompt contract

The template accepts all trailing text through `$ARGUMENTS` and treats it as optional design or project context. Keep these requirements intact when revising it:

- Five implemented concepts at `/1` through `/5`.
- A usable concept switcher on every route.
- Meaningfully different art direction rather than palette-only variations.
- Real copy and working interactions.
- Responsive and accessible output.
- Repository inspection before edits and verification afterward.
- Conflict handling for existing routes and approval before major dependency changes.

The prompt stays framework-neutral so it can follow the target project's router and component conventions.

## Validation

From the package directory, inspect the npm archive before publication:

```bash
npm pack --dry-run
```

Confirm that `prompts/land-page.md`, `README.md`, and `LICENSE` are present. For a local Pi check from the repository root, install the directory, restart Pi, and confirm `/land-page` appears in autocomplete:

```bash
pi install ./pi-package-prompts-frontend
```

Remove the local package after testing if it should not remain in your Pi settings.
