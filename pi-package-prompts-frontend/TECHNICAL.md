# Technical reference: Frontend Design Prompts for Pi

Advanced user setup, command behavior, compatibility, and troubleshooting information.

[Back to README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-prompts-frontend
```

## Included prompt

`/land-page [brand, stack, or visual direction]` builds five landing-page concepts for a second-brain note-taking app. It creates routes at `/1`, `/2`, `/3`, `/4`, and `/5`, with a compact route switcher on every page.

Arguments are optional. Use them to point Pi toward existing brand files, name a preferred style, or clarify project constraints:

```text
/land-page Follow docs/brand.md. Keep the existing Astro stack and avoid new dependencies.
```

## Project behavior

The prompt tells Pi to inspect the repository before making changes. It should use the established framework, route layout, components, and dependencies. It also asks Pi to avoid overwriting unrelated numbered routes and to get approval before introducing a framework or major dependency.

The exact file locations depend on the project router. The visible routes remain `/1` through `/5` whether the project uses a pages directory, an app directory, or another routing convention.

## Requirements and compatibility

The package itself has no runtime dependencies. It adds one Markdown prompt and works anywhere Pi prompt packages are supported.

The target project must provide a frontend environment where five routes can be implemented. Available formatters, type checks, tests, builds, and browser tools determine how much verification Pi can perform.

## Troubleshooting

If `/land-page` does not appear, restart Pi and type `/` to refresh prompt autocomplete. Check that the package appears in `pi list` and is enabled in `pi config`.

If the command finds existing `/1` through `/5` routes, review the conflict it reports rather than forcing an overwrite. You can also add route constraints in the command arguments.
