# Natural Conversation Mode — Browser-Runtime Validation (2026-07-02)

Phase 3 checklist item: **"Browser-runtime test WebUI speech flow"**.

The WebUI voice conversation loop was exercised end-to-end in a real headless
Chrome against the real `pi-webui` server. Physical microphone/speaker hardware
cannot be exercised headlessly, so the Web Speech ENGINES were mocked at the
window boundary while everything between "transcript produced" and "utterance
requested" ran for real. **Real mic capture and real TTS playback remain manual
validation** (see "Remaining manual validation" below).

## Environment

| Component | Version / detail |
| --- | --- |
| Browser | Google Chrome 151.0.7896.2 dev (`/usr/bin/google-chrome-unstable`), headless "new" |
| Node | v22.23.1 |
| puppeteer-core | 25.3.0 (installed in an external scratch dir; not a package dependency) |
| Server | `bin/pi-webui.mjs --cwd <scratch> --host 127.0.0.1 --port <random> --pi tests/fixtures/fake-pi.mjs` |
| Fixture env | `PI_WEBUI_SETTINGS_FILE=<scratch>/webui-settings.json`, `FAKE_PI_VOICE_SCRIPTS=1`, `FAKE_PI_LOG_FILE=<scratch>/fake-pi-log-*.jsonl` |
| Driver | `dev/scripts/voice-browser-validation.mjs` |

## What was REAL vs what was MOCKED

**Real:** the browser engine (headless Chrome), the DOM, the served
`index.html`/`app.js`, the dynamically imported `public/voice-conversation.mjs`
controller, the SSE event stream (`/api/events`), the `pi-webui` HTTP server
(prompt/steer/conversation-mode routes, Natural Conversation safety
interceptors), and the JSONL RPC protocol to the child process.

**Mocked:**

- `window.SpeechRecognition` / `window.webkitSpeechRecognition` — headless
  Chrome has no microphone; a mock engine records `start/stop/abort` and lets
  the driver dispatch `onresult`/`onerror` events shaped like real Web Speech
  results.
- `window.speechSynthesis` + `SpeechSynthesisUtterance` — headless Chrome's
  native `speechSynthesis` exists but never fires utterance `onend`, which
  would deadlock the loop in "speaking"; the mock records spoken text and fires
  `onend` after 80 ms.
- Agent behavior — `tests/fixtures/fake-pi.mjs` (env-gated by
  `FAKE_PI_VOICE_SCRIPTS=1`) emits scripted `agent_start` / `message_start` /
  `message_update` / `message_end` / `tool_execution_start|end` / `agent_end`
  event flows for prompts containing `voice test say|question|tool|slow`, and
  appends the scripted assistant turns to the `get_messages` transcript so the
  real `handleVoiceConversationTurnEnd` → `refreshMessages` → speak path runs
  against real data. With `FAKE_PI_LOG_FILE` set, the fixture logs every
  received RPC command and every scripted event to a JSONL file so the driver
  can assert exact command ordering.

## Blocking bug found (FIXED same day — see resolution below)

`GET /voice-conversation.mjs` returns **HTTP 404**: the static allowlist in
`normalizeStaticPath()` (`bin/pi-webui.mjs`, ~line 4545) does not include
`voice-conversation.mjs`, so `app.js`'s dynamic import
`import("./voice-conversation.mjs?v=1")` fails with
`Failed to fetch dynamically imported module` and the browser voice loop never
starts (the chip shows the server-side "listening" state, but no recognition is
ever created). The service worker app shell (`public/service-worker.js` line 7)
even precaches `/voice-conversation.mjs`, so its `addAll` fails too. The Node
controller tests never caught this because they import the module from disk.

- Evidence: `/app.js` → 200, `/voice-conversation.mjs` → 404,
  `/service-worker.js` → 200 on the same running server; in-page event log
  showed `failed to load the voice conversation module: Failed to fetch
  dynamically imported module`.
- Suggested fix (not applied by the validation task itself; outside its file
  scope): add `"voice-conversation.mjs"` to the allowlist array in
  `normalizeStaticPath()`.
- Validation workaround used while the bug was present: the driver reports this
  as check **S0 (FAIL)** and then serves the real on-disk
  `public/voice-conversation.mjs` bytes for that one URL via puppeteer request
  interception; every other request hits the real server.
- **Resolution (2026-07-02):** the one-line allowlist fix was applied to
  `normalizeStaticPath()` in `bin/pi-webui.mjs`, and
  `tests/http-endpoints-harness.test.mjs` gained a regression assertion that
  `GET /voice-conversation.mjs` returns 200 with a JavaScript MIME type and
  byte-for-byte size match. A post-fix driver re-run passed **13/13 checks**
  with `voice module interception count: 0` — the real server served the
  module and the interception safety net was never used.

## Scenario results

Two consecutive full runs before the allowlist fix produced identical results:
**12/13 checks PASS**, with the only FAIL being S0 above (the pre-existing
server bug, not the voice loop logic). After the fix, a third full run passed
**13/13** with zero request interceptions. All 8 scenario groups passed in
every run.

