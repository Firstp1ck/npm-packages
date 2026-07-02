# Natural Conversation Missing Features Implementation Plan

Status: Implemented 2026-07-02 (Phase 5a fully; package-owned 5b/5c items: setup wizard, silence events, widget/status, metrics, self-echo filter, hosted adapters behind consent, steer-based interruption). Deferred per design §15: `ctx.abort()` new-turn interruption (steer fallback shipped), Silero VAD, streaming STT partials (5d), macOS/Windows chains (5d). Verification: `npm run check --prefix pi-package-natural-conversation` (63 tests) plus an offline real-pi RPC smoke of the `/talk` surface. Manual soundcard + real STT/TTS provider validation pending — see `docs/webui/natural-conversation/NATURAL_CONVERSATION_MODE_PROGRESS.md`.
Date: 2026-07-02
Scope: `pi-package-natural-conversation` native/package-owned missing features after the verified Phase 1 safe-mode slice.

## 1. Goal

Implement the package-owned missing Natural Conversation features while preserving the current verified safety behavior:

- native Pi TUI microphone capture;
- VAD/turn detection;
- STT transcription;
- prompt dispatch into Pi;
- TTS playback of assistant answers;
- setup/diagnostics UX;
- silence and interruption handling;
- provider configuration and validation.

The implementation must keep the package standalone. WebUI may integrate with the mode, but the native package must not depend on `pi-package-webui`.

## 2. Current Baseline

Already implemented and verified:

- `package.json` declares `pi.extensions: ["./extensions/natural-conversation.ts"]`.
- `/talk`, `/voice`, and `/conversation` commands exist.
- Controller stores/restores active tools and thinking level.
- Thinking is forced to `off` while enabled.
- Active tools are limited to `read`, `grep`, `find`, `ls`.
- Non-allowlisted tool calls are blocked.
- `!`/`!!` shell commands are blocked while enabled.
- Read-only spoken-response system prompt guidance is appended.
- UI status shows `Voice: listening` while enabled.
- Package tests pass.

Missing from the package:

- real native audio loop;
- voice provider config;
- setup wizard and doctor commands;
- companion process supervision;
- native silence event support;
- native interruption dispatch during active responses;
- real provider/runtime validation.

## 3. Non-negotiable Constraints

1. **Controller remains safety authority.** The audio loop must not change tools, thinking, or prompt policy directly.
2. **No microphone outside safe mode.** Audio capture may start only when `controller.isEnabled()` is true.
3. **No orphan microphone.** Capture/playback processes must be killed on `/talk off`, `/talk audio off`, session shutdown, companion crash, or parent process exit.
4. **No silent hosted fallback.** Audio must stay local unless the user explicitly configures and consents to a hosted provider.
5. **No secrets in config files.** API keys remain environment-only.
6. **Safe degradation.** Audio failures degrade to Phase 1 safe text mode; they must never widen tool access.

## 4. Target Architecture

Add a package-shipped native audio companion supervised by the extension:

```text
extensions/natural-conversation.ts
  ├─ lib/conversation-controller.mjs       # existing safety controller
  ├─ lib/native-audio-loop.mjs             # new extension-side orchestrator
  ├─ lib/voice-config.mjs                  # new config load/validate/write helpers
  └─ lib/native-audio-companion.mjs        # new child-process entrypoint
       └─ lib/native-audio/*.mjs           # capture, VAD, WAV, playback helpers
```

Transport between extension and companion: JSONL over stdio. Audio bytes stay inside the companion process and provider adapters.

## 5. New Commands

Extend the existing command family:

```text
/talk audio on       # start native audio loop, requires safe mode on
/talk audio off      # stop native audio loop, keep safe mode on
/talk pause          # stop/pause capture without disabling safe mode
/talk resume         # resume capture
/talk doctor         # run all native audio probes
/talk doctor mic     # probe capture path
/talk doctor speaker # probe playback path
/talk doctor stt     # probe STT provider
/talk doctor tts     # probe TTS provider
/talk setup          # replace static text with setup/config workflow
```

Existing commands must remain compatible:

- `/talk` toggles safe mode.
- `/talk on` enables safe mode and may auto-start native audio only if configured.
- `/talk off` stops audio first, then restores previous tools/thinking.
- `/talk status` reports safe mode and native audio status.

## 6. Implementation Phases

### Phase 5a — Shippable Native Audio Skeleton

Deliver the smallest useful native audio slice.

#### Files to add

