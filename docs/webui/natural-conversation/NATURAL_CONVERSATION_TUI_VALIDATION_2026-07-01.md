# Natural Conversation TUI Validation — 2026-07-01

Goal: validate the standalone package-owned `/talk` command family in a live Pi runtime.

## Runtime commands

Interactive TUI smoke was run through a pseudo-terminal with `expect`:

```sh
PI_OFFLINE=1 pi --offline --no-session --no-context-files --no-skills --no-prompt-templates --no-themes --no-extensions \
  -e ./pi-package-natural-conversation \
  --tools read,bash,write,edit,grep,find,ls \
  --thinking high
```

The harness sent:

```text
/talk status
/talk on
/talk status
/talk setup
/talk off
/talk status
/quit
```

A second validation used Pi RPC mode with the same extension/runtime flags and sent the same `/talk ...` prompts, then inspected `extension_ui_request` events and final `get_state`.

## Observed evidence

TUI smoke evidence included:

```text
[Extensions]
  natural-conversation.ts
Natural Conversation Mode: off
Natural Conversation Mode on. Thinking is off; tools limited to: read, grep, find, ls.
(openai-codex) gpt-5.5 • thinking off
Voice: listening
Natural Conversation Mode: off
```

RPC evidence included:

```text
commands: conversation, talk, voice
/talk status -> Natural Conversation Mode: off
/talk on -> Natural Conversation Mode on. Thinking is off; tools limited to: read, grep, find, ls.
/talk status -> Natural Conversation Mode: listening; thinking: off; tools: read, grep, find, ls
/talk setup -> Natural Conversation setup (phase 1): native safe-mode controls are available now; full native microphone/speaker audio needs a local STT/TTS provider in a later phase; current safe defaults: thinking off; tools limited to read, grep, find, ls.
/talk off -> Natural Conversation Mode off. Restored previous thinking/tools where available.
/talk status -> Natural Conversation Mode: off
final get_state thinkingLevel: high
```

## Result

Passed for the standalone native command family:

- `/talk`, `/voice`, and `/conversation` were registered by the package extension.
- `/talk status` reported off before enable and off after disable.
- `/talk on` forced thinking off and limited tools to `read`, `grep`, `find`, `ls`.
- `Voice: listening` status was emitted while enabled.
- `/talk setup` displayed the phase-1 native audio/provider guidance.
- `/talk off` restored the previous thinking level (`high`) in the RPC validation.

## Caveats

- This was an automated pseudo-terminal/RPC validation, not a human-driven manual terminal session.
- Browser/WebUI tab runtime validation remains separate and pending.
- Full native microphone/speaker audio remains out of Phase 1 scope.
