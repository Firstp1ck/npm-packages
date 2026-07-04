# Natural Conversation Mode — Phase 5 Native Audio Companion Design

Status: Proposed design - not implemented
Date: 2026-07-02
Sources: three-lens design panel (Lens A: local-first minimalist shipping; Lens B: robustness & latency; Lens C: integration, UX & safety), judged and merged against the plan (`NATURAL_CONVERSATION_MODE_PLAN.md` §6.6, §7, §8, §9 Phase 5), the shipped controller (`pi-package-natural-conversation/lib/conversation-controller.mjs`), the shipped extension (`extensions/natural-conversation.ts`), the Phase-4 WebUI provider routes (`pi-package-webui/bin/pi-webui.mjs`), and the Pi extension API in `node_modules/@earendil-works/pi-coding-agent` (`dist/core/extensions/types.d.ts`, `docs/extensions.md`, `docs/keybindings.md`) plus `@earendil-works/pi-tui` (`dist/keys.d.ts`, `SettingsList` export). Every API claim below was re-verified against those files on 2026-07-02; anything not verifiable is marked **needs verification** and listed in §15.

## 1. Goals

- A package-owned, opt-in native full audio loop for the Pi TUI: mic capture → VAD/turn detection → STT → prompt dispatch → TTS playback (plan §9 Phase 5).
- Zero weakening of the safety controller: thinking stays forced off, tools stay limited to `read, grep, find, ls`, `tool_call`/`user_bash` guards unchanged.
- Provable "no orphan microphone": no capture process may outlive the Pi session or safe mode, under any crash mode.
- Privacy-default: audio never leaves the machine unless the user explicitly configures and consents to a remote/hosted provider; no silent local→hosted fallback, ever.
- First slice that produces real sound on this machine class with nothing installed beyond an STT server (espeak-ng TTS floor is already present).

## 2. Non-goals

- Adaptive acoustic echo cancellation (AEC) in-process. Half-duplex + opt-in strategies cover v1 (§7).
- Streaming/token-level TTS and streaming STT partials in the first slices (deferred to 5c/5d).
- Bundling or spawning GPL Piper code, auto-installing models or servers (plan §8: never without explicit confirmation).
- WebUI involvement. WebUI never imports this package (decision 2026-06-30); the companion is native-TUI-only.
- Cross-session or daemonized audio sharing; the companion's lifetime equals the enabling Pi process's lifetime (plan §6.2 per-process memory).

## 3. Chosen architecture and rationale

**Skeleton: Lens C** — a package-shipped **companion child process** supervised by a thin extension-side orchestrator, speaking JSONL over stdio, reusing the Phase-4 local provider HTTP contracts, with the existing conversation controller as the untouched safety authority. Grafts: Lens A's espeak-ng TTS floor, concrete VAD/calibration numbers, test seams, and consent tiers; Lens B's dead-man switch, watchdogs, latency instrumentation, backpressure rules, and barge-in roadmap. The full decision-by-decision record is in §13.

```text
┌─ Pi TUI process ─────────────────────────────────────────────────────┐
│ extensions/natural-conversation.ts                                   │
│   ├─ lib/conversation-controller.mjs   (safety authority, UNCHANGED  │
│   │     in 5a; gains handleConversationSilence in 5b per plan §6.2)  │
│   └─ lib/native-audio-loop.mjs  (NEW orchestrator: spawn/supervise,  │
│        JSONL client, turn-taking state machine, uiState mapping,     │
│        dispatch via pi.sendUserMessage / ctx.abort)                  │
│           │ stdin/stdout JSONL — text only, audio never crosses      │
└───────────┼──────────────────────────────────────────────────────────┘
┌───────────▼─ companion child process (own process group) ────────────┐
│ lib/native-audio-companion.mjs (entry) + lib/native-audio/*.mjs      │
│   ├─ capture chain:  pw-record → parecord → arecord → ffmpeg         │
│   │     (raw s16le 16 kHz mono on stdout, ring-buffered)             │
│   ├─ vad.mjs        (pure frame state machine, unit-testable)        │
│   ├─ wav.mjs        (44-byte header encode, zero-dep)                │
│   ├─ STT adapter:   Phase-4 local-endpoint contract (multipart WAV   │
│   │     → {text}) — whisper.cpp whisper-server fits                  │
│   ├─ TTS adapters:  Phase-4 local-endpoint (JSON {text} → audio)     │
│   │     with espeak-ng --stdout as zero-server floor                 │
│   └─ playback chain: pw-play → paplay → aplay → ffplay               │
└──────────────────────────────────────────────────────────────────────┘
User-managed, never spawned by us:  whisper-server -m model --port 8178
                                    Piper HTTP wrapper on :8179
```

Why a companion process and not Lens A's in-extension loop:

