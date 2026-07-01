# @firstpick/pi-package-natural-conversation

Safe first slice of Pi Natural Conversation Mode.

This package currently provides the native `/talk` command family and the safety controller needed before audio is added.

## Commands

```text
/talk             # toggle mode
/talk on          # enable mode
/talk off         # disable mode and restore previous tools/thinking
/talk status      # show current mode constraints
/talk setup       # explain phase-1 native audio status
```

Aliases are also registered:

```text
/voice
/conversation
```

## Phase 1 behavior

When enabled, the package:

- stores current active tools and thinking level in process memory;
- forces thinking level to `off`;
- limits active tools to `read`, `grep`, `find`, and `ls`;
- blocks non-allowlisted tool calls defensively;
- blocks `!`/`!!` user shell commands;
- appends concise read-only spoken-response guidance to the system prompt;
- shows a `Voice: listening` footer status when UI is available.

When disabled, it restores the previous active tools and thinking level where still available.

Full microphone/STT/TTS loops are intentionally not implemented in this first slice.

## Install

```bash
pi install npm:@firstpick/pi-package-natural-conversation
```

For local development from this monorepo:

```bash
pi -e ./pi-package-natural-conversation
```

## Verification

```bash
npm test --prefix pi-package-natural-conversation
```
