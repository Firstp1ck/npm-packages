# Questionnaires for Pi

Lets Pi ask clear single- and multiple-choice questions in the terminal and Web UI.

## What you can do

- Shows clear single-choice and multiple-choice questions.
- Works in both the Pi terminal and Web UI.
- Supports an “Other” answer when fixed options are not enough.
- Lets Pi explain a question and resume without losing earlier answers.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-package-questionnaire
```

Restart Pi if the package does not appear in your current session.

## How to use it

Ask Pi to present a decision as a questionnaire and provide the choices you want shown. For example:

> Ask me which environments to deploy to. Let me choose more than one from Development, Staging, and Production.

Answer in the terminal or Web UI. Pi resumes the original task with your selected result.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-questionnaire/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
