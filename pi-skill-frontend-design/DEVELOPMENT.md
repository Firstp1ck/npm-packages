# Development guide: Frontend design

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package layout

- `skills/frontend-design/SKILL.md` contains the installable skill.
- `tests/skill-contract.test.mjs` checks package metadata, frontmatter, required guidance, licensing, and documentation links.
- `package.json` declares the Pi skill directory and npm tarball contents.

The package has no runtime code or dependencies.

## License and modification notice

The package uses Apache 2.0 and keeps the complete terms in `LICENSE`. The installable skill carries a short modification notice. Keep both files in the npm tarball.

## Testing

From the package root, run:

```bash
npm test
npm pack --dry-run --json
```

The contract test uses Node's built-in test runner and needs no installed dependencies. Inspect the dry-run file list whenever package metadata changes.

From the repository root, also run:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

## Release maintenance

Use the repository's npm release workflow after the package tests and dry-run tarball check pass. Publication is a separate external action and requires explicit approval. Keep the package name, install command, root catalog entry, and repository directory metadata in sync when renaming the package.
