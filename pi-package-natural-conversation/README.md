# Natural Conversation Mode for Pi

Adds a voice-friendly conversation mode with strict limits on what Pi can do while listening.

## What you can do

- Lets you speak to Pi and hear spoken answers, including barge-in for long replies.
- Temporarily limits Pi to safer tools while listening.
- Supports microphone, speech recognition, and spoken replies.
- Provides setup and device checks before normal use.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-package-natural-conversation
```

Restart Pi if the package does not appear in your current session.

## How to use it

Start with these commands:

- `/talk setup` — choose audio providers, test devices, and review privacy consent.
- `/talk on` — enter conversation safe mode and start audio when configured.
- `/talk off` — stop audio and restore the previous Pi settings.
- `/talk pause` / `/talk resume` — pause or continue listening.
- `/talk doctor` — check the microphone, speaker, speech recognition, and speech output.
- `/talk status` — show the current conversation and audio state.

## Before you start

Start with `/talk setup`. It walks through microphone, speech-to-text, text-to-speech, privacy consent, and a quick device check. Native audio currently targets Linux and needs PipeWire, PulseAudio, ALSA, or FFmpeg audio tools. Speech recognition needs a configured local or hosted STT provider; spoken replies need Piper, `espeak-ng`, or another configured local or hosted TTS provider. Secrets are not stored in the voice settings file.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-natural-conversation/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
