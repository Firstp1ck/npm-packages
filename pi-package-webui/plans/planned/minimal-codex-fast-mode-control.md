# Minimal Codex Fast Mode Control

**Status:** Completed and verified  
**Classification:** Lightweight feature  
**Prepared:** 2026-07-31

## Classification rationale

Repository evidence confirms the preliminary lightweight classification: the request is one cohesive presentation change within the existing Codex Usage panel. It only reorders existing markup and tightens its styles/status copy; it does not change the Fast-mode API, state model, persistence, provider behavior, or security boundary. No complex-feature criterion is met.

## Success criteria

1. The existing Usage card renders before the Fast mode control.
2. Fast mode is a compact row containing its label, selector, and Apply button.
3. Normal status copy stays concise while busy, unavailable, and failure states remain visible.
4. Existing Fast-mode behavior and accessibility wiring remain unchanged.
5. Focused static checks, syntax checks, and whitespace validation pass.

## Scope and assumptions

- Change only `public/index.html`, `public/styles.css`, `public/app.js`, browser cache identifiers, and focused static assertions.
- Keep Normal/Fast options, explicit Apply behavior, tab scope, disabled/busy guards, and enable-time credit disclosure intact.
- No delegated work: this is one small UI write outcome, so direct parent implementation is safer than manufacturing multiple child outcomes.

## Validation

```bash
node tests/codex-fast-mode-static.test.mjs
node tests/mobile-static.test.mjs
node tests/boot-failure-diagnostics.test.mjs
node tests/open-issue-wizard-static.test.mjs
node --check public/app.js
node --check public/service-worker.js
git diff --check
```
