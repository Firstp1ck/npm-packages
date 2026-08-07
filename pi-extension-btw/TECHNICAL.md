# Technical reference: Btw for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md)

Ephemeral `/btw` side questions for Pi.

## What it does

- Adds `/btw <question>` as a Pi extension command.
- Starts from the current session transcript, then preserves later `/btw` questions and answers as one continuous side thread without appending them to the main conversation.
- Does not expose tools to the side request.
- In the TUI, shows the answer in a centered overlay with scrolling and dismiss keys.
- In Pi Web UI RPC mode, starts the side request in the background and streams into a non-blocking live output widget.

## Install

```bash
pi install npm:@firstpick/pi-extension-btw
```

## Usage

```text
/btw what was the config file name again?
```

TUI keys while the overlay is open:

- `↑` / `↓` — scroll
- `PageUp` / `PageDown` — scroll faster
- `Home` / `End` — jump to top/bottom
- `Enter`, `Space`, `Esc`, `Ctrl+C` — close the overlay; if the side request is still running, it is aborted

## Web UI integration

When loaded inside `@firstpick/pi-package-webui`, `/btw` publishes structured updates through extension UI widgets using the `btw:output` and `btw:footer` widget keys. The Web UI renders the answer as a release-style live output card, so the composer remains usable while the side answer streams.

The Web UI card includes **Transfer Context**, which calls `/btw-transfer` to append the selected side question and answer as a displayed custom message in the main session. Transferred context is included in later main-chat model context. If the main agent is actively running, the transfer is delivered as live steering and injected after the next agent action.

Repeated questions from the card stay in the same `/btw` side thread for the lifetime of the active Pi session. Follow-up questions therefore receive the earlier side questions and answers as normal conversational context. Concurrent submissions are serialized so each follow-up sees the completed answer before it.

## Notes

`/btw` makes separate model requests. It keeps the main transcript clean, but it is not free: provider token usage still applies. The first request snapshots the current branch transcript; later requests reuse that snapshot plus the accumulated `/btw` turns until the active Pi session is replaced.