- `lib/native-audio-loop.mjs`
- `lib/native-audio-companion.mjs`
- `lib/native-audio/vad.mjs`
- `lib/native-audio/wav.mjs`
- `lib/native-audio/capture.mjs`
- `lib/native-audio/playback.mjs`
- `lib/providers/stt-local-endpoint.mjs`
- `lib/providers/tts-local-endpoint.mjs`
- `lib/providers/tts-espeak.mjs`
- `lib/voice-config.mjs`
- focused tests under `tests/`

#### Work items

1. Implement `voice-config.mjs` defaults and validation for `~/.pi/agent/voice.json`.
2. Implement JSONL companion handshake: `hello`, `ready`, `shutdown`, `bye`, `error`.
3. Implement companion process lifecycle:
   - spawn via `process.execPath`;
   - detached process group;
   - graceful shutdown, SIGTERM, SIGKILL fallback;
   - stdin EOF dead-man switch;
   - stale pidfile sweep under `$XDG_RUNTIME_DIR/pi-voice/`.
4. Implement capture command fallback chain:
   - `pw-record`;
   - `parecord`;
   - `arecord`;
   - `ffmpeg`.
5. Implement playback fallback chain:
   - `pw-play`;
   - `paplay`;
   - `aplay`;
   - `ffplay`.
6. Implement energy VAD:
   - 16 kHz mono s16le;
   - 512-sample frames;
   - adaptive noise floor;
   - 300 ms pre-roll;
   - 300 ms minimum utterance;
   - 800 ms hangover;
   - 30 s maximum utterance.
7. Implement WAV wrapping for utterance buffers.
8. Implement local STT endpoint adapter using Phase 4-compatible multipart upload.
9. Implement local TTS endpoint adapter using JSON `{ text, voice?, format }`.
10. Implement `espeak-ng` TTS fallback.
11. Implement half-duplex turn taking:
    - listen while idle;
    - close mic gate while transcribing/speaking;
    - speak final assistant answer only;
    - never speak tool cards.
12. Dispatch transcripts through `pi.sendUserMessage()` only from the orchestrator.
13. Use `pi.sendUserMessage(text, { deliverAs: "steer" })` for tool-phase interruptions.
14. Add `/talk audio on|off`, `/talk pause|resume`, `/talk doctor`, and extended `/talk status`.
15. Update README with setup, provider, and safety docs.

#### Phase 5a verification

- `npm run check --prefix pi-package-natural-conversation`
- unit tests for config, WAV, VAD, provider adapters;
- companion integration tests with fake capture/playback commands;
- shutdown/orphan tests using fake child processes;
- orchestrator tests with fake Pi API;
- manual check: `/talk on`, `/talk audio on`, speak one prompt, hear assistant TTS, `/talk off`, verify no capture process remains.

### Phase 5b — Setup Wizard, Silence Events, Better UX

#### Work items

1. Replace `/talk setup` static notification with interactive setup:
   - probe environment;
   - configure STT endpoint;
   - configure TTS provider;
   - calibrate microphone;
   - test speaker;
   - collect native-audio consent;
   - write `voice.json` atomically with mode `0600`.
2. Add `handleConversationSilence()` to the controller.
3. Send conservative silence events after unanswered assistant questions.
4. Add persistent widget/status while capture is armed.
5. Add optional push-to-talk or stop-speaking shortcut, default unbound.
6. Add `/talk metrics` or enrich `/talk status` with last-turn stage timings.
7. Add optional headphones mode for simpler barge-in.

#### Phase 5b verification

- setup wizard tests with mocked `ctx.ui`;
- controller tests for silence-event state;
- status/widget tests;
- manual mic calibration and speaker test on Linux/PipeWire.

### Phase 5c — Robust Interruption and Hosted Providers

#### Work items

1. Runtime-verify `ctx.abort()` semantics before enabling abort-and-new-turn interruption.
2. Implement final-text interruption:
   - stop TTS;
   - abort active stream if safe;
   - send interruption as a new user turn with context.
3. Implement duck-and-verify speaker barge-in.
4. Add self-echo transcript filter.
5. Add hosted STT/TTS adapters behind explicit consent:
   - Groq STT;
   - OpenAI STT;
   - OpenAI TTS.
6. Add provider cost/privacy notices in setup.
7. Add command-line provider adapters for user-installed `whisper-cli` and Piper if useful.

#### Phase 5c verification

- interruption E2E tests;
- hosted-provider adapter tests with stub servers;
- explicit consent refusal tests;
- manual echo/barge-in validation with speakers and headphones.

### Phase 5d — Streaming and Cross-platform Polish

#### Work items

1. Add streaming STT partial transcript protocol.
2. Add Vosk/WebSocket adapter if still desired.
3. Add optional Silero VAD via explicit optional dependency/model download decision.
4. Validate macOS capture/playback chain.
5. Validate Windows capture/playback chain.
6. Document PipeWire echo-cancel setup as an opt-in advanced path.

