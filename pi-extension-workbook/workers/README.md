# Workbook workers

`excel-native.ps1` is a **disabled feasibility worker**, not a public mutation backend. The registered workbook tools continue to select only `ooxml-safe`.

The worker enforces:

- interactive Windows only;
- `AutomationSecurity=ForceDisable` before opening targets;
- disabled events, link updates, alerts, and screen updating;
- manual calculation;
- source SHA-256 checks before and after;
- a new Excel PID resolved from `Application.Hwnd`;
- refusal when COM attaches to a pre-existing Excel process;
- PID/start-time-verified cleanup on cancellation or timeout.

It never edits certificate stores or Trust Center settings and never calls VBA execution, refresh, or `VBProject` APIs.

The bounded bakeoff rejected native mutation because `.xlsx` no-op serialization changed merged-cell styles and `.xlsm` no-op serialization changed `xl/vbaProject.bin`. See `docs/ADR-0001-primary-backend.md` and `tests/corpus/LAST-NATIVE-BAKEOFF.json`. Do not enable the worker without a new reviewed fidelity decision.
