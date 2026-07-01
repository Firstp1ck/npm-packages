# Natural Conversation Mode Plan

## 1. Title & Scope

Create a standalone **Pi package/extension** for per-terminal/tab **Natural Conversation Mode** so a user can speak prompts and hear model answers in native Pi TUI and WebUI, with:

- A new Pi package, proposed as `pi-package-natural-conversation`, as the source of truth for the mode.
- A native Pi TUI extension command, proposed as `/talk` with aliases `/voice` and `/conversation` if accepted.
- An optional WebUI feature toggle inside the **Common Pi options** dropdown that appears only when the package is installed/enabled, and integrates with the package instead of owning the core feature.
- Automatic STT (speech-to-text) and TTS (text-to-speech) while the mode is enabled.
- Mode-scoped safety: force model thinking to `off` and expose only nondestructive tools.
- Minimal setup flow for free/local or low-cost API-based STT/TTS.

This is a plan only; no implementation is included here.

## 2. Objectives

1. Deliver Natural Conversation Mode as an independent Pi package/extension that works in native Pi TUI without WebUI running.
2. Let the user talk naturally in WebUI and native TUI, with WebUI acting as an optional integration surface for the package.
3. Keep `pi-package-webui` usable without installing Natural Conversation Mode; the package must be an optional feature, not a hard WebUI dependency.
4. Keep activation state **per WebUI tab / terminal process**, not global and not session-persistent by default.
5. Keep destructive actions unavailable in this mode, even if other tools/extensions are installed.
6. Keep setup simple: browser-native defaults first for WebUI; API/local providers optional; local provider path required for full native TUI audio.
7. Preserve Pi's existing package, extension, WebUI, and TUI architecture instead of forking core behavior.

## 3. Non-goals

- No voice cloning or custom voice training in the first version.
- No destructive coding/write workflow while in conversation mode.
- No always-on global daemon by default.
- No storage of API keys in browser localStorage.
- No direct remote microphone streaming unless remote access and privacy prompts are explicitly accepted. In practice, this means remote/LAN WebUI sessions must not silently forward microphone audio to the Pi host or third-party STT providers; they need an explicit per-session disclosure covering where audio is captured, where it is processed, whether it leaves the user's device/network, and how to stop it.

## 4. Current State / Repo Findings

### WebUI option surface

- `pi-package-webui/public/index.html` already has the Common Pi options dropdown at `#optionsMenu` with buttons for `/tree`, `/fork`, `/settings`, `/reload`, `/resume`, etc. This is the requested location for the toggle.
- `pi-package-webui/public/app.js` wires the options menu open/close behavior via `setOptionsMenuOpen()` and click handlers around `optionsMenuButton`, `optionsTreeButton`, etc.
- `sendPrompt()` in `pi-package-webui/public/app.js` is the frontend choke point for normal prompt submission, steering, follow-up, slash-command routing, attachments, busy behavior, and WebUI state refresh.

### WebUI backend / RPC surface

- `pi-package-webui/bin/pi-webui.mjs` starts one Pi RPC process per tab and tracks tab-local fields in `createTab()`.
- `commandFromPost()` maps WebUI routes like `/api/prompt`, `/api/thinking`, `/api/steer`, `/api/follow-up` to Pi RPC commands.
- `setThinkingLevelForTab()` already supports applying or queueing thinking-level changes per tab, including `off`.
- `/api/prompt` already calls `applyPendingThinkingBeforePrompt()` before sending a prompt to Pi, which is a good enforcement point for conversation-mode thinking `off`.
- `handleNativeSlashCommand()` handles WebUI-native slash command parity for some commands using the `WEBUI_TUI_NATIVE_PARITY.json` matrix.

### Tool enable/disable surface

- `pi-package-webui/webui-rpc-helper.mjs` is always loaded into WebUI RPC tabs and already uses `pi.setActiveTools()` to set active tools from browser-native `/tools` state.
- `pi-extension-tools/index.ts` is a native TUI extension pattern for a `/tools` command using `pi.getAllTools()`, `pi.getActiveTools()`, and `pi.setActiveTools()`.
- Pi docs confirm extensions can register slash commands and dynamically set active tools with `pi.setActiveTools()`.
- Pi docs confirm extensions can set thinking level with `pi.setThinkingLevel("off")`; model capability clamping may still force `off` for non-reasoning models.
- Pi package docs confirm packages can bundle extensions through a `package.json` `pi.extensions` manifest or conventional `extensions/` directory, making a standalone Natural Conversation package the correct native-TUI-first delivery vehicle.

### Voice/browser capabilities

