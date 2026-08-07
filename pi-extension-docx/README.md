# DOCX for Pi

Lets Pi inspect and carefully edit Word documents while keeping validation and rollback in the workflow.

## What you can do

- Inspects Word documents without changing them.
- Renders pages so layout can be checked visually.
- Edits selected content through a guarded workflow.
- Compares and validates the result before it is accepted.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-docx
```

Restart Pi if the package does not appear in your current session.

## How to use it

Give Pi the Word document and describe the outcome you want. Start with inspection or rendering, review the proposed edits, then ask Pi to validate the changed document.

## Before you start

Document editing requires Node.js 24+, .NET 8, and a local document renderer such as ONLYOFFICE Desktop Editors or LibreOffice. See the technical reference for the one-time engine build.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-docx/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
