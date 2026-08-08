# Workbook for Pi

Lets Pi inspect and carefully edit `.xlsx` and `.xlsm` Excel workbooks with visual checks and validation.

## What you can do

- Inspects `.xlsx` and `.xlsm` workbooks without changing them.
- Renders sheets so formatting can be checked visually.
- Edits selected cells and workbook content through a guarded workflow.
- Checks workbook structure and compares the saved result before it is accepted.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-workbook
```

Requires Node.js 24 or newer. Restart Pi if the package does not appear in your current session.

## How to use it

Attach or reference the `.xlsx` or `.xlsm` file, then describe the result you want.

> Inspect this workbook, correct the totals in the Summary sheet, preserve the formatting, and show me the validation result.

Start with inspection or rendering, review the proposed cell changes, and keep the edited file only after the final comparison and validation are satisfactory.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-workbook/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
