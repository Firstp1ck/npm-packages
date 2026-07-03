# Natural Conversation Naturalness Improvement Plan

## Goal

Make `@firstpick/pi-package-natural-conversation` feel more like a low-latency spoken conversation while preserving its current safety, privacy, and local-first guarantees.

## Current baseline

The package currently provides:

- opt-in safe mode via `/talk`;
- native audio companion process with no Pi API access;
- local capture through `pw-record`, `parecord`, `arecord`, or `ffmpeg`;
- energy VAD over raw 16 kHz mono PCM;
- STT through a local endpoint by default;
- TTS through Piper, local endpoint, OpenAI, or `espeak-ng` fallback;
- playback through `pw-play`, `paplay`, `aplay`, or `ffplay`;
- final-response-only speech playback;
- half-duplex gating, optional barge-in/headphones mode, self-echo filtering, and silence events.

Current local config observed on this machine:

- native audio enabled;
- capture device auto/default;
- VAD threshold calibrated to around `-51 dBFS`;
- STT provider: local endpoint at `127.0.0.1:8178`;
- TTS provider: Piper using `en_GB-alba-medium`;
- headphones enabled;
- remote providers disabled.

## Non-negotiable constraints

Do not regress these properties:

1. No microphone outside explicit conversation/audio mode.
2. Companion process must remain isolated from Pi APIs.
3. Raw audio must not be logged or persisted.
4. Hosted STT/TTS must remain opt-in with explicit consent.
5. `/talk off` must stop audio before restoring wider tool access.
6. Conversation mode must remain read-only unless the user leaves it.
7. Audio failure must degrade to safe text mode, not wider access.

## Recommended roadmap

### Phase 1 — Configuration-only tuning

Purpose: improve responsiveness without code changes.

Actions:

- Try reducing `native.vad.hangoverMs` from `800` to `500`.
- If stable, test `400`; if utterances get split, return to `500` or `800`.
- Keep `minSpeechMs` at `300` initially.
- Tune `silence.timeoutMs` only after VAD feels right.
- Record subjective latency and false-trigger rate after each change.

Success criteria:

- Assistant starts responding noticeably sooner after user stops speaking.
- Normal sentences are not split into separate turns.
- Background noise does not trigger frequent false turns.

Files/config touched:

- `~/.pi/agent/voice.json`
- README tuning notes, if useful.

Verification:

- `/talk doctor mic`
- `/talk metrics`
- several live conversational trials.

### Phase 2 — Spoken style presets

Purpose: improve the words the assistant chooses before changing audio plumbing.

Add configurable response styles such as:

- `concise`
- `casual`
- `pair-programmer`
- `coach`
- `quiet`

Default style should stay conservative and useful.

Implementation sketch:

- Add `native.style.preset` or a top-level conversation style config.
- Extend the spoken system prompt in `lib/conversation-controller.mjs`.
- Add `/talk style` and `/talk style <preset>` commands if the UX is worth it.
- Keep generated responses TTS-friendly: short sentences, no markdown, one question at most unless asked.

Success criteria:

- Spoken answers sound less like written reports.
- The user can switch style without editing files manually.
- Existing safe-mode constraints still apply.

Likely files:

- `lib/conversation-controller.mjs`
- `lib/conversation-controller.d.ts`
- `extensions/natural-conversation.ts`
- `lib/voice-config.mjs`
- `README.md`
- tests for prompt/config behavior.

### Phase 3 — Immediate acknowledgement for slow turns

Purpose: reduce awkward dead air after the user speaks.

Behavior:

```text
User finishes speaking.
Assistant quickly says: "Got it, one second."
Assistant then gives the real answer when ready.
```

Design options:

1. **Static acknowledgement**
   - Speak a short fixed phrase after final transcript dispatch.
   - Lowest complexity.
   - Risk: annoying if overused.

