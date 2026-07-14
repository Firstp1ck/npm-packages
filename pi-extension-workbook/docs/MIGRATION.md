# Migration notes

## Preview contract to expanded operation matrix

The public workbook contract remains `1.0`. This release is additive: the original value/formula/style/dimension/merge operations keep their exact field shapes, while additional strict operation variants are added to the same discriminated union. Stored calls using the original schema therefore require no argument migration.

### Behavioral hardening

- Unexpected added and removed OOXML parts now fail integrity validation unless the operation explicitly declared each changed part.
- Reads include `displayedValue`, rich-text runs, conditional-format ranges, validation ranges, and hyperlink metadata.
- Inspect results include formula/calculation policy, redacted protection state, VBA inventory, advanced-feature preservation policies, and lazy-storage diagnostics.
- Preview output paths may point to the deterministic cache when `outputDir` is omitted. Consumers must use the returned path rather than assuming a random directory.
- Object-adding operations on `.xlsm` can fail even when the same operation works on `.xlsx`, because byte-identical active-content protection can make `[Content_Types].xml` or relationship parts immutable.
- `copyRange` accepts an optional `sourceSheet` for cross-sheet range templates. Calls without it retain same-sheet behavior.
- Content-changing operations now reject overlap with shared, array, data-table, and dynamic spill formula regions instead of risking partial corruption.

### Removed behavior

No prior accepted operation was removed. Native Excel and Aspose mutation remain unavailable and are never selected as fallback engines.

### Upgrade verification

Run:

```bash
npm run check
npm test
npm run test:excel       # controlled interactive Excel host
npm run test:native      # expected to fail qualification closed
npm run test:pi-modes
npm run pack:dry
```

Always inspect, dry-run, commit with `expectedSha256`, validate, diff, and render focused output after upgrading.
