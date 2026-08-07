# Development guide: PATCH.md

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Safety enforcement

The approval extension invokes `patchctl apply` with an argument vector rather than shell interpolation. `patchctl` recomputes the plan immediately before transactional mutation so a stale reviewed hash cannot authorize changed work.

## Test

```bash
npm test
```