2. **Delayed acknowledgement**
   - Start a short timer after final transcript.
   - If the assistant has not started responding within about `600-900 ms`, speak an acknowledgement.
   - Better UX than always acknowledging.

3. **Intent-aware acknowledgement**
   - Only acknowledge for likely slow tasks, such as file inspection, debugging, or multi-step reasoning.
   - Highest quality, but needs reliable heuristics.

Recommended first implementation:

- Delayed static acknowledgement.
- Configurable and off by default or conservative by default.
- Suppress for very short transcripts and when TTS is already active.

Possible config:

```jsonc
"acknowledgement": {
  "enabled": true,
  "delayMs": 700,
  "phrases": ["Got it, one second.", "Okay, let me check."]
}
```

Success criteria:

- Long tasks feel responsive.
- Short answers are not cluttered with unnecessary filler.
- Acknowledgements can be disabled.

Likely files:

- `lib/native-audio-loop.mjs`
- `lib/voice-config.mjs`
- `README.md`
- orchestrator tests.

### Phase 4 — Sentence-level TTS streaming

Purpose: start speaking before the full assistant answer is complete.

Current behavior:

```text
assistant finishes full turn → final text extracted → split into chunks → TTS playback
```

Target behavior:

```text
assistant streams text → sentence boundary detector → enqueue completed sentences for TTS
```

Design notes:

- Keep final-response fallback if streaming events are unavailable.
- Speak only stable text after sentence boundaries.
- Do not speak tool cards, code blocks, paths, URLs, or markdown-heavy content.
- Avoid speaking while a tool call is active.
- Preserve interruption and cancellation behavior.

Open discovery:

- Confirm which Pi extension events expose assistant streaming deltas.
- Confirm whether the extension can observe text deltas before final messages.
- If not, consider adding package support only after Pi exposes a stable event.

Success criteria:

- First spoken sentence starts substantially earlier than final-answer-only mode.
- No duplicate speech when final answer arrives.
- Interruptions still cancel pending speech.
- Tool output is not read aloud.

Likely files:

- `lib/native-audio-loop.mjs`
- `lib/native-audio/speech-text.mjs`
- `extensions/natural-conversation.ts`
- tests with simulated streaming events.

### Phase 5 — Faster interruption response

Purpose: make barge-in feel immediate.

Current behavior already supports interruption after STT final transcript. Improve it by reacting to VAD `speech_start` while the assistant is speaking.

Target behavior:

```text
assistant speaking → user starts speaking → TTS immediately stops or ducks → STT final transcript becomes new turn/steer
```

Design options:

1. **Cancel on speech start**
   - On companion `vad: speech_start`, send `cancel-speak` if TTS is active.
   - Very responsive.
   - Risk: false positives from coughs/noise.

2. **Duck on speech start, cancel on confirmed speech end**
   - Lower playback volume immediately, then cancel only when VAD confirms a real utterance.
   - More natural, but requires playback volume control support.

3. **Configurable hybrid**
   - `off`, `duck`, or `cancel`.
   - Start with `cancel` only when `headphones` or `bargeIn.enabled` is true.

Recommended first implementation:

- Configurable `cancelOnSpeechStart` behind barge-in/headphones mode.
- Add debounce/minimum speech confidence using existing VAD events if needed.

Success criteria:

- User can interrupt without talking over long TTS playback.
- False interruptions are rare.
- Self-echo filter still prevents the assistant from interrupting itself.

Likely files:

- `lib/native-audio-loop.mjs`
- `lib/native-audio-companion.mjs` only if extra VAD metadata is needed
- `lib/voice-config.mjs`
- interruption tests.

### Phase 6 — Better local TTS quality

Purpose: improve perceived naturalness independent of turn-taking.

Options:

1. **Better Piper voice selection**
   - Lowest risk.
   - Improve catalog and setup recommendations.

2. **Local TTS endpoint improvements**
   - Keep package contract stable: JSON text in, audio out.
   - Use external local services for higher-quality engines.