1. **Crash isolation.** The Pi process owns the safety restore path (`disable()` restores previous tools/thinking from in-memory state). A wedged capture pipe, provider hang, or future ONNX binding must degrade to "voice paused", never to a lost session.
2. **One kill choke point.** A single child in its own process group makes "no orphan mic" a group-kill plus a dead-man switch (§4), instead of relying on SIGPIPE physics of individual grandchildren (Lens A's argument was plausible but not guaranteed — capture tools may ignore write errors).
3. **Event-loop hygiene.** Energy VAD is cheap, but the 5b Silero upgrade path (ONNX inference every 32 ms) is not; keeping frame-rate work off the TUI event loop keeps that upgrade a companion-internal change.
4. **Not a daemon.** It is a plain `.mjs` file in this package run with `process.execPath`; same Node ≥ 22 Pi already requires (v22.23.1 verified here); uninstall leaves nothing behind but `voice.json`. Lens A's "easy uninstall" property is preserved.

Cost accepted (from Lens A's critique): a versioned protocol and supervision code that an in-process loop would not need. The protocol is deliberately small (§5) and the companion has zero Pi API access, so the added surface is bounded.

New files: `lib/native-audio-loop.mjs` (extension side), `lib/native-audio-companion.mjs` (companion entry), `lib/native-audio/{capture,vad,wav,playback}.mjs`, `lib/providers/{stt-local-endpoint,tts-local-endpoint,tts-espeak}.mjs`, `lib/voice-config.mjs`. `lib/conversation-controller.mjs` is not modified in 5a.

## 4. Process model and lifecycle

- **No factory-time resources.** Verified rule (`docs/extensions.md` "Long-lived resources and shutdown"): never start processes/timers from the extension factory; start from a command handler or `session_start`, with an idempotent `session_shutdown` cleanup. The companion starts only from `/talk` command handlers.
- `/talk on` keeps Phase-1 behavior exactly. If `voice.json` has `native.enabled: true` and `native.autoStartWithTalkOn: true`, it additionally starts the companion; otherwise it notifies `Native audio not configured; run /talk setup.`
- `/talk audio on|off` starts/stops only the audio loop. **Hard invariant:** the orchestrator refuses to spawn unless `controller.isEnabled()` is true — no mic outside safe mode. `/talk off` tears the companion down *before* `controller.disable()` restores tools/thinking.
- Spawn: `child_process.spawn(process.execPath, [companionPath], { stdio: ["pipe","pipe","pipe"], detached: true })`. `detached: true` gives the companion its own process group so the extension can `process.kill(-child.pid, "SIGKILL")` as a last resort, taking capture/playback grandchildren with it. (Node built-ins are available to extensions — verified `docs/extensions.md` line 151; `pi.exec` is buffered run-to-completion, verified `types.d.ts`, so it is used only for probes like `which`/`pactl`, never for the companion.)
- Handshake: orchestrator waits ≤ 3 s for `hello`; on timeout → SIGKILL group, `uiState: "error"`, notify with stage.

**No-orphan-mic — triple guarantee (Lens B/C merged):**

1. *Graceful:* on `session_shutdown` / `/talk audio off` / `disable()`: send `{type:"shutdown"}` → wait 1000 ms for `bye`+exit → close stdin → 500 ms → SIGTERM group → 1000 ms → SIGKILL group. Plus a `process.on("exit")` best-effort synchronous group-kill.
2. *Dead-man switch:* the companion watches its stdin for EOF/error — guaranteed when the Pi process dies, however it dies — and SIGKILLs its own children and exits within 250 ms. Portable equivalent of PDEATHSIG; no native code.
3. *Stale sweep:* companion writes `$XDG_RUNTIME_DIR/pi-voice/<pid>.pid`; `/talk audio on` and `/talk doctor` sweep stale pidfiles, verifying `/proc/<pid>/cmdline` contains the companion path before SIGTERM, so a previous hard-kill never leaves a recorder running.

Additionally, `/talk pause` (and `paused` state generally, except transient TTS gating) **stops the capture child entirely**, not just frame-discarding — "paused" provably means "no mic process" (Lens A).

**Supervision.** Extension side: unexpected companion exit → restart with backoff 500 ms → 2 s → 8 s; >3 unexpected exits in 60 s → give up: `uiState:"error"`, notify with the stderr ring buffer's last line, **safe mode stays on** (a dead audio loop must never widen tool access — degradation target is Phase-1 safe mode, never unconstrained). Companion side: supervises its own children; capture exit or a watchdog (no PCM for 2 s while gate open) → restart capture chain with backoff, emitting `device_event` so the footer can show a transient `Voice: paused`. 3 consecutive STT failures → recoverable `error` + `paused`; TTS failure → degrade down the chain (local-endpoint → espeak-ng → text-only notice) and keep looping.

Capture/playback fallback chains (all verified present on this machine; probed with `which` at start, first hit wins; `voice.json` can pin explicit argv arrays — also the test seam, §12):

```text
capture:  pw-record --rate 16000 --channels 1 --format s16 -
        → parecord --raw --rate=16000 --channels=1 --format=s16le
        → arecord -q -f S16_LE -r 16000 -c 1 -t raw -
        → ffmpeg -hide_banner -loglevel error -f pulse -i default -ac 1 -ar 16000 -f s16le -
playback: pw-play --rate <r> --channels 1 --format s16 --raw -
        → paplay --raw --rate=<r> --channels=1 --format=s16le
        → aplay -q -f S16_LE -r <r> -c 1 -t raw -
        → ffplay -f s16le -ar <r> -nodisp -autoexit -loglevel error -
```

macOS (`ffmpeg -f avfoundation`, `afplay`) and Windows (`ffmpeg -f dshow`) chain entries are documented but **needs verification**; Linux/PipeWire is the supported target for 5a–5c.

## 5. Extension ↔ companion protocol

Transport: JSONL over stdio (one JSON object per newline; companion stdout → extension, extension stdin → companion; stderr reserved for crash traces, captured to a ring buffer surfaced by `/talk status`). **Local HTTP was explicitly rejected** (Lens C): a localhost port is an authz surface for a mic-controlling endpoint, stdio gives lifecycle coupling for free, and nothing else ever needs to reach the companion. Audio bytes never cross the pipe.

Versioning: `hello`/`ready` handshake carries `protocolVersion: 1`; mismatched major → shut down + `error` state with upgrade hint. Unknown message types and fields are ignored (additive-only within a major).

Extension → companion:

```jsonc
{"type":"hello","protocolVersion":1,"config":{ /* resolved native.* of voice.json + env overrides */ }}
{"type":"gate","mode":"open"}              // open | interrupt_only | barge_in | closed
{"type":"pause","reason":"user"}           // stops capture child (user|consent); gate handles tts/tool
{"type":"listen"}                          // (re)start capture after pause
{"type":"speak","id":"s42","text":"First sentence of the answer."}
{"type":"cancel-speak","id":"s42"}         // omit id = flush entire queue
{"type":"set-config","patch":{"vad":{"hangoverMs":600}}}
{"type":"probe","id":"p1","target":"mic"}  // mic | speaker | stt | tts   (setup/doctor)
{"type":"shutdown"}
```

Companion → extension:

```jsonc
{"type":"ready","protocolVersion":1,"pid":12345,"capture":{"tool":"pw-record"},
 "playback":{"tool":"pw-play"},"stt":{"provider":"local-endpoint"},"tts":{"provider":"espeak-ng"}}
{"type":"state","state":"listening"}       // capture-level: idle|listening|capturing|transcribing|speaking
{"type":"level","rmsDb":-42.5}             // ≤ 4 Hz, for setup meter only
{"type":"vad","event":"speech_start"}      // and "speech_end"
{"type":"final-transcript","text":"how does the controller work","utteranceMs":2140,"sttMs":420,
 "capturedDuring":"listening"}             // "speaking" ⇒ barge-in path (5c)
{"type":"partial-transcript","text":"how does the"}   // reserved for streaming STT (5d)
{"type":"speak-started","id":"s42"} 
{"type":"speak-ended","id":"s42","cancelled":false}
{"type":"metrics","turn":{"endpointMs":800,"sttMs":420,"ttsFirstAudioMs":210}}
{"type":"device_event","kind":"capture_restarted","attempt":1}
{"type":"error","code":"stt-unavailable","message":"local STT 503","fatal":false}
{"type":"probe-result","id":"p1","target":"mic","ok":true,"detail":"pw-record, peak -21 dBFS"}
{"type":"bye"}
```

Rules: every `speak` gets exactly one `speak-ended`; `error.fatal:true` means the companion exits after sending it; companion logs (stderr and `metrics`) never contain transcript text (§11).

## 6. Turn-taking state machine (mapped to existing uiState values)

The orchestrator is the only writer of `controller.setUiState(state, ctx)` while audio runs; the companion only reports capture-level facts. The nine shipped values (`conversation-controller.mjs` cloneState/`uiState`, plan §6.2) are used unchanged — the footer `Voice: <state>` rendering needs no modification.

| uiState | Entered when | Companion gate | Exits to |
|---|---|---|---|
| `off` | loop stopped / `/talk audio off` / `/talk off` | (companion stopped) | `listening` on start |
| `listening` | companion capturing, VAD armed, agent idle | `open` | `transcribing`, `silence`, `paused`, `error`, `off` |
| `transcribing` | `vad speech_end` → STT in flight | `closed` | `answering` (dispatched), `listening` (empty/failed transcript dropped silently) |
| `answering` | transcript dispatched; `agent_start`..`agent_end` | tool phase: `closed`; final-text streaming: `interrupt_only` | `speaking`, `interrupting`, `error` |
| `speaking` | first `speak` after `agent_end` until last `speak-ended` | `closed` (half-duplex default); `barge_in` when enabled (5b/5c) | `listening`, `interrupting` |
| `interrupting` | `handleConversationInterrupt` accepted a transcript | `closed` until dispatch settles | `answering` |
| `silence` | silence timer fired after an assistant question (5b) | `open` | `answering` (event sent) |
| `paused` | `/talk pause`, hotkey, device lost, missing consent | capture child stopped | `listening` on `/talk resume` / `/talk audio on` |
| `error` | fatal companion error / restart budget exhausted | (stopped) | `listening` via `/talk audio on`; safe mode stays on |

Dispatch maps onto **verified** Pi primitives:

- **Idle turn:** `final-transcript` while `ctx.isIdle()` → `pi.sendUserMessage(text)`. Verified: always triggers a turn, and the `input` event fires for `source:"extension"` messages, so the existing `ensureConversationConstraints` re-applies thinking/tools before the turn — no new safety path. Verified caveat: `sendUserMessage` **throws** if the agent is streaming and no `deliverAs` is given; the orchestrator therefore always resolves streaming state before dispatch and passes `deliverAs` when not idle.
- **Interrupt during tool phase** (tracked via `tool_execution_start`/`tool_execution_end`): `controller.handleConversationInterrupt(text, {toolPhaseActive:true})` → `"queue-after-tool"` → `pi.sendUserMessage(text, {deliverAs:"steer"})`. Verified docs: steer is "delivered after the current assistant turn finishes executing its tool calls, before the next LLM call" — exactly the plan's queue-until-tool-ends rule. Footer: `Voice: interrupting` plus a `will interrupt after tool finishes` notice. (Lens A's `deliverAs:"followUp"` mapping was rejected: followUp waits for the agent to finish *all* tools — too late; see §13.)
- **Interrupt during final-text streaming:** `handleConversationInterrupt(text, {toolPhaseActive:false})` → `"new-turn"` → `ctx.abort()` then `pi.sendUserMessage("[Interrupted the previous answer] " + text)`. `ctx.abort()` is verified to exist on `ExtensionContext` ("Abort the current agent operation"), but abort-then-immediately-send ordering, and calling it from a ctx cached outside the originating handler, are **needs verification** (§15); the fallback is `deliverAs:"steer"` without abort — plan-compliant, just slower.
- **Backpressure (Lens B):** transcripts arriving while `answering` are coalesced (newline-joined) into at most one pending steer message, hard cap 3 utterances; on overflow drop the oldest with a warning notify. The TTS sentence queue is flushed wholesale on any new user turn or barge-in.
- **Silence (5b):** after the last `speak-ended` of an answer whose final sentence ends with `?` (same heuristic as `voice-conversation.mjs`), arm one `silenceTimeoutMs` (default 8000) timer; if no `speech_start` before expiry, set `uiState:"silence"` and `pi.sendUserMessage` the **exact** WebUI wording (verified at `voice-conversation.mjs:33`): `[Conversation mode: the user stayed silent for 8s after your question. Treat the silence as possible confusion, discomfort, missing context, or an unneeded question; reframe, explain why you asked, or continue without pressuring the user. Do not invent intent from the silence.]` One event per question. The arming/one-shot logic lands in the controller as `handleConversationSilence` — plan §6.2 promises it and it is currently absent from the shipped controller (verified), so 5b completes that contract for both loops rather than duplicating it in the companion.
- **Speak trigger:** on `agent_end`, take final assistant text only (tool cards never spoken), strip markdown, replace fenced code blocks with "code block omitted", split into sentence chunks (min 60 chars), `speak` sequentially — first sentence plays while later ones synthesize (Lens B latency win without token-streaming TTS).

## 7. VAD and echo strategy

Common frame pipeline: 16 kHz mono s16le, **512-sample (32 ms) frames** — chosen over Lens A/C's 480-sample frames because Silero v5 requires 512-sample frames at 16 kHz, keeping the 5b upgrade a drop-in (§13). Per frame: RMS → dBFS.

**Tier-0 (5a) energy VAD** (pure function in `lib/native-audio/vad.mjs`):

- Adaptive noise floor: EMA of non-speech frame RMS (α = 0.05), clamped to [−70, −30] dBFS; `/talk setup` calibration (1.5 s silence median + 12 dB, clamped [−55, −25]) seeds it (Lens A).
- Speech start: 3 consecutive frames (~96 ms) above `floor + startDb` (default 9 dB).
- Pre-roll: 300 ms ring buffer prepended so onsets are not clipped.
- Endpoint: 800 ms hangover below `floor + 3 dB` (asymmetric enter/exit hysteresis).
- Guards: min utterance 300 ms (discard clicks/coughs without an STT call); max 30 s forced endpoint (~960 KB cap); empty/near-empty transcripts drop silently back to `listening`.
- All parameters in `voice.json` `native.vad`, live-patchable via `set-config` for `/talk doctor` tuning.

**Honest limits (Lens A):** energy VAD confuses typing, fans, and music with speech and misses whispers. Mitigations: calibration, min-utterance and empty-transcript filters, visible `Voice:` footer state, one-command pause, optional push-to-talk hotkey. **Tier-1 (5b, optional):** Silero VAD v5 via `onnxruntime-node` as an `optionalDependency` plus a ~2 MB model downloaded only after explicit confirm in setup; enter 0.5 / exit 0.35 probability hysteresis; graceful fallback to tier-0 if ONNX is missing (one-time warning, never blocks). Dependency weight/licensing acceptance is an open question (§15).

**Echo strategy — half-duplex by default, escalating opt-ins:**

1. **5a default:** gate `closed` during `speaking` + 250 ms tail guard after `speak-ended`. Capture frames are read and discarded (device stays warm) except in `paused`, which kills the capture child. Zero echo risk, zero complexity.
2. **5b, `native.headphones: true`:** user asserts headphones in setup → voice barge-in during `speaking` with the plain VAD (headphones remove acoustic echo). Cheap, honest (Lens A).
3. **5c, `native.bargeIn.enabled` for speaker users:** Lens B's **duck-and-verify** — raised threshold (Silero prob ≥ 0.85 sustained ~320 ms, or `floor + startDb + 6 dB` sustained 250 ms on tier-0), mic RMS compared against the delayed playback envelope (α calibrated during the setup speaker test), then *duck* playback (stop writing to the player's stdin), run STT, and apply a self-transcript filter: token overlap ≥ 0.6 with the last ~15 TTS words ⇒ classify as echo and resume; otherwise kill playback (`speak-ended{cancelled:true}`) and route through the interrupt path. False positives cost ~1 s of paused audio, never a lost interruption.
4. **Documented, not built:** PipeWire `module-echo-cancel` as an opt-in system-level setup step with the echo-cancelled source pinned as `captureDevice` — **needs verification** per system.

