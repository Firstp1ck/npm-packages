# Subagent Minimum Fanout for Pi

Prevents unsafe one-off delegation patterns and checks reviewer model diversity.

## What you can do

- Blocks unsupported one-worker delegation patterns.
- Requires enough isolated writers when delegated editing is used.
- Checks reviewer provider diversity when required.
- Explains why a delegation request was rejected.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-subagent-minimum-fanout
```

Restart Pi if the package does not appear in your current session.

## How to use it

There is no setup for everyday use. The extension checks delegation requests automatically.

If a request is blocked, read the explanation shown by Pi. It normally tells the main agent to do the work directly or to divide genuinely separate work across enough safe, isolated workers. You do not need to correct the tool request yourself.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-subagent-minimum-fanout/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