- Browser Web Speech API provides `SpeechRecognition` and `SpeechSynthesis`; MDN notes speech recognition may use a platform/web service by default, while speech synthesis uses system voices.
- WebUI can use browser microphone APIs and browser TTS directly, avoiding native audio setup for the default path.
- Native TUI has no browser microphone/speaker APIs, so a local voice companion/provider is required if full native audio is desired.

## 5. Proposed UX

### WebUI

Add a toggle row in `#optionsMenu`:

```text
Natural Conversation  [ Off | Listening | Speaking | Paused ]
```

Behavior:

1. Toggle on requests microphone permission and opens a tiny setup/status popover on first use.
2. Once active, WebUI listens for speech, sends final transcripts as normal user prompts, and speaks assistant responses.
3. While the assistant is speaking, microphone capture is paused by default to prevent echo loops unless explicit barge-in is enabled.
4. User can interrupt by pressing Esc/Abort, clicking the always-visible deactivate button, or speaking while the assistant is in final-output streaming.
5. If the user interrupts during final assistant text output, stop TTS/output presentation, abort or finish the current stream at the nearest safe boundary, and immediately send the transcribed interruption as a new user turn/steering message. Do **not** live-inject interruption into an active tool call or tool execution; queue it until the tool phase ends.
6. Toggle off restores the previous tool set and previous thinking level for that tab.
7. When active, conversation mode must be highly visible: highlighted composer/footer state, active tab badge, clear mic/speaker indicator, and a persistent `End conversation` button outside the dropdown.
8. If the assistant asks a potentially important question and the user remains silent past a configurable timeout, send a structured silence event to the agent so it can treat silence as possible confusion, discomfort, an awkward/unrequested question, or a need for reframing/explanation.

Recommended visible states:

- `Off`: normal Pi behavior.
- `Listening`: mic active, waiting for user speech.
- `Transcribing`: STT provider is producing text.
- `Thinking/Answering`: Pi is running; mic paused during tool-call/tool-execution phases, optionally listening for interrupt only during final text output.
- `Speaking`: TTS playing assistant output; mic paused unless barge-in is enabled.
- `Interrupting`: user speech detected during final assistant output; TTS stops and interruption is being sent.
- `Silence`: no answer after an assistant question; a silence event may be sent after timeout.
- `Paused/Error`: permission/provider/network issue; mode still configured but not listening.

Active-mode visual requirements:

- Add a bright/high-contrast conversation-mode chip in the composer/footer, e.g. `Voice conversation: Listening`.
- Add an active badge on the current tab only, never globally across all tabs.
- Add a persistent `End conversation` / mic-off button visible while active, independent of the Common Pi options dropdown.
- Add a dedicated remote-consent button, `Allow remote microphone streaming`, shown only when the WebUI session is remote/LAN and the selected STT path would send mic audio to the Pi host or an API provider.
- Style the prompt composer or page shell with a subtle active border/glow so the user cannot miss that the mic mode is on.
- Show live mic state and provider state (`browser`, `local`, or API provider) near the button.

### Native Pi TUI

The standalone package's native extension should be the primary independent entry point:

```text
/talk             # toggle mode
/talk on          # enable mode
/talk off         # disable mode and restore previous tools/thinking
/talk setup       # choose STT/TTS provider and test mic/speaker
/talk status      # show current mode, tools, thinking, provider
```

Minimum native implementation should at least toggle the safe conversation constraints and show a footer status. Full native audio requires a local provider/companion process, but the `/talk` command and safe-mode constraints must work without WebUI.

## 6. Proposed Architecture

### 6.1 Standalone Pi package / extension boundary

Natural Conversation Mode should be implemented first as its own Pi package, not as a WebUI-owned feature. WebUI should consume the package through a small optional adapter while the native TUI extension remains fully usable on its own. `pi-package-webui` must still start and run normally when this package is absent.

Working package shape:

```text
pi-package-natural-conversation/
  package.json                         # pi manifest with extensions entry
  extensions/natural-conversation.ts   # registers /talk, /voice, /conversation
  lib/conversation-controller.ts       # shared safety/state controller
  lib/providers/                       # STT/TTS abstractions and adapters
  lib/native-audio-companion.ts        # optional phase-5 local audio bridge
  webui/adapter.mjs                    # optional WebUI integration hooks/routes
  webui/browser-provider.js            # browser Web Speech adapter for WebUI only
  README.md
```

Package responsibilities:

- Register native Pi TUI slash commands and status indicators.
- Own the conversation-mode state machine, safety controller, tool allowlist, thinking enforcement, and `tool_call` guard.
- Own provider configuration format and non-secret config defaults.
- Provide optional adapter functions that WebUI can call for state, enable/disable, constraints, interrupt handling, silence events, and hosted/local STT/TTS fallbacks.

WebUI responsibilities:

