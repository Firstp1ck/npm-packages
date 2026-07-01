# Natural Conversation Mode Progress

Last updated: 2026-06-30
Owner/session: pi agent
Current milestone: Phase 2 — WebUI-only integration shell
Overall status: In progress

## Phase Status

| Phase | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| 0 — Decisions | In progress | pi agent | `docs/webui/natural-conversation/NATURAL_CONVERSATION_MODE_PLAN.md#14-recommended-initial-defaults` | Initial implementation follows recommended defaults; remaining provider/audio product questions stay open. |
| 1 — Standalone package/native command | Implemented; focused tests pass | pi agent | `pi-package-natural-conversation/`; `npm test --prefix pi-package-natural-conversation`; `npm run check --prefix pi-package-natural-conversation` | Standalone optional package owns `/talk`, `/voice`, and `/conversation`; safe-mode constraints are implemented without WebUI runtime imports. Live Pi TUI runtime test still pending. |
| 2 — Optional WebUI integration shell | Draft implemented; focused verification pending | pi agent | `pi-package-webui/bin/pi-webui.mjs`; `pi-package-webui/public/app.js`; `pi-package-webui/tests/http-endpoints-harness.test.mjs`; `pi-package-webui/tests/mobile-static.test.mjs` | WebUI shell uses RPC-visible `/talk` capability/status as source of truth, exposes per-tab controls, and blocks unsafe WebUI actions while active. Full WebUI checks still need to be run after latest edits. |
| 3 — WebUI browser STT/TTS | Not started |  |  | Browser capture/playback is intentionally deferred until the shell contract is verified. |
| 4 — Hosted/local fallbacks | Not started |  | `POST /api/stt/transcribe`; `POST /api/tts/speech` | Routes are placeholder-only and return 501 until provider/credential handling is designed. |
| 5 — Native full audio loop | Not started |  |  | Requires native audio/provider architecture decision. |

## Current Checklist

- [x] Create standalone package scaffold
- [x] Implement safe-mode controller and `/talk` command aliases
- [x] Run focused package tests
- [x] Review WebUI integration seam
- [x] Draft WebUI-only shell endpoints, guards, controls, docs, and tests
- [ ] Run focused WebUI checks
- [ ] Runtime-test standalone `/talk` in live Pi TUI and WebUI

## Decisions

- 2026-06-30 — Use package name `@firstpick/pi-package-natural-conversation` in directory `pi-package-natural-conversation` — Matches existing Firstpick package naming while preserving the plan's standalone package boundary — Evidence: `pi-package-natural-conversation/package.json`.
- 2026-06-30 — Use `/talk` with `/voice` and `/conversation` aliases — Matches recommended command defaults and native-first UX — Evidence: `pi-package-natural-conversation/extensions/natural-conversation.ts`.
- 2026-06-30 — Default allowed tools are `read`, `grep`, `find`, `ls` only — Safest nondestructive first slice; external/web tools can be added only after explicit decision — Evidence: `pi-package-natural-conversation/lib/conversation-controller.mjs`.
- 2026-06-30 — Native phase 1 is safety constraints only, not full audio — Avoids native audio/provider complexity before WebUI and provider architecture are reviewed — Evidence: `/talk setup` message in `pi-package-natural-conversation/extensions/natural-conversation.ts`.
- 2026-06-30 — WebUI does not import, load, or optionally depend on `@firstpick/pi-package-natural-conversation` — Keeps Natural Conversation standalone and package-owned — Evidence: `pi-package-webui/package.json`; `WEBUI_CONTROLLED_PACKAGES` excludes `naturalConversation`.
- 2026-06-30 — WebUI Natural Conversation availability is capability/status based — Uses RPC-visible `/talk`, `/voice`, `/conversation`, and `natural-conversation` status events instead of package-folder detection — Evidence: `naturalConversationFeatureData(tab)` and `rememberNaturalConversationCommands(tab)`.
- 2026-06-30 — WebUI mode state is tab-local and reset with the underlying Pi process — Prevents global/persisted mode leakage across sessions/tabs — Evidence: `tabMeta(tab).conversationMode`, `resetNaturalConversationMode(tab)` hooks.
- 2026-06-30 — WebUI STT/TTS endpoints remain explicit later-phase placeholders — Avoids implying hosted/local audio support before provider/credential decisions — Evidence: `/api/stt/transcribe` and `/api/tts/speech` return 501.

## Blockers / Open Items

- Runtime validation — Impacts Phase 1/2 confidence — Needed action: test `/talk on|off|status|setup` in live Pi TUI and through a real WebUI tab with the standalone package installed/loaded.
- Browser/audio provider setup — Impacts Phases 3–5 — Needed decision/action: confirm browser/API/local provider order, remote consent behavior, and credential handling.
- Full WebUI verification — Impacts Phase 2 completion — Needed action: run WebUI syntax checks and focused HTTP/static tests after the latest shell edits.

## Verification Log

- 2026-06-30 — Passed — `npm test --prefix pi-package-natural-conversation` — 7 tests passed.
- 2026-06-30 — Passed — `npm run check --prefix pi-package-natural-conversation` — package syntax/test check passed.
- 2026-06-30 — Passed (syntax only) — `node --check pi-package-webui/tests/fixtures/fake-pi.mjs`; `node --check pi-package-webui/tests/http-endpoints-harness.test.mjs`; `node --check pi-package-webui/tests/mobile-static.test.mjs`.
- 2026-06-30 — Pending — `node --check pi-package-webui/bin/pi-webui.mjs`; `node --check pi-package-webui/public/app.js`; `npm run check --prefix pi-package-webui`; focused WebUI test execution.