| # | Scenario | Result | Key observations |
| --- | --- | --- | --- |
| S0 | Server serves `/voice-conversation.mjs` | FAIL pre-fix → **PASS post-fix** | HTTP 404 before the allowlist fix, HTTP 200 after; see "Blocking bug found" |
| S1 | Enable via options menu (real click path) | PASS | `#optionsConversationModeButton` visible+enabled after RPC command detection; after click: chip visible, `data-voice-state="listening"`, mock recognition `running=true, startCount=1`, end button visible. The real click path was used (no `/api/conversation-mode` fallback needed) |
| S2 | Transcript → prompt → spoken answer | PASS | Interim result → chip `transcribing` with partial preview `“voice test”`; final `"voice test say hello"` logged as RPC `prompt`; after scripted `agent_end` the mock TTS spoke exactly `"Okay, this is the spoken answer."`; chip back to `listening` after utterance `onend` |
| S3 | Question + silence event | PASS | Spoken text ends with `?`; after ~8 s of silence exactly one prompt starting `[Conversation mode: the user stayed silent for 8s` was logged; no second silence event within 3 further seconds |
| S4 | Interruption during tool phase queued | PASS | During the 1500 ms `read` tool window: no new prompt/steer in the RPC log, chip `interrupting`; queued text delivered only after `tool_execution_end` (log order verified), as `steer` `"[Voice interruption: …] wait stop that"` (streaming was still active when the queue flushed) |
| S5 | Interrupt during final-text streaming | PASS | ~800 ms into the ~2.5 s scripted stream, final transcript produced RPC `steer` containing `[Voice interruption:` and `actually never mind`, logged before the flow's `agent_end` |
| S6 | Pause/resume via chip click | PASS | Click → `data-voice-state="paused"`, recognition aborted (`running=false`); a final transcript emitted while paused produced zero new prompt/steer log entries; second click → `listening`, recognition restarted (startCount incremented) |
| S7 | Mic denied (`not-allowed`) | PASS | Chip `data-voice-state="error"`; recognition not auto-restarted (running stayed false, startCount unchanged after 600 ms); `#eventLog` shows "Microphone access was denied…" |
| S8 | End conversation | PASS | `#conversationModeEndButton` click → RPC `prompt` `"/talk off"` logged (server-side `/api/conversation-mode` disable path); chip and end button hidden; recognition stopped |

Recorded S4 sequencing detail: the queued interruption flushed on
`tool_execution_end` as a `steer` (client `isStreaming` was still true), and the
scripted `agent_end` that follows unconditionally in the fixture then caused the
fetched assistant answer `"The tool has finished."` to be spoken after the
flush. With a real Pi, the steer would extend the same agent run, so `agent_end`
(and speech) would only arrive after the steered answer; the fixture cannot
model that continuation.

Automation note (not a bug): the options menu panel stays open while focus
remains inside it (`.composer-publish-menu:focus-within` keeps it visible by
design, matching hover-menus). The driver clicks a neutral chat area after
enabling — as a real user would — otherwise the focused panel sits above the
conversation chip and swallows its clicks.

Excerpt of the ordered RPC command log (run 5, noise like `get_state` elided):

```
prompt  "/talk on"
prompt  "voice test say hello"
prompt  "voice test question please"
prompt  "[Conversation mode: the user stayed silent for 8s after your question. …]"
prompt  "voice test tool run"
steer   "[Voice interruption: the user started speaking over the current answer.] wait stop that"
prompt  "voice test slow start"
steer   "[Voice interruption: the user started speaking over the current answer.] actually never mind"
prompt  "/talk off"
```

One screenshot per scenario group was captured into the (uncommitted) scratch
run directories for spot-checking; they are not part of the repository.

## Regression safety

- `node --check` passes for the extended fixture and the driver.
- `npm run check` (all 11 test files) passed after the fixture extension and
  again after the browser runs. The fixture's new behaviors are dormant unless
  `FAKE_PI_VOICE_SCRIPTS=1` / `FAKE_PI_LOG_FILE` are set, because
  `tests/http-endpoints-harness.test.mjs` asserts an exact 3-message transcript.
  (An unrelated intermittent git-worktree failure in
  `http-endpoints-harness.test.mjs` observed during these runs was later
  root-caused to a pre-existing child-process stdout race in the server's
  `runCommand()` helpers — resolved on `exit` before pipes flushed — and fixed
  the same day by resolving on `close`; see the progress file's 2026-07-02
  verification log.)

## How to rerun

```sh
# one-time: puppeteer-core outside the package (no new package dependencies)
mkdir -p /tmp/pptr-env && cd /tmp/pptr-env && npm init -y && npm install puppeteer-core

cd <repo>/pi-package-webui
PI_WEBUI_PUPPETEER_DIR=/tmp/pptr-env \
PI_WEBUI_CHROME=/usr/bin/google-chrome-unstable \
node dev/scripts/voice-browser-validation.mjs
```

Optional: `VOICE_VALIDATION_WORK_DIR=<dir>` pins the work dir (server cwd,
settings file, RPC command log, screenshots, `voice-browser-validation-results.json`);
otherwise a fresh temp dir is created. The driver starts and stops its own
server and browser, prints one PASS/FAIL line per check, and exits non-zero if
any check fails (exits 0 as of the S0 allowlist fix).

## Remaining manual validation (real hardware required)

- Real microphone capture quality and the browser's actual `SpeechRecognition`
  engine behavior (including Chrome's server-side STT availability, language
  handling, spontaneous engine restarts under real silence).
- Real TTS voices: voice selection, prosody, rate, and actual audio output.
- Echo behavior: whether the microphone picks up the machine's own TTS output
  (barge-in is disabled by default; only real speakers/mics can validate this).
- Device permission UX on real hardware (browser permission prompt flow versus
  the scripted `not-allowed` error path validated here).
- Remote (non-localhost) sessions: the remote-mic consent disclosure flow with
  a real device.
- Mobile browsers / PWA (the service worker precache of
  `/voice-conversation.mjs` is unblocked by the S0 fix but has not been
  exercised on a real device).