- Detect whether `pi-package-natural-conversation` is installed/enabled for the current WebUI tab/process.
- Render the Common Pi options toggle, active-mode chip, `End conversation`, and remote microphone consent UI only when the optional feature is available.
- If unavailable, hide the toggle by default or show a disabled menu item with install/setup guidance, depending on the final UX decision.
- Use browser-only APIs where appropriate, especially Web Speech STT/TTS.
- Call the package adapter/backend routes instead of duplicating package safety logic.

### 6.2 Shared conversation-mode controller

Create the shared controller inside `pi-package-natural-conversation`. It is used by the package-owned native TUI extension and by the WebUI adapter/helper:

```ts
type ConversationModeState = {
  enabled: boolean;
  previousThinkingLevel?: ThinkingLevel;
  previousActiveTools?: string[];
  allowedTools: string[];
  startedAt?: string;
  uiState?: "off" | "listening" | "transcribing" | "answering" | "speaking" | "interrupting" | "silence" | "paused" | "error";
  bargeInEnabled?: boolean;
  silenceTimeoutMs?: number;
};
```

Core actions:

- `enableConversationMode()`
  - store previous active tools and thinking level in memory;
  - set thinking level to `off`;
  - set active tools to nondestructive allowlist;
  - install defensive `tool_call` blocker while enabled;
  - add concise spoken-response system prompt guidance.
- `disableConversationMode()`
  - restore previous tools and thinking level if still valid;
  - clear status/widgets;
  - stop STT/TTS loops.
- `ensureConversationConstraints()`
  - re-apply `thinking = off` and tool allowlist before each prompt/agent turn.
- `handleConversationInterrupt(transcript)`
  - if the assistant is streaming final text output, stop TTS/output presentation, abort the active stream if needed, and send the transcript as the next user turn with context that it interrupted the previous answer;
  - if a tool call/execution is active, queue the transcript as a safe follow-up/steering item and visibly show `will interrupt after tool finishes`.
- `handleConversationSilence(reason)`
  - send a structured silence event only after the assistant asked a question or explicitly waited for user input;
  - instruct the model to interpret silence conservatively: possible confusion, discomfort, missing context, awkward phrasing, unnecessary question, or user deciding not to answer.

State should be process/tab memory by default, not session branch entries, to satisfy per-terminal/tab semantics.

### 6.3 WebUI frontend integration

Files:

- `pi-package-webui/public/index.html`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/styles.css`

Add:

- Feature-gated `optionsConversationModeButton` / `optionsConversationModeToggle` inside `#optionsMenu`; absent/disabled unless the package adapter reports availability.
- Persistent active-mode controls outside the dropdown: `conversationModeStatusChip`, `conversationModeEndButton`, `remoteMicStreamingConsentButton`, and mic/speaker status indicators.
- Per-tab frontend state map, e.g. `conversationModeByTab`.
- Web Speech provider implementation as a WebUI-only provider adapter registered with, or bridged to, the package:
  - `SpeechRecognition` / `webkitSpeechRecognition` for STT when available.
  - `speechSynthesis.speak(new SpeechSynthesisUtterance(text))` for browser TTS.
- Provider abstraction:

```ts
interface SttProvider {
  id: string;
  start(onFinalTranscript: (text: string) => void, onPartial?: (text: string) => void): Promise<void>;
  stop(): Promise<void>;
}

interface TtsProvider {
  id: string;
  speak(text: string, options?: { signal?: AbortSignal }): Promise<void>;
  stop(): void;
}
```

- Assistant-response TTS hook:
  - speak final assistant text on `message_end`/transcript refresh, not every token by default;
  - optional streaming TTS later, only after chunking/latency behavior is validated.
- Interrupt/barge-in handling:
  - detect when incoming speech occurs while assistant final text is streaming or TTS is speaking;
  - stop TTS immediately;
  - if the active Pi event stream is final text output, send the transcript as an interruption user turn as soon as possible;
  - if a tool call/execution is active, queue the transcript until tool execution ends and show a visible queued-interrupt state.
- Silence handling:
  - after assistant questions, start a silence timer only if conversation mode is still listening;
  - on timeout, send a short structured message such as: `[Conversation mode: the user stayed silent for 8s after your question. Treat this as possible confusion/discomfort/unneeded question; reframe, explain why you asked, or continue without pressuring the user.]`;
  - never infer sensitive intent from silence; present it as uncertainty.

### 6.4 WebUI backend integration

Files:

- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/webui-rpc-helper.mjs`

Add optional backend routes only when the package adapter is available, or return a clear `feature_unavailable` response when absent:

```text
GET  /api/features/natural-conversation
GET  /api/conversation-mode
POST /api/conversation-mode   { enabled, providerConfig? }
POST /api/stt/transcribe      multipart/webm|wav for API/local fallback STT
POST /api/tts/speech          optional API/local TTS fallback
```

Backend responsibilities:

- Treat WebUI state as an integration/cache layer; the package controller remains the source of truth for safety semantics.
- Do not fail WebUI startup if `pi-package-natural-conversation` cannot be resolved; mark the feature unavailable and keep normal WebUI behavior.
- Keep `tab.conversationMode` in `createTab()` state for WebUI tab scoping.
- Call the package adapter or hidden RPC helper action to enforce tool/thinking constraints.
- Reapply constraints after tab RPC restart/reload if `tab.conversationMode.enabled` is still true.
- Never store API keys in frontend; read provider credentials from env or server-side config.
- For remote WebUI, require explicit mic/privacy notice; default to localhost-only setup.
- Treat remote microphone streaming as a separate consent tier from normal remote WebUI access: a remote browser may capture audio locally, but sending raw audio to the Pi host or onward to API STT providers requires explicit consent, visible active indicators, and an easy stop button.

Expose package-backed helper actions through `webui-rpc-helper.mjs` only behind feature detection:

```json
{ "action": "conversation-mode-state" }
{ "action": "conversation-mode-set", "payload": { "enabled": true, "allowedTools": ["read", "grep", "find", "ls"] } }
```

The helper can use the package controller, `pi.setActiveTools()`, and `pi.setThinkingLevel("off")` inside the Pi RPC process. If the package is unavailable, helper actions should return a typed unavailable result instead of partially emulating conversation mode in WebUI.

### 6.5 Remote WebUI microphone privacy policy

`No direct remote microphone streaming unless remote access and privacy prompts are explicitly accepted` means:

- A user opening WebUI from another device/browser on the LAN is not automatically consenting to microphone capture.
- Browser permission alone is not enough, because it only authorizes the browser page to access the mic; Pi must still explain whether audio stays in the browser, is sent to the Pi host, or is sent to an external STT API.
- Default remote behavior should be safe: browser-local TTS is allowed after normal browser permission, but microphone capture and server/API STT remain disabled until the user accepts a Pi-specific prompt.
- Add an explicit consent button labeled **`Allow remote microphone streaming`**. It must remain disabled until the explanatory disclosure is visible, and clicking it grants consent only for the current tab/session.
- The disclosure near the button must name the active tab, provider, approximate data path, and stop controls. Example: `This will send microphone audio from this browser to Pi at 192.168.x.x for transcription by Groq/OpenAI/local STT. Audio snippets may leave your network if an API provider is selected.`
- The button copy should be action-specific, e.g. `Allow remote microphone streaming`, not a vague `OK`/`Continue`.
- Consent should be per tab and revocable; do not remember it silently across devices unless the user explicitly opts in.
- While remote mic mode is active, show a persistent red/amber indicator and `End conversation` button.

### 6.6 Package-owned native TUI extension

Package extension entry point:

```text
pi-package-natural-conversation/extensions/natural-conversation.ts
```

Responsibilities:

- Register `/talk` command and optional aliases.
- Work independently in native Pi TUI with no dependency on `pi-package-webui`.
- Apply the package-owned safety controller directly.
- Show TUI footer/status via `ctx.ui.setStatus("conversation", "Voice")` or equivalent package-supported status UI.
- Optional `ctx.ui.custom()` setup dialog using `SettingsList` for provider selection.
- Use local/API STT/TTS providers or an optional native audio companion for full audio; browser Web Speech is WebUI-only.

### 6.7 Model/tool safety policy

Default allowed tools in conversation mode:

```text
read, grep, find, ls
```

Optional additional read-only tools can be enabled only if explicitly approved:

```text
archwiki_search/extract/read, hyprwiki_search/extract/read, brave_search, web_search, fetch_content, note_read/list, memory_search
```

Do **not** enable by default:

```text
bash, edit, write, reverse_last, release/publish tools, package install/update tools, any tool with external side effects
```

Defense-in-depth:

1. Use `pi.setActiveTools(allowedTools)` on enable.
2. Add a `tool_call` event guard that blocks any non-allowlisted tool while mode is enabled.
3. Inject system guidance: "Conversation mode is read-only/nondestructive; answer conversationally; ask user to exit mode for edits, commands, installs, deletes, or publishing."
4. Re-apply `thinking = off` before every prompt.
5. Consider blocking or confirming explicit `!`/`!!` user-bash in WebUI while mode is enabled.

## 7. STT/TTS Provider Recommendations

### Recommended default stack

1. **WebUI first-use default:** Browser Web Speech API.
   - STT: `SpeechRecognition` / `webkitSpeechRecognition` where available.
   - TTS: `window.speechSynthesis`.
   - Cost: free.
   - Setup: browser permission only.
   - Caveat: recognition availability/privacy differs by browser and may use platform services.

2. **Best low-cost API STT fallback:** Cloudflare Workers AI Whisper or Groq Whisper.
   - Cloudflare Workers AI Whisper pricing evidence: `@cf/openai/whisper` at about `$0.0005/audio minute`, with daily free neuron allocation on Workers AI.
   - Groq pricing evidence: `whisper-large-v3-turbo` around `$0.04/hour transcribed`; `whisper-large-v3` around `$0.111/hour transcribed`.
   - OpenAI STT evidence: `gpt-4o-mini-transcribe` estimated around `$0.003/min`; `gpt-4o-transcribe` around `$0.006/min`.

3. **Best local/free stack:** whisper.cpp or Vosk for STT + Piper for TTS.
   - `whisper.cpp`: offline, high-performance Whisper inference; supports Linux, Windows, macOS, WebAssembly, CPU/GPU backends.
   - Vosk: offline streaming ASR, small language models, simple install, lightweight-device support.
   - Piper/OHF Piper: fast local neural TTS with CLI, HTTP API, Python API, C/C++ API.
   - Caveat: Piper moved to GPL-licensed OHF fork; confirm distribution/licensing implications before bundling.

### Candidate comparison

| Use case | STT recommendation | TTS recommendation | Why |
|---|---|---|---|
| Zero setup in browser | Web Speech API | Web Speech API | Free, fastest to ship, no server audio pipeline |
| Low-cost hosted | Cloudflare Workers AI or Groq Whisper | Browser TTS or Cloudflare/Deepgram TTS | Cheap STT; avoids local model setup |
| Better hosted quality | OpenAI `gpt-4o(-mini)-transcribe` | OpenAI TTS | Good docs/API; paid and key required |
| Fully local/private | whisper.cpp or Vosk | Piper | No per-minute cost; no audio leaves machine |
| Native TUI full audio | whisper.cpp/Vosk local companion | Piper local companion | TUI cannot use browser APIs |

## 8. Minimal Setup Flow

### WebUI setup wizard

Trigger on first toggle-on or from `Natural Conversation > Setup`:

1. Pick STT provider:
   - Browser Web Speech (default/free)
   - Cloudflare Workers AI
   - Groq Whisper
   - OpenAI transcription
   - Local whisper.cpp/Vosk endpoint
2. Pick TTS provider:
   - Browser SpeechSynthesis (default/free)
   - Piper local endpoint
   - OpenAI TTS
   - Cloudflare/Deepgram TTS
3. Pick language and voice.
4. Test microphone: record 3 seconds, transcribe, show transcript.
5. Test speaker: speak a short phrase.
6. Save non-secret config to `~/.pi/agent/voice.json`; use env vars for secrets.

Example env vars:

```sh
# Optional hosted providers
export OPENAI_API_KEY=...
export GROQ_API_KEY=...
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# Optional local endpoints
export PI_VOICE_STT_URL=http://127.0.0.1:8178/transcribe
export PI_VOICE_TTS_URL=http://127.0.0.1:8179/speech
```

### Native TUI setup wizard

`/talk setup` is owned by `pi-package-natural-conversation` and should use TUI `SettingsList` and provider tests. For phase 1, it may show:

```text
Native audio requires a local STT/TTS provider.
Recommended local setup: whisper.cpp or Vosk for STT, Piper for TTS.
```

Do not auto-install packages without explicit confirmation.

## 9. Implementation Phases

### Phase 0 — Finalize decisions

- Choose command name: `/talk` vs `/voice` vs `/conversation`.
- Choose default allowed tools and whether read-only web/search tools are included.
- Choose default turn-taking behavior: final-response TTS only vs streaming TTS.
- Choose interrupt semantics: abort-and-new-turn for final text output, queue-during-tools for tool phases.
- Choose silence timeout and whether silence events are enabled by default.
- Decide if native TUI phase 1 must include audio or only safe conversation mode.
- Confirm package name and resource layout, e.g. `pi-package-natural-conversation` with `extensions/natural-conversation.ts`.
- Decide whether WebUI discovers the package through Pi package metadata, dynamic import, extension registry state, or explicit config.

### Phase 1 — Standalone package, safety controller, and native command

- Create `pi-package-natural-conversation` with a `package.json` Pi manifest and package-local controller modules.
- Implement package-owned `/talk on/off/status/setup` for native Pi TUI.
- Store previous tools/thinking in memory.
- Force `thinking = off` and active tools to allowlist.
- Add `tool_call` block guard.
- Add footer/status indicator.
- Tests: command registration, tool allowlist, restoration, non-allowed tool block.

### Phase 2 — Optional WebUI feature and package integration

- Add feature detection for `pi-package-natural-conversation`.
- Add toggle in Common Pi options dropdown only when the feature is installed/enabled, or show disabled install guidance if that UX is chosen.
- Add `/api/features/natural-conversation` plus `/api/conversation-mode` routes that delegate to the package adapter/controller when available.
- Extend WebUI RPC helper to call the package controller and apply constraints in each tab.
- Preserve per-tab state across WebUI tab switches and Pi RPC reloads.
- Add frontend status labels and errors.
- Add highly visible active-mode UI: tab badge, composer/footer chip, active border/glow, mic/speaker state, persistent `End conversation` button, and remote-only `Allow remote microphone streaming` consent button.
- Tests: feature absent behavior, static selectors, endpoint behavior, tab scoping, reload reapply, active-mode visibility.

### Phase 3 — WebUI browser STT/TTS

- Implement browser Web Speech STT/TTS provider.
- First-use microphone permission flow.
- Send final transcripts through `sendPrompt("prompt", transcript)`.
- Speak assistant final answers.
- Add stop/pause/resume and echo prevention.
- Add final-output interruption handling and queue-during-tool behavior.
- Add silence timeout events after assistant questions.
- Tests: mock `SpeechRecognition`, mock `speechSynthesis`, transcript-to-prompt flow, TTS-on-answer flow, interrupt flow, silence-event flow.

### Phase 4 — Hosted/local provider fallbacks

- Implement `/api/stt/transcribe` for uploaded audio chunks.
- Implement optional `/api/tts/speech` for server-side TTS audio.
- Add provider config and setup tests.
- Add local endpoint adapter for whisper.cpp/Vosk/Piper.
- Add Cloudflare/Groq/OpenAI adapters only behind env-var availability checks.

### Phase 5 — Package-owned native full audio loop

- Add optional native voice companion inside or alongside `pi-package-natural-conversation`:
  - mic capture;
  - VAD/turn detection;
  - STT;
  - prompt dispatch;
  - TTS playback.
- Keep it opt-in; provide package-owned `/talk setup` diagnostics.

## 10. Progress Tracking

Track implementation progress in a committed Markdown file next to this plan:

```text
docs/webui/natural-conversation/NATURAL_CONVERSATION_MODE_PROGRESS.md
```

The progress file should be the implementation source of truth and updated whenever a phase starts, finishes, is blocked, or changes scope.

Recommended tracker format:

```md
# Natural Conversation Mode Progress