3. **Optional hosted TTS**
   - Highest quality/ease, but privacy and cost tradeoffs.
   - Must remain explicitly consent-gated.

Candidate local engines to evaluate separately:

- Kokoro-style local TTS;
- XTTS-style voice cloning;
- F5-TTS-style local synthesis;
- Piper high-quality voices where available.

Success criteria:

- Noticeably more natural voice.
- Acceptable generation latency.
- No new default remote dependency.
- Existing Piper and `espeak-ng` fallback continue to work.

Likely files:

- `lib/setup-wizard.mjs`
- `lib/providers/*`
- `lib/voice-switch.mjs`
- `README.md`
- provider tests.

### Phase 7 — Lightweight conversation continuity

Purpose: make the assistant feel context-aware without becoming intrusive.

Possible behavior:

- Maintain a short volatile spoken-session summary.
- Include recent user preferences for speech style.
- Remember temporary decisions within the active `/talk` session.
- Do not persist new memory automatically unless explicitly requested.

Success criteria:

- Assistant avoids asking repeated setup/context questions.
- It references recent spoken context correctly.
- It does not overclaim memory or infer private intent.

Likely files:

- `lib/conversation-controller.mjs`
- possibly a small session-state module
- tests for prompt injection and reset behavior.

## Prioritization matrix

| Improvement | Impact | Effort | Risk | Recommended priority |
|---|---:|---:|---:|---:|
| VAD tuning | Medium | Low | Low | 1 |
| Spoken style presets | Medium | Low-Medium | Low | 2 |
| Delayed acknowledgement | High | Medium | Medium | 3 |
| Faster interruption cancel | High | Medium | Medium | 4 |
| Sentence-level TTS streaming | Very high | High | Medium-High | 5 |
| Better local TTS | High | Medium-High | Medium | 6 |
| Session continuity | Medium | Medium | Medium | 7 |

## Suggested implementation sequence

1. Tune VAD locally and record preferred values.
2. Add style preset support and tests.
3. Add delayed acknowledgement with conservative defaults.
4. Add cancel-on-speech-start for barge-in/headphones mode.
5. Investigate Pi streaming delta events.
6. Implement sentence-level TTS streaming if supported cleanly.
7. Evaluate better local TTS engines through the existing local-endpoint contract.
8. Add lightweight volatile conversation continuity only after latency/turn-taking are solved.

## Testing and verification plan

Minimum automated checks after code changes:

```bash
npm run check --prefix pi-package-natural-conversation
```

Add or extend tests for:

- voice config validation and default migration;
- style prompt generation;
- acknowledgement timer behavior;
- no acknowledgement when disabled;
- no duplicate speech after final assistant response;
- interruption cancellation on VAD speech start;
- self-echo suppression while speaking;
- silence timer interactions;
- companion teardown and no-orphan-microphone guarantees.

Manual checks:

- `/talk doctor mic`
- `/talk doctor stt`
- `/talk doctor tts`
- `/talk metrics`
- live tests with:
  - short question;
  - long debugging request;
  - interruption during TTS;
  - silence after assistant question;
  - noisy-room false-trigger test.

## Open decisions

1. Should acknowledgements be enabled by default or opt-in?
2. Which spoken style should be the default?
3. Should VAD tuning be exposed through `/talk setup` as presets?
4. Is immediate TTS cancellation preferable to volume ducking?
5. Which Pi event should be the canonical source for streaming assistant text?
6. Should better TTS be implemented as first-class providers or kept behind `local-endpoint`?

## Definition of done

The improvement set is successful when:

- first response latency is perceptibly lower;
- interruptions feel natural;
- speech output sounds intentionally spoken, not written;
- failures remain safe and recoverable;
- no remote provider is used without explicit consent;
- tests cover the new state-machine behavior;
- README documents the tuning and UX options clearly.
