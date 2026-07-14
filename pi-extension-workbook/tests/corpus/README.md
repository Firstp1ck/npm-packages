# Workbook fidelity corpus

The ordinary test suite generates bounded `.xlsx` and synthetic `.xlsm` packages in temporary directories. Synthetic macro bytes are used only to test relationship/content-type discovery and byte-identity gates; they are not claimed to be Excel-executable VBA projects.

Run the controlled interactive Windows/Excel checks separately:

```bash
npm run test:excel
npm run test:native
```

That check:

1. Generates source and edited `.xlsx` files.
2. Attempts to generate a real `.xlsm` through installed desktop Excel without changing Trust Center settings.
3. Inserts a harmless `Workbook_Open` sentinel that only changes `Sentinel!XFD1048576` in memory if macros execute.
4. Reopens all generated files read-only with `AutomationSecurity=ForceDisable`, events disabled, link updates disabled, and manual calculation.
5. Fails if a workbook cannot open, a sentinel executes, or a source hash changes.

`LAST-EXCEL-HOST-REPORT.json` records the most recent controlled-host result. `LAST-NATIVE-BAKEOFF.json` records native no-op/edit package diffs, VBA-part hashes, macro nonexecution, source immutability, and worker-owned Excel timeout cleanup. Native mutation remains disabled regardless of a bounded bakeoff pass until the full P0 corpus and repair-dialog gate pass. Macro generation may be reported as `SKIP` when programmatic VBA-project access is not already trusted. The locally generated rich corpus now covers ActiveX, form controls, an OLE embedding, a custom ribbon, pivots, charts, tables, images, hidden sheets, protection, external-link/connection sentinels, and unsigned VBA without changing Trust Center or certificate-store settings.

Signed VBA remains an external legal-fixture gate and must not be fabricated or marked complete. Validate a user-supplied fixture without redistributing it:

```bash
npm run test:signed-vba -- C:\\path\\to\\legally-sourced-signed.xlsm
# or set PI_WORKBOOK_SIGNED_XLSM_FIXTURE
```

The harness requires an actual signature part, performs no-op and bounded-edit integrity checks, verifies protected-part hashes and source immutability, and uses the UI-aware Excel repair-dialog monitor on controlled interactive Windows. It never creates/imports certificates or changes Trust Center settings. Evidence is written to `LAST-SIGNED-VBA-REPORT.json`; a run without a fixture reports `SKIP` rather than claiming coverage.
