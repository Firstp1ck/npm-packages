# Technical reference: Wiki Tools for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Pi extension + skill for creating local wiki/documentation extension packages from the repository wiki templates.

## Registered commands

- `/wiki-templates` — lists available template directories.
- `/wiki-create <repo-url-or-topic> [--repo-url URL] [--target-dir DIR] [--doc-format markdown|asciidoc|html] [--dry-run] [--overwrite] [--yes] [--agent-review] [--no-agent-review]` — interactively creates a new local wiki package. In UI mode it prompts for missing input, previews inferred values, lets you choose dry-run/create, validates after writing, and by default queues an agent review/tuning pass. If the first argument is a repository URL, names and the setup command are inferred from that URL. Generic repo names like `documentation`, `docs`, and `wiki` use the repository owner as the topic.
- `/wiki-update <repo-url-or-topic> --target-dir DIR [--overwrite] [--apply]` — previews or applies a template refresh. Defaults to dry-run; `--apply` writes files.
- `/wiki-validate <target-dir>` — validates a generated wiki package.

Commands also accept a JSON object, for example:

```txt
/wiki-create https://github.com/example/example-wiki.git
/wiki-create https://github.com/example/example-wiki.git --yes --no-agent-review
/wiki-create {"repoUrl":"https://github.com/example/example-wiki.git"}
```

## Example

```text
/wiki-create https://github.com/example/example-wiki.git --doc-format markdown
/wiki-validate ./pi-extension-example-wiki-local
```

Each generated package includes wiki-specific setup, status, and smoke-test commands. The generated setup command shallow-clones or updates the configured repository in the local docs path. Template parsers currently support `markdown`, `asciidoc`, and `html`; see `DEVELOPMENT.md` for model-tool contracts and generated naming conventions.

## Safety

`create_wiki` and `/wiki-create` refuse to write into an existing target unless `overwrite: true` / `--overwrite` is set. `/wiki-create` is safe by default in interactive UI mode because it previews before writing. `update_wiki` defaults to `dryRun: true`; use the dry-run plan before overwriting customized package files.