#### Phase 5d verification

- streaming transcript tests;
- platform-specific smoke docs;
- latency regression harness.

## 7. voice.json Draft Schema

```jsonc
{
  "version": 1,
  "native": {
    "enabled": false,
    "autoStartWithTalkOn": true,
    "capture": { "tool": "auto", "command": null, "device": null, "sampleRateHz": 16000 },
    "playback": { "tool": "auto", "command": null, "device": null },
    "vad": {
      "startDb": 9,
      "thresholdDb": null,
      "hangoverMs": 800,
      "minSpeechMs": 300,
      "maxUtteranceMs": 30000,
      "preRollMs": 300,
      "engine": "energy"
    },
    "stt": { "provider": "local-endpoint", "language": "auto", "timeoutMs": 30000 },
    "tts": { "provider": "local-endpoint", "voice": null, "rate": 1.0, "fallback": "espeak-ng" },
    "headphones": false,
    "bargeIn": { "enabled": false, "selfEchoOverlap": 0.6 },
    "silence": { "enabled": true, "timeoutMs": 8000 },
    "allowRemoteProviders": false
  },
  "consent": {
    "nativeAudioAcceptedAt": null,
    "hostedSttAcceptedAt": null,
    "hostedTtsAcceptedAt": null
  }
}
```

Environment overrides:

```sh
PI_VOICE_STT_URL=http://127.0.0.1:8178/inference
PI_VOICE_TTS_URL=http://127.0.0.1:8179/speech
GROQ_API_KEY=...
OPENAI_API_KEY=...
PI_VOICE_DEBUG=1
```

## 8. Test Plan

### Unit tests

- `voice-config.test.mjs`
  - default config;
  - invalid config fallback;
  - env precedence;
  - consent gating;
  - no secret persistence.
- `vad.test.mjs`
  - silence stays idle;
  - speech starts after threshold;
  - hangover ends utterance;
  - pre-roll is included;
  - short clicks are discarded;
  - max utterance is enforced.
- `wav.test.mjs`
  - valid RIFF header;
  - expected sample rate/channels/bit depth;
  - payload length correctness.
- `providers.test.mjs`
  - local STT multipart shape;
  - local TTS JSON shape;
  - timeout/error mapping;
  - `espeak-ng` argv construction.

### Integration tests

- companion handshake and shutdown;
- fake capture emits PCM and fake STT returns transcript;
- fake playback receives synthesized bytes;
- no-orphan capture after parent/companion shutdown;
- restart budget and error state;
- orchestrator refuses spawn when controller is disabled;
- `/talk off` kills audio before restoring tools/thinking.

### Manual validation

Create a validation note under `docs/webui/natural-conversation/` or package docs after manual checks:

1. `npm run check --prefix pi-package-natural-conversation` passes.
2. `/talk setup` probes local tools.
3. `/talk on` enables safe mode.
4. `/talk audio on` starts capture and shows visible status.
5. Spoken prompt is transcribed and submitted.
6. Assistant answer is spoken.
7. `/talk pause` stops capture process.
8. `/talk resume` resumes capture.
9. `/talk off` restores tools/thinking and leaves no capture/playback child process.
10. Tool/write requests remain blocked in voice mode.

## 9. Acceptance Criteria

Phase 5a is ready for review when:

- native audio can run in a local Linux/PipeWire TUI session with configured local STT or test stub;
- assistant answers can be spoken through local TTS or `espeak-ng`;
- `/talk off` reliably stops all companion/capture/playback processes;
- safe-mode tests still pass unchanged;
- the feature is opt-in and documented;
- failure modes leave the user in safe text-only conversation mode.

Phase 5 is complete when:

- setup wizard, native audio loop, interruption handling, silence handling, provider diagnostics, and docs are implemented;
- all package tests pass;
- at least one real local STT/TTS provider path is manually validated;
- no unresolved safety/privacy blocker remains.

## 10. Open Decisions Before Coding 5a

1. Confirm this plan should use the companion-process architecture from `docs/webui/natural-conversation/NATURAL_CONVERSATION_NATIVE_AUDIO_COMPANION_DESIGN.md`.
2. Confirm Linux/PipeWire is the only supported 5a runtime target.
3. Confirm `espeak-ng` is acceptable as the first TTS floor.
4. Decide whether `/talk on` should auto-start audio when configured, or require `/talk audio on` every time.
5. Confirm whether to keep tests in the package only or add cross-package validation docs under `docs/webui/natural-conversation/`.
