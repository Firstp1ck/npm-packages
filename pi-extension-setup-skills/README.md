# Setup Skills for Pi

Choose which local Pi skills are enabled from one interactive list.

![Interactive skill manager](https://unpkg.com/@firstpick/pi-extension-setup-skills/images/setup_skills_v0.1.3.png)

## What you can do

- Lists locally available skills in one selector.
- Shows which skills are currently enabled.
- Lets you enable or disable several skills together.
- Saves the resulting skill selection for Pi.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-setup-skills
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/skills`, select the skills you want available, and save the selection. Reopen it whenever you want to change the enabled set.

- `/skills`
- `↑` / `↓`: navigate
- `Enter` / `Space`: toggle selected skill
- Type: search/filter
- `Esc` or `q`: cancel
- `Ctrl+S`: save
The command updates Pi settings and prompts for `/reload` after changes.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-setup-skills/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
