# Shoo Authentication

Add or troubleshoot Google sign-in through Shoo in a browser application.

## Helpful when

- You are adding Shoo sign-in to a new app.
- The sign-in callback or session check fails.
- The browser and server disagree about whether a user is signed in.

## What to share with Pi

- The relevant app and server code
- The exact sign-in problem or desired flow
- Error messages with secrets removed

## Try asking

> Help me add Shoo Google sign-in to this app. Check the callback, session handling, and server-side identity verification.

## What you’ll get

- A clear sign-in flow
- Likely causes for broken authentication
- Implementation or fix steps with checks

## Keep in mind

The shipped workflow identifies itself as a draft. Verify current Shoo documentation and adoption risk before production use, and never paste passwords, private keys, or live access tokens into the request.

## Install

```bash
pi install npm:@firstpick/pi-skill-shoo-auth
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-shoo-auth/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
