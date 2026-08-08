# Development guide: Archwiki Local for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Local development note

The global extension symlink loads only the extension file. To load the packaged skill without a standalone `~/.pi/agent/skills/arch-linux-local` copy, install the package as a local Pi package or add it to Pi package settings.

## Preserved package internals

The first tool call builds the cache through the shared `pi-utils` local-wiki engine. Cache invalidation uses schema version, page count, docs path, and newest source mtime.