Last updated: YYYY-MM-DD
Owner/session: <name or agent/session id>
Current milestone: <phase and short goal>
Overall status: Not started | In progress | Blocked | Ready for review | Done

## Phase Status

| Phase | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| 0 — Decisions | Not started |  |  |  |
| 1 — Standalone package/native command | Not started |  |  |  |
| 2 — Optional WebUI integration | Not started |  |  |  |
| 3 — WebUI browser STT/TTS | Not started |  |  |  |
| 4 — Hosted/local fallbacks | Not started |  |  |  |
| 5 — Native full audio loop | Not started |  |  |  |

## Current Checklist

- [ ] Next concrete implementation task
- [ ] Next verification task
- [ ] Next documentation/update task

## Decisions

- YYYY-MM-DD — Decision — Rationale — Link/evidence

## Blockers

- Blocker — Impact — Needed decision/action — Owner

## Verification Log

- YYYY-MM-DD — Check/test/manual verification — Result — Evidence path/output
```

Status values:

- `Not started`: no implementation work beyond planning.
- `In progress`: code/docs/tests are actively changing.
- `Blocked`: progress requires a product, UX, safety, packaging, or provider decision.
- `Ready for review`: implementation is complete enough for review, but not accepted.
- `Done`: merged/accepted and verified.

Update rules:

1. Update `Last updated`, `Current milestone`, and `Overall status` on every implementation session.
2. For each completed task, link concrete evidence: file path, test name, command output, screenshot, or manual verification note.
3. Keep open decisions and blockers in the progress file until resolved; do not bury them in chat history.
4. When a phase is marked `Done`, all required tests for that phase must be listed in the verification log or explicitly deferred with a reason.
5. If scope changes, update this plan first, then update the progress file.

Initial phase status for this plan:

| Phase | Status | Notes |
|---|---|---|
| 0 — Decisions | Blocked | Needs command/package naming, WebUI optional-feature UX, discovery mechanism, allowlist, turn-taking, silence timeout, provider defaults. |
| 1 — Standalone package/native command | Not started | No package files created yet. |
| 2 — Optional WebUI integration | Not started | Requires Phase 1 package adapter contract or stub. |
| 3 — WebUI browser STT/TTS | Not started | Requires WebUI optional-feature shell. |
| 4 — Hosted/local fallbacks | Not started | Requires provider decisions and credential handling. |
| 5 — Native full audio loop | Not started | Requires native audio/provider architecture decision. |

## 11. Testing & Validation Plan

### Static/unit tests

- Package manifest test: `pi-package-natural-conversation/package.json` declares the extension through `pi.extensions` or conventional `extensions/` discovery.
- Native TUI independence test: `/talk on/off/status/setup` works when WebUI is not running.
- WebUI optional-feature test: WebUI starts cleanly without `pi-package-natural-conversation`; the toggle is hidden/disabled and routes return `feature_unavailable`.
- `native-parity.test.mjs`: include `/talk` if WebUI handles it through native command parity.
- WebUI DOM static test: `#optionsConversationModeToggle` is inside `#optionsMenu`, and active-mode controls include a persistent `#conversationModeEndButton` plus remote-only `#remoteMicStreamingConsentButton` outside the dropdown.
- Backend route tests: `/api/features/natural-conversation` reports availability; `/api/conversation-mode` delegates to the package adapter/controller when available, respects `tabId`, and does not alter other tabs.
- Helper/package-controller tests: active tools become exactly the allowlist; previous tools restore on disable.
- Guard tests: non-allowlisted tool calls are blocked while mode is enabled.
- Thinking tests: `set_thinking_level off` is applied on enable and before prompt.
- Interrupt tests: speech during final assistant text stops TTS and sends a new user turn; speech during tool execution is queued until the tool phase ends.
- Silence tests: no user response after an assistant question emits a structured silence event, but ordinary quiet periods do not.