Universal controls regardless of tier: `/talk pause|resume`, `/talk audio off`, and an optional push-to-talk/stop-speaking hotkey via `pi.registerShortcut` — **default unbound**, chosen in setup, because the panel's proposed `ctrl+t` collides with Pi's default `app.thinking.toggle` binding (verified in `core/keybindings.js`); the KeyId string format itself (`"ctrl+…"`) is verified valid.

## 8. Provider adapters and first-slice choices

Adapter interfaces (companion-side; duck-typed `.mjs`, mirrors the plan §6.3 abstraction):

```js
export const sttAdapter = {
  id: "local-endpoint",                       // 5c adds: "groq" | "openai"; 5d: "vosk-socket"
  probe({ signal }) {},                       // → { ok, detail }
  transcribe(wavBuffer, { language, signal }) {},   // → { text }
};
export const ttsAdapter = {
  id: "local-endpoint",                       // plus "espeak-ng"; 5c adds "openai"
  probe({ signal }) {},
  synthesize(text, { voice, signal }) {},     // → { format: "wav"|"raw-s16le", sampleRateHz, stream }
};
```

**First slice (5a) providers — the integration-lens payoff, verified against `pi-webui.mjs`:**

- **STT `local-endpoint`:** utterance PCM → in-memory 44-byte WAV wrap → `POST ${PI_VOICE_STT_URL}` as multipart with `file` (+ optional `model`, `language`) → tolerant `{text|transcript|…}` parse — byte-identical to the Phase-4 `voiceFormData()`/`parseTranscriptResponse()` contract WebUI fallbacks already use. whisper.cpp's `whisper-server --host 127.0.0.1 --port 8178` fits this shape; exact `/inference` field/response drift across whisper.cpp versions is **needs verification** — setup's live round-trip is the compatibility check, never a static assumption.
- **TTS `local-endpoint`:** `POST ${PI_VOICE_TTS_URL}` JSON `{text, voice?, format:"wav"}` → audio bytes (or JSON `audioBase64`) — the Phase-4 `synthesizeWithLocalProvider()` contract. A Piper HTTP wrapper fits; whether OHF Piper's built-in HTTP server accepts this JSON shape natively or needs a documented thin wrapper is **needs verification**.
- **TTS floor `espeak-ng`:** `espeak-ng --stdout -s 170 -v <voice> "<chunk>"` → WAV on stdout → playback chain. Verified present on this machine; zero servers, so `/talk audio on` produces sound with nothing installed. Honestly labeled "robotic fallback" in setup. Degradation order: `local-endpoint` → `espeak-ng` → text-only notice.

