# Technical reference: Btw for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md)

Ephemeral side questions and transcript-based status summaries for Pi.

## What it does

- Adds `/btw <question>` for questions that should not be appended to the main conversation.
- Adds `/btw-status` for a concise summary of the current goal, completed and active work, remaining todos and next step, and blockers or uncertainty.
- Does not expose tools to either side request.
- In the TUI, shows the answer in a centered overlay with scrolling and dismiss keys.
- In Pi Web UI, starts the request in the background and streams into a non-blocking live output card.

## Install

```bash
pi install npm:@firstpick/pi-extension-btw
```

## Commands

### `/btw <question>`

```text
/btw what was the config file name again?
```

The first `/btw` request snapshots the current main-session branch transcript. Later `/btw` requests keep using that snapshot together with the accumulated side questions and answers, forming one continuous side thread for the active Pi session. The side conversation is not automatically appended to the main conversation.

### `/btw-status`

```text
/btw-status
```

`/btw-status` takes no required arguments. It asks the selected model for a concise summary based only on transcript evidence, covering the current goal, completed work, active work, remaining todos and next step, and blockers or uncertainty. Missing or uncertain information should be identified rather than invented.

Every invocation starts a fresh side request and snapshots the current main-session branch transcript at that time. It does not inherit the persistent `/btw` side-thread snapshot or earlier `/btw` turns, and its answer is not appended to the main conversation. Active status requests are aborted when the Pi session shuts down.

Both commands require a selected model and valid provider authentication.

## Display behavior

In the TUI, `/btw` and `/btw-status` use the same centered BTW overlay and stream the answer as it is generated. Status requests appear as **Current session, goal, and todo status** under a `/btw session status` title rather than displaying the internal model prompt.

TUI keys while the overlay is open:

- `↑` / `↓` — scroll
- `PageUp` / `PageDown` — scroll faster
- `Home` / `End` — jump to top/bottom
- `Enter`, `Space`, `Esc`, `Ctrl+C` — close the overlay; if the side request is still running, it is aborted

In Pi Web UI RPC mode, both commands stream into the BTW live output card while the composer remains usable. Status cards, footer text, and transferred status context use the concise display label rather than the internal model prompt. Starting a newer BTW request replaces the active card updates from an older request.

The Web UI card includes **Transfer Context**, which can bring a selected side answer into the main session as steering context. If the main agent is actively running, transferred context is injected after its next action.

Repeated questions submitted from the card stay in the persistent `/btw` side thread for the active Pi session. Concurrent submissions are serialized so each follow-up sees the completed earlier answer. `/btw-status` remains a fresh transcript snapshot on every invocation.

## Privacy and provider usage

`/btw` and `/btw-status` make separate requests to your selected model provider. The request includes main-session transcript context, so do not use these commands when that context should not be sent to the provider. Provider token usage and charges still apply; `/btw-status` may resend the current transcript each time you invoke it.

These requests have no tool access. They cannot inspect files, run commands, or verify state outside the transcript, so a status summary can only report evidence already present in the conversation. Answers remain outside the main transcript unless you explicitly transfer relevant context.