### E2E/manual tests

1. Open WebUI with two tabs; enable mode in tab A only.
2. Verify tab A has thinking `off` and read-only tools; tab B unchanged.
3. Speak a prompt; transcript appears/sends; assistant responds; answer is spoken.
4. Try asking for a file edit; model should refuse/ask to exit mode; write/edit tools unavailable.
5. Disable mode; previous tools/thinking restore.
6. Reload tab A while mode is active; constraints reapply or mode clearly turns off.
7. Test browser unsupported STT fallback path.
8. While assistant final output is streaming, speak an interruption and verify TTS stops and a new user turn is sent.
9. While a tool call/execution is active, speak an interruption and verify it is queued, not injected into the tool phase.
10. Let an assistant question sit unanswered and verify the silence event causes reframing/explanation, not pressure or invented intent.
11. Enable remote WebUI and verify mic capture requires a Pi-specific privacy prompt, a visible `Allow remote microphone streaming` consent button, and persistent stop control.

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Browser STT not supported in Firefox/some Linux browser builds | High UX variance | Provider detection + clear setup fallback to API/local STT |
| Browser STT privacy ambiguity | User trust risk | First-use disclosure; local/API provider selector; never silently stream mic |
| TTS picked up by STT echo | Conversation loop | Pause mic while speaking; optional headphones/barge-in setting |
| Interrupting final output loses useful partial answer | UX/data loss risk | Preserve partial assistant text in transcript and include interruption context in the next turn |
| Interruption during tool execution creates inconsistent state | Safety/control-flow risk | Do not inject during tool calls; queue until tool phase ends and show visible queued status |
| Silence misinterpreted as user intent | UX/trust risk | Send silence as uncertain metadata only; instruct model to reframe/explain or continue without pressure |
| Other extension re-enables destructive tools | Safety risk | `tool_call` block guard plus reapply constraints before prompt |
| Thinking `off` unsupported by some provider/model semantics | Latency/cost risk | Use Pi `setThinkingLevel("off")`; show effective level from state; warn if not off |
| Native audio cross-platform complexity | Delivery risk | Ship WebUI voice first; TUI command safe-mode first; audio companion phase 5 |
| WebUI accidentally gains a hard dependency on the optional package | Packaging/reliability risk | Use feature detection, dynamic adapter loading, typed unavailable responses, and tests with package absent |
| API costs unexpectedly high | Cost risk | Show per-provider cost notes; default to free/browser/local; disable automatic API STT unless configured |
| Credentials leaked to browser/session | Security risk | env/server-side config only; no transcript logging of keys; no browser key storage |
| Remote WebUI mic exposure | Privacy/security risk | Require explicit remote/PIN/trust notices; prefer localhost-only for setup |

