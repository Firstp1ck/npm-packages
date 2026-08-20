# Development guide: Unslop

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `unslop` skill to Pi's skill library.
- Bundles a single file, `skills/unslop/SKILL.md`. There are no scripts, references, fixtures, or assets.
- The body is the upstream `cursor/plugins` text verbatim, with two local additions: an expanded frontmatter block and a `## Source` section at the end.

## Frontmatter divergence from upstream

Upstream uses `description: Cut AI tells from any writing. Must always apply.` This package replaces it with a longer description that names the artifacts agents should apply it to, because Pi matches skills on description text and the four-word upstream version rarely triggers. The `license` and `compatibility` fields follow the convention in `pi-skill-project-readme`.

The body below the frontmatter is unchanged. Keep it that way when syncing, so a diff against upstream stays readable.

## Syncing with upstream

```bash
curl -fsSL https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/unslop/SKILL.md \
  | diff - skills/unslop/SKILL.md
```

Expect exactly two hunks, the frontmatter and the trailing `## Source` section. Anything else is an upstream change to review and port.

Bump the patch version for a sync that only touches wording. Bump the minor version when upstream adds or removes a numbered pattern, since that changes what the skill does.

## Testing

There is nothing to run. Verify a change by loading the skill and asking Pi to rewrite a paragraph seeded with known tells, then check that the numbered patterns you touched still fire.
