# Development guide: Wiki Tools for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Evaluation expectations

Before considering a generated wiki package complete, test accuracy (relevant top search results, correct titles/headings, source-faithful extracts, smoke-test findings), effectiveness (setup/status/smoke-test behavior, missing-docs failure, prompt routing, diagnostics), and token output (compact search, bounded extract/read defaults, truncation or omitted-section reporting). Tune query expansions plus corpus-derived stopwords/downweights when broad terms over-select results.

## Model-facing integration

The package registers the `wiki-tools` skill plus four model tools:

- `list_wiki_templates` discovers template directories from `WIKI_TEMPLATES_DIR`, `<cwd>/templates`, the bundled `templates/` directory, and the monorepo sibling templates directory.
- `create_wiki` creates `pi-extension-<topic>-wiki-local` packages and accepts `docFormat`, `searchStopWordsCode`, and `termWeightsCode` for corpus-specific tuning.
- `update_wiki` previews or applies template refreshes and defaults to dry-run.
- `validate_wiki` checks required package files, Pi metadata, bundled skill files, and unreplaced placeholders.

Generated tool names use the `<extensionId>_wiki_*` convention, including search, extract, and smoke-test tools.

## Additional implementation details

```txt
pi-extension-example-wiki-local/
├── index.ts
├── package.json
├── LICENSE
├── README.md
└── skills/example-local/SKILL.md
```