## 13. Source Evidence

### Local Pi/WebUI evidence

- `pi-package-webui/public/index.html` — existing Common Pi options dropdown.
- `pi-package-webui/public/app.js` — menu wiring, prompt dispatch, state rendering, event handling.
- `pi-package-webui/bin/pi-webui.mjs` — per-tab Pi RPC processes, `/api/prompt`, `/api/thinking`, pending thinking, native slash command handling.
- `pi-package-webui/webui-rpc-helper.mjs` — WebUI hidden helper uses `pi.setActiveTools()` and persists `/tools` state.
- `pi-extension-tools/index.ts` — native `/tools` command pattern for TUI active-tool management.
- Pi docs: `docs/packages.md` — Pi packages can bundle extensions via package manifest or conventional directories.
- Pi docs: `docs/extensions.md` — `pi.registerCommand`, `pi.setActiveTools`, `pi.setThinkingLevel`, `tool_call` guards, TUI status/widgets.
- Pi docs: `docs/sdk.md` — `setThinkingLevel`, selected tools, read-only tool setup, RPC/session control.

### External speech/provider evidence

- MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- OpenAI speech-to-text docs: https://platform.openai.com/docs/guides/speech-to-text
- OpenAI text-to-speech docs: https://platform.openai.com/docs/guides/text-to-speech
- OpenAI API pricing: https://platform.openai.com/docs/pricing
- Groq speech-to-text docs: https://console.groq.com/docs/speech-to-text
- Groq pricing: https://groq.com/pricing
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cloudflare Whisper model: https://developers.cloudflare.com/workers-ai/models/whisper/
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- Piper/OHF Piper: https://github.com/OHF-Voice/piper1-gpl
- Vosk: https://alphacephei.com/vosk/