All HTTP uses `fetch` + `AbortSignal.timeout` (STT 30 s, TTS 20 s, probes 5 s); `cancel-speak` aborts in-flight synthesis and stops the player. Audio moves: capture stdout → ring buffer → utterance Buffer (memory only) → STT; TTS stream → player stdin (raw) or a mode-0600 temp WAV under `$XDG_RUNTIME_DIR/pi-voice/` unlinked in `finally`. **Hosted adapters (Groq/OpenAI, reusing the Phase-4 request shapes) are deferred to 5c** and are constructable only when the env key exists AND recorded consent exists (§11) — never a fallback target. Streaming STT (Vosk over WebSocket; Node 22's global WebSocket keeps it dependency-free) is 5d, already reserved in the protocol as `partial-transcript`.

Latency budget (p50 targets, instrumented per stage via `metrics`, shown by `/talk status` — Lens B): VAD decision ≤ 40 ms; endpoint hangover 800 ms (deliberate); STT ≤ 800 ms (whisper.cpp base.en CPU, utterance ≤ 8 s); dispatch ≤ 10 ms; TTS first audio ≤ 300 ms local / ≤ 50 ms espeak-ng; **mouth-to-ear excluding the model ≤ 2.0 s p50**, regression-checked with loopback fixtures.

## 9. Configuration: voice.json schema and env vars

`~/.pi/agent/voice.json` (plan §8 location; non-secret only; written atomically write-temp-then-rename, `chmod 600`, by `/talk setup`; validated by `lib/voice-config.mjs` — unknown keys warn, invalid values fall back to defaults with a notify, unknown `version` refuses):

```jsonc
{
  "version": 1,
  "native": {
    "enabled": false,                      // master opt-in; written only after the consent summary
    "autoStartWithTalkOn": true,
    "capture":  { "tool": "auto", "command": null, "device": null, "sampleRateHz": 16000 },
    "playback": { "tool": "auto", "command": null, "device": null },
    "vad": { "startDb": 9, "thresholdDb": null, "hangoverMs": 800, "minSpeechMs": 300,
             "maxUtteranceMs": 30000, "preRollMs": 300, "engine": "auto" },
    "stt": { "provider": "local-endpoint", "language": "auto", "timeoutMs": 30000 },
    "tts": { "provider": "local-endpoint", "voice": null, "rate": 1.0, "fallback": "espeak-ng" },
    "headphones": false,                   // 5b: unlocks voice barge-in during speaking
    "bargeIn": { "enabled": false, "selfEchoOverlap": 0.6 },   // 5c duck-and-verify
    "silence": { "enabled": true, "timeoutMs": 8000 },
    "allowRemoteProviders": false          // required before any non-loopback STT/TTS URL is used
  },
  "consent": { "nativeAudioAcceptedAt": null, "hostedSttAcceptedAt": null, "hostedTtsAcceptedAt": null }
}
```

Env vars (names identical to Phase 4, verified in `pi-webui.mjs`): `PI_VOICE_STT_URL`, `PI_VOICE_TTS_URL` (env wins over voice.json); secrets env-only — `GROQ_API_KEY`, `OPENAI_API_KEY` (unused until 5c hosted adapters). Debug: `PI_VOICE_DEBUG=1` logs state transitions, frame dB, and stage latencies only; `PI_VOICE_DEBUG_TRANSCRIPTS=1` is a separate explicit opt-in for content logging. voice.json never contains secrets.

## 10. /talk setup and diagnostics UX (native TUI)

Replaces the Phase-1 static notify at `extensions/natural-conversation.ts:43-54`. Core wizard is built from `ctx.ui.select` / `confirm` / `input` / `notify` — all verified on `ExtensionUIContext` and dialog-capable in both TUI and RPC (`hasUI` true for both), so the wizard degrades gracefully under RPC; a `ctx.ui.custom()` + `SettingsList` page (verified: exported by `@earendil-works/pi-tui`, pattern in `examples/extensions/tools.ts`) is a TUI-only cosmetic upgrade in 5b.

Steps (each skippable; each records evidence into the final summary):

1. **Environment probe** — `pi.exec("which", …)` across both chains; device list via `wpctl status`/`pactl list short sources` when present; stale pidfile sweep; pass/fail table.
2. **STT provider** — `local-endpoint (recommended, private)` / `custom URL` / `skip`; default `http://127.0.0.1:8178/inference`; health = live round-trip of a bundled 1 s fixture WAV, 5 s timeout; on failure show the exact `whisper-server` start command (never auto-install, plan §8).
3. **TTS provider** — `local-endpoint (Piper wrapper, private)` / `espeak-ng (works now, robotic)` / `custom URL`; health = synthesize "Pi voice check", hold for step 5.
4. **Mic test + calibration** — record 1.5 s silence (noise floor → threshold seed), then 3 s speech with a live level meter via `ctx.ui.setStatus`; transcribe; confirm the transcript matches.
5. **Speaker test** — play a generated 440 Hz tone (no TTS dependency) then step 3's phrase; confirm audible. (5c: also calibrates the barge-in envelope coefficient.)
6. **Options** — headphones? silence timeout? optional hotkey chord (default unbound)?
7. **Consent summary** — states what is captured, that audio is processed only by the listed local URLs, that nothing is stored, and how to stop (`/talk pause`, hotkey, `/talk audio off`, `/talk off`); on confirm, writes voice.json with `native.enabled: true` and `consent.nativeAudioAcceptedAt`.

Diagnostics: `/talk doctor [mic|speaker|stt|tts]` re-runs probes through a short-lived companion and prints a table (tool + peak level, provider round-trip ms). `/talk status` gains: companion pid/uptime, capture tool + device, VAD engine, provider URLs (sanitized like Phase 4's `safeVoiceEndpointLabel`), last-turn stage latencies, last error. While capture is armed, a persistent widget (`ctx.ui.setWidget`) mirrors the WebUI chip: `● Voice listening — mic: pw-record — stt: local — /talk audio off to stop`, alongside the existing footer `Voice: <state>`.

## 11. Safety and privacy rules

- **Controller supremacy (non-negotiable, Lens C):** the companion has zero Pi API access — it cannot name tools, change thinking, or dispatch prompts. Every transcript enters Pi through `pi.sendUserMessage`, so the existing `input` → `ensureConversationConstraints`, `before_agent_start` prompt injection, `tool_call` guard, and `user_bash` block apply unchanged (all verified in the shipped extension). Phase 5 adds no enforcement path and removes none; the blast radius of a compromised companion is bounded by read-only mode.
- **No mic outside safe mode:** spawn gated on `controller.isEnabled()`; `disable()` kills the companion before restoring tools/thinking; restart-budget exhaustion degrades to Phase-1 safe mode, never to off.
- **Consent tiers** (native analog of plan §6.5): local capture + loopback providers = the setup wizard's explicit summary confirm (`native.enabled` + `nativeAudioAcceptedAt`). Non-loopback provider URLs additionally require `allowRemoteProviders: true` plus an extra confirm naming the host. Hosted adapters (5c) require env key AND `consent.hosted*AcceptedAt` AND explicit provider selection; they refuse to construct otherwise (`consent-required`), and there is never an automatic local→hosted fallback. The hosted disclosure states explicitly that assistant answers sent to hosted TTS can contain file contents read by the read-only tools.
- **Data handling:** raw audio lives only in companion memory; the only disk artifacts are mode-0600 temp WAVs in `$XDG_RUNTIME_DIR/pi-voice/` unlinked in `finally`. Logs/metrics never contain transcript text or audio without `PI_VOICE_DEBUG_TRANSCRIPTS=1`. Nothing voice-related is persisted via `pi.appendEntry` — per-process memory only (plan §6.2). Transcripts enter the session as ordinary user messages, same visibility as typing.
- **Visible state:** footer + widget always present while capture is armed; `paused` is visually distinct and (for user-initiated pause) backed by a dead capture process; companion death clears to `error` — never a stale `listening` label with no process holding the mic.

## 12. Implementation phasing and test strategy

**5a — first PR-sized slice (shippable native audio):** companion skeleton + JSONL protocol v1 + handshake; capture/playback chains with probe + argv override; tier-0 energy VAD with pre-roll; WAV encoder; `local-endpoint` STT adapter (Phase-4 contract); TTS via `local-endpoint` with espeak-ng floor; half-duplex gating + tail guard; orchestrator with uiState mapping, idle dispatch, and steer-based tool-phase interrupt wiring; triple no-orphan guarantee; `/talk audio on|off`, `/talk pause|resume`, `/talk doctor` (probe subset), extended `/talk status`; `lib/voice-config.mjs`; rewritten textual `/talk setup` (manual voice.json documented in README); unit tests below; progress-file update. **Explicitly out of 5a:** wizard dialogs, silence events, final-text-stream interrupts via `ctx.abort()` (steer fallback only until verified), barge-in, hosted adapters, Silero, metrics polish.

**5b:** full setup wizard (SettingsList page, mic/speaker tests, calibration, consent pages, hotkey selection); `handleConversationSilence` added to the controller + native silence events; `headphones:true` voice barge-in; device watchdog UX; `/talk metrics`; optional Silero VAD (optionalDependency + confirmed model download).

**5c:** `ctx.abort()` interrupt path (after runtime verification); duck-and-verify speaker barge-in + self-transcript filter; sentence-chunked TTS with first-sentence start; hosted Groq/OpenAI adapters behind consent; exec adapters (`whisper-cli`, `piper --output-raw`) as alternatives to HTTP endpoints.

**5d:** streaming STT (Vosk WebSocket) with `partial-transcript` + adaptive endpointing; PipeWire echo-cancel opt-in setup step; macOS/Windows chain validation.

**Test strategy (CI needs no soundcard; follows the existing `fake-pi.mjs`/controller-test patterns):**

- `vad.test.mjs`: pure-function tests on synthetic s16 buffers (sine bursts, white noise at controlled SNR, floor ramps) asserting start/hangover/pre-roll/min/max transitions frame-exactly.
- `wav.test.mjs`: golden header bytes; round-trip parse.
- Provider adapter tests against `node:http` stub servers (port 0): multipart shape (`file` field), tolerant JSON parsing, `AbortSignal.timeout` honored, error mapping, espeak-ng argv construction.
- Companion integration: run the real companion with fixture capture/playback commands (`native.capture.command = ["node","tests/fixtures/fake-capture.mjs", …]` streaming pre-generated PCM at 16 kHz pacing; fake playback records byte counts) + stub STT server; assert handshake, state sequences, transcripts, speak lifecycle.
- Orphan/shutdown tests: SIGKILL the (fake) parent → assert stdin-EOF teardown kills the fixture capture PID (`process.kill(pid,0)` throws); stale-pidfile sweep; restart backoff → error after budget.
- Orchestrator tests against a fake `pi`: uiState sequences, `sendUserMessage` payloads and `deliverAs` choices, coalescing/cap-3 backpressure, refusal to spawn when controller disabled, disable-order (companion dies before tool restore).
- Config tests: defaulting/validation, env precedence, consent gating.
- Latency regression: loopback fixture through the full companion asserting stage timings within budget envelopes.
- Manual/soundcard (checklist in a validation doc): real mic feel, endpoint quality, echo behavior speakers vs headphones, `/talk off` mid-playback, device unplug; plus a semi-automated PipeWire null-sink loopback harness (`pactl load-module module-null-sink sink_name=pi_voice_test`, capture `pi_voice_test.monitor`, `pw-play` a known WAV) for deterministic E2E without a human voice.

## 13. Decision table

| Decision | Chosen (lens) | Rejected (lens) — why |
|---|---|---|
| Process model | Companion child process, package-shipped, spawned via `child_process` (B/C) | In-extension loop (A) — weaker crash isolation for the process owning safety-restore state; SIGPIPE-physics orphan story not guaranteed; blocks the Silero upgrade path. A's zero-IPC simplicity acknowledged as the real cost. |
| Transport | JSONL over stdio, versioned hello (B/C; C's HTTP rejection rationale) | Local HTTP (rejected by C) — localhost port = authz surface for a mic endpoint, no consumer needs it; A's in-process message contract — subsumed (same message shapes, now over stdio). |
| Tool-phase interrupt dispatch | `pi.sendUserMessage(text, {deliverAs:"steer"})` (B/C) — **verified**: steer delivers after current tool calls, before next LLM call | `deliverAs:"followUp"` (A) — verified docs show followUp waits for the agent to finish all tools; wrong semantics for "interrupt after tool finishes". |
| Final-text interrupt | `ctx.abort()` + new turn, gated on runtime verification, steer fallback (B/C) | A's claim that abort is fully "confirmed" — existence verified, abort-then-send semantics not; kept as needs-verification. |
| First-slice STT contract | Phase-4 `local-endpoint` multipart contract shared with WebUI (C) — **verified** against `pi-webui.mjs` | A's direct whisper.cpp `/inference`-specific adapter — same server fits the generic contract; one contract serves both loops; B's day-one Groq/OpenAI — deferred to 5c to keep 5a small and privacy-default. |
| First-slice TTS | `local-endpoint` (C) + espeak-ng zero-server floor (A/B; verified present) | C's endpoint-only 5a — dead first-run with nothing installed; A's Piper-HTTP-specific adapter — folded into the generic endpoint contract. |
| No-orphan-mic | Triple guarantee: escalating group-kill (C) + stdin-EOF dead-man switch + pidfile sweep (B); `paused` kills capture child (A) | A's SIGPIPE physics as a primary layer — not guaranteed across tools; PR_SET_PDEATHSIG — needs native code. |
| VAD | Tier-0 energy VAD, 512-sample/32 ms frames (B, for Silero compat), adaptive floor + 9 dB start (B/C), setup calibration + clamps (A), 300 ms pre-roll / 300 ms min / 800 ms hangover / 30 s cap (A/C consensus values) | 480-sample frames (A/C) — breaks drop-in Silero v5; B's 700 ms hangover and 500 ms pre-roll — merged toward the two-lens consensus, all tunable in voice.json. |
| VAD upgrade | Silero v5 via `onnxruntime-node` optionalDependency in 5b, graceful tier-0 fallback (B) | Making it required (none proposed) — violates zero-dep floor; webrtcvad — not proposed with evidence. |
| Echo/barge-in | Half-duplex default (all); `headphones:true` unlock in 5b (A); duck-and-verify for speakers in 5c (B); PipeWire echo-cancel documented opt-in (B/C) | In-process adaptive AEC (rejected by B) — high effort, fragile, half-duplex covers realistic cases; A's Ctrl+T default hotkey — **verified conflict** with Pi's default `app.thinking.toggle`; hotkey ships default-unbound, chosen in setup (B). |
| Silence events | Exact WebUI wording via `sendUserMessage` (A, verified at `voice-conversation.mjs:33`); arming logic added to the controller as `handleConversationSilence` in 5b (B/C, verified gap) | B's `pi.sendMessage` customType variant — diverges from the browser loop's user-message semantics; kept as an open question if typed rendering is later wanted. |
| Config | C's `native.*` + consent-timestamp schema, merged with A's `allowRemoteProviders`, atomic writes, env precedence; Phase-4 env names (all) | New env var names — pointless divergence from the shipped Phase-4 surface. |
| Setup UX | Wizard on `select/confirm/input` (A, works in TUI+RPC) with `SettingsList` TUI page in 5b (C, pattern verified); `/talk doctor` (C) merged with A/B's per-target tests as `/talk doctor [target]` | TUI-only wizard from day one (C) — RPC mode would regress below Phase-1 text. |
| Phasing | 5a = capture+VAD+endpoint-STT+espeak/endpoint-TTS+half-duplex+shutdown guarantees+doctor (A's one-PR discipline, C's scope) | B's ~1.5 kLOC 5a incl. hosted adapters + metrics — trimmed; A's 5a with keyboard barge-in — hotkey deferred to 5b with the conflict resolved. |

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Orphan mic capture after crash/kill | Privacy, trust | Triple guarantee (§4); `paused` kills capture child; SIGKILL-parent test in CI; manual `ps` check in validation doc |
| Energy VAD false triggers (typing, fans, music) | Trust loss, garbage prompts | Calibration + adaptive floor, min-utterance + empty-transcript filters, visible state, one-command pause, PTT hotkey, Silero path |
| TTS echo re-transcribed as user speech | Runaway self-conversation | Half-duplex default + 250 ms tail; barge-in only behind headphones assertion (5b) or duck-and-verify + self-transcript filter (5c) |
| whisper.cpp/Piper endpoint shape drift | Setup breaks | Generic tolerant Phase-4 contract + live round-trip health checks in setup; pinned example commands in README |
| Provider server not running (true on this machine today) | Dead loop | espeak-ng floor for TTS; 5 s probes; 3-strike recoverable error naming the exact restart command |
| `ctx.abort()` semantics differ from assumption | Interrupt UX degraded | Needs-verification gate; steer-only fallback is plan-compliant; verify before enabling in 5c |
| Companion/extension version skew after package update | Protocol breakage | Versioned hello; refuse mismatched major; companion ships in the same package checkout |
| Slow model → user talks over agent repeatedly | Prompt spam | Coalesced single steer message, cap 3, drop-oldest with notify |
| CPU STT latency on long utterances | Sluggish turns | 30 s cap, recommend base/small models in setup, `transcribing` state visible, per-stage metrics in `/talk status` |
| Companion crash loop | UX degradation | Restart budget 3/60 s with backoff → `error`; safe mode never widens; stderr ring buffer in `/talk status` |
| Non-PipeWire / exotic audio stacks | Capture fails | 4-tool probe chains + explicit argv override; doctor names the failing link |
| GPL Piper contamination | Licensing | Never bundled or spawned in 5a/5b; endpoint/exec only, user-installed; espeak-ng keeps TTS working without it |
| Hosted providers receiving file contents via TTS | Privacy | Explicit disclosure in hosted consent page; local endpoints recommended everywhere; no auto local→hosted fallback |
| RPC/print modes lack TUI hooks | Control gaps | Loop is command-driven; `/talk` subcommands are the universal surface; wizard degrades to select/confirm/input |

## 15. Open questions

1. `ctx.abort()` runtime semantics: does it abort the in-flight assistant stream cleanly, is calling it from a ctx cached outside the originating handler safe, and can `pi.sendUserMessage` follow immediately without racing the abort? (Blocks the 5c new-turn interrupt path; steer fallback until answered.)
2. Is there a dispatch race between `agent_end` and `ctx.isIdle()` such that a plain `sendUserMessage` (no `deliverAs`) can throw "streaming" — should the orchestrator always pass `deliverAs` defensively?
3. Exact whisper.cpp `whisper-server` `/inference` multipart/response shape across current versions — does it fully accept the Phase-4 `file`-field form and return `{text}`? (Setup round-trip mitigates; needs one live validation.)
4. Does the OHF Piper HTTP server natively accept the Phase-4 JSON `{text, voice?, format}` contract, or must the README document a thin wrapper?
5. Silero VAD via `onnxruntime-node` as an `optionalDependency`: is the dependency weight and licensing acceptable for this package, and where is the model download hosted/verified from?
6. PipeWire `module-echo-cancel` (`pactl load-module … aec_method=webrtc`): availability and behavior across target systems for the opt-in setup step.
7. Which hotkey chord should setup suggest for push-to-talk/stop-speaking, given `ctrl+t` and other defaults are taken — audit `core/keybindings.js` defaults for a free chord, or always require an explicit user choice?
8. Should the silence event remain a plain user message (exact WebUI parity, chosen here) or become a typed `pi.sendMessage({customType:"natural-conversation-silence"})` with a registered renderer?
9. Do the macOS (`ffmpeg -f avfoundation`, `afplay`) and Windows (`ffmpeg -f dshow`) chain entries actually work with the raw-PCM pipeline shapes used here? (Unvalidated; Linux/PipeWire is the 5a–5c target.)
10. Should `voice.json` be shared byte-for-byte with a future WebUI-written config (plan §8 names one file for both), and if so, who owns schema migrations across the two writers?
