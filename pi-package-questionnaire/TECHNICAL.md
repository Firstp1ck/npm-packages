# Technical reference: Questionnaires for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Requirements and installation

Requires Node.js 22.19 or newer and a compatible Pi installation.

```bash
pi install npm:@firstpick/pi-package-questionnaire
```

Restart or reload Pi afterward. Remove it with:

```bash
pi remove npm:@firstpick/pi-package-questionnaire
```

## How questions appear

Questions are shown one at a time in their original order.

Terminal controls:

| Key | Action |
| --- | --- |
| `Up` / `Down` | Move between choices |
| `PageUp` / `PageDown` | Move through long lists |
| `Enter` | Confirm the highlighted choice |
| `Escape` / `Ctrl+C` | Cancel |

The Web UI shows the same choices as clickable buttons. “Other” opens a text field when custom answers are allowed.

For multiple-choice questions, select or clear options one at a time, then choose **Continue with N selections**.

## Clarification

A questionnaire can pause when you choose **Ask Pi to clarify…**. Pi answers the question in normal text and then returns to the same questionnaire item without discarding earlier answers.

Clarification can happen more than once. The pending question cannot be silently replaced or answered on your behalf.

## Result states

- **Completed** — every required question was answered.
- **Needs clarification** — the questionnaire is paused while Pi explains something.
- **Cancelled** — you cancelled the dialog or stopped the flow.
- **Unavailable** — the current mode cannot display the questionnaire.

Invalid or outdated resume attempts return an error instead of silently starting over.

## Limits

- Up to 20 questions in one questionnaire
- Up to 50 choices for each question
- Questions are resumed only in the same Pi session branch
- An open, unfinished dialog cannot survive the Pi process ending
- No automatic timeout is applied while waiting for a person
- Non-interactive Pi modes report the questionnaire as unavailable

## Privacy

Answers become part of the Pi session just like other tool results. The package does not copy or export them elsewhere.

Questionnaire text is not a secret-input field. Do not enter passwords, API keys, access tokens, private keys, or other credentials.

## Troubleshooting

- If no dialog appears, confirm the package is installed and the current Pi mode supports interactive dialogs.
- If resume is rejected, return to the same session branch where the questionnaire started.
- If a multiple-choice answer cannot continue, check the minimum and maximum choices stated by the question.
