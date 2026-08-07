# Development guide: Hyprland Wiki Local for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Preserved package internals

The first tool call builds the cache through the shared `pi-utils` local-wiki engine. Cache invalidation uses schema version, docs path, page count, and newest source mtime. Markdown parsing uses frontmatter titles and ignores headings inside fenced code blocks.