## 14. Recommended Initial Defaults

- Package: standalone `pi-package-natural-conversation` with package-owned native extension.
- WebUI integration: optional feature; WebUI must work without the package installed/enabled.
- Command: `/talk`.
- WebUI label: `Natural Conversation`.
- STT default: Browser Web Speech if supported; otherwise setup prompt.
- TTS default: Browser SpeechSynthesis.
- Tool allowlist: `read`, `grep`, `find`, `ls` only.
- Thinking: force `off` on enable and before every prompt.
- TTS mode: speak final assistant answer only in v1.
- Turn-taking: pause listening while assistant speaks, but support user interruption during final text/TTS output; queue interruptions during tool phases.
- Active UI: show a persistent highlighted voice status and `End conversation` button while enabled; show `Allow remote microphone streaming` before remote mic capture/server-side STT.
- Silence: after assistant questions, send an uncertain silence event after timeout so the model can reframe/explain/continue.
- Persistence: per tab/process memory only; no session persistence unless user opts in later.

## 15. Important Decision Questions

### Usability

1. Should the package be named `pi-package-natural-conversation`, `pi-extension-natural-conversation`, or another npm/package name?
2. Should WebUI hide the Natural Conversation menu item when the optional package is absent, or show a disabled item with install guidance?
3. Should WebUI discover the optional package through Pi package metadata, dynamic import, extension registry state, or explicit config?
4. Should the command be `/talk`, `/voice`, `/conversation`, or should multiple aliases be supported?
5. Should WebUI enable voice immediately on toggle, or always open a first-use setup wizard?
6. Should mode stay active after browser reload / Pi tab restart, or should it reset to off for safety?
7. Should transcripts be inserted visibly into the composer first, or sent automatically after final STT result?
8. Should partial transcripts be shown live while listening?

### User experience

7. Should assistant speech start only after a complete response, or stream sentence-by-sentence for lower latency?
8. Should user speech interrupt assistant TTS (`barge-in`) or should mic stay paused until speaking finishes?
9. Should interruption during final text output abort the active stream immediately, or wait for sentence/paragraph boundary?
10. How long should silence after an assistant question wait before sending a silence event: 5s, 8s, 12s, adaptive?
11. Should there be a push-to-talk fallback/hotkey even in automatic mode?
12. Should the mode use concise spoken answers by default, even if the current Pi style is detailed?
13. Should TTS read tool/error cards, or only natural-language assistant text?

### Safety and interactions

14. Is `read, grep, find, ls` the correct default nondestructive tool allowlist?
15. Are external read-only tools like `web_search`, `brave_search`, and wiki tools allowed in conversation mode by default?
16. Should skills stay enabled, or should conversation mode hide skills that mention writes, package releases, shell commands, or destructive workflows?
17. Should explicit user `!` / `!!` bash be disabled or confirmed while conversation mode is active?
18. On disabling mode, should previous tools/thinking always restore, or should Pi keep the current safe settings if the user changed them manually?

### Provider/setup

19. Should local/private providers be prioritized over browser/API providers even if setup is harder?
20. Which hosted STT should be the preferred low-cost fallback: Cloudflare Workers AI, Groq, or OpenAI?
21. Is GPL-licensed Piper acceptable as a recommended local TTS dependency, or should it remain optional documentation only?
22. Should API provider cost estimates be shown in the setup UI before enabling automatic transcription?
23. Should remote WebUI users be allowed to use mic/audio at all, or localhost-only by default?
24. If remote mic is allowed, should consent be remembered per device, per tab, per session, or never remembered?
