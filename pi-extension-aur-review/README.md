# AUR Review for Pi

Adds a careful review checkpoint before selected Git changes move forward.

## What you can do

- Reviews the exact Git changes you selected.
- Keeps approval tied to that unchanged snapshot.
- Shows findings before commit or release work continues.
- Works with guided Git flows in Pi Web UI.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-aur-review
```

Restart Pi if the package does not appear in your current session.

## How to use it

Stage or select changes in the active Git repository, then start `/aur-review` or the matching guided Git action. Despite the historical package name, the review works with ordinary repositories as well as AUR packaging work. Fix or accept the findings before continuing with commit or release work.

- `/aur-review` or `/aur-review start [--report path]` — create a standalone `working-tree` review.
- `/aur-review start --scope staged --origin guided-git` — create the canonical Guided Git review for exactly the current index.
- `/aur-review refresh` — create a new snapshot using the stored scope/origin after remediation.
- `/aur-review status` — show the record and whether a pending snapshot remains current.
- `/aur-review approve` — requires Pi-native confirmation and approves only the exact snapshot.
- `/aur-review decline` — requires non-empty multiline editor comments, records the decline, and sends constrained remediation instructions.
- `/aur-review close` — hides/archives the card; never approves anything.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-aur-review/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
