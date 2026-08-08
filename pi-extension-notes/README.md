# Notes for Pi

Keep small local notes inside Pi and optionally use selected notes as operating rules.

## What you can do

- Creates, reads, updates, and deletes local notes.
- Finds notes even when you remember only part of the title.
- Keeps notes in a simple local folder.
- Can optionally make selected rule notes available to Pi.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-notes
```

Restart Pi if the package does not appear in your current session.

## How to use it

- `/note` — create a note in your normal text editor.
- `/note Shopping ideas :: Compare local backup drives` — save a short note directly.
- `/note-list` — browse notes, newest first.
- `/note-read <title or search words>` — open the closest matching note.
- `/note-update` — change a note’s title or content.
- `/note-delete` — select a note and confirm deletion.

Rule notes are optional. Enable them only when you intentionally want their instructions to guide Pi. Direct title/content shortcuts and storage details are listed in the technical reference.

## Before you start

No setup is required. Notes are stored locally in your Pi agent directory. Rule injection is optional and disabled unless you enable it.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-notes/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
