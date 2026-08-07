# Development guide: Dolt Database Version Control

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Development checks

```bash
npm test
npm pack --dry-run
```

`npm test` requires Python 3 and uses only the standard library.

## Additional implementation details

- Adds the `dolt-database-version-control` skill to Pi's skill library.
- Guides agents through how, when, why, and where to use Dolt for database branching, merging, diffs, rollback, audit history, and versioned MySQL replica workflows.
- Includes a source-backed Dolt reference guide at `skills/dolt-database-version-control/references/dolt-guide.md`.
- Bundles contract tests for frontmatter, required sections, and reference integrity.
