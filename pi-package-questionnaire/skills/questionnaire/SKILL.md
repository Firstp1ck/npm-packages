---
name: questionnaire
description: Collect structured single-select and multi-select answers from the user through the native questionnaire tool instead of long free-text question lists. Use when a task needs several related choices (scope, options, priorities, configuration, preferences) before work can continue, when the user asks to be asked in a menu/form/dialog, or when a questionnaire result returns QUESTIONNAIRE_NEEDS_CLARIFICATION and must be answered and resumed. Do not use for secrets, credentials, free-form open questions, or a single trivial yes/no that plain text answers better.
license: MIT
---

# Questionnaire

Ask related structured questions in **one** native dialog flow and read the answers back as stable IDs.

The `questionnaire` tool runs Pi's native selector and text-input dialogs sequentially. It works in the TUI (Up/Down + Enter) and in the WebUI (options are ordinary clickable buttons).

## When to use

Use `questionnaire` when:

- two or more related choices must be settled before work can continue;
- the choices have a known, bounded option set you can name;
- the user asked to be prompted with a menu, list, form, or dialog;
- a prior `questionnaire` result returned `QUESTIONNAIRE_NEEDS_CLARIFICATION`.

Do **not** use `questionnaire` when:

- the question is genuinely open-ended and better answered in prose;
- one trivial confirmation is enough — just ask in normal text;
- you are requesting secrets, passwords, tokens, or other credentials;
- you already have the answer in context, or can determine it by reading files or running a read-only command.

Never invent a questionnaire to look thorough. Ask only what actually changes what you will do.

## Question design rules

1. **Combine.** Put every related question into one `start` call. Do not run several sequential questionnaires for one decision.
2. **Stable IDs.** Give each question and option a stable, descriptive, non-empty `id` (`deploy_target`, `target_staging`). IDs are what you read back; labels are only display text.
3. **Unique IDs.** Question IDs must be unique in the call; option IDs must be unique within their question.
4. **Concise text.** Short `label`, one clear `prompt` sentence, and an optional short `description` per option only when the label is not self-explanatory.
5. **Honest types.** Use `single` when exactly one answer is valid, `multi` when several are. Do not fake multi-select with several single questions.
6. **Realistic bounds.** A `multi` question defaults to `minSelections: 0`; set `minSelections: 1` whenever an empty answer is not useful. Set `maxSelections` only when the task needs a ceiling. Selection bounds are rejected on `single` questions.
7. **Other.** `allowOther` defaults to `true`. Set it to `false` when a custom answer is meaningless or unusable.
8. **Bounded size.** 1–20 questions, 1–50 options per question, IDs ≤128 chars, labels ≤200, prompts ≤2000, option descriptions ≤500.

## Start call

Send only `action` and `questions`:

```json
{
  "action": "start",
  "questions": [
    {
      "id": "deploy_target",
      "label": "Target",
      "prompt": "Which environment should this release go to?",
      "type": "single",
      "options": [
        { "id": "staging", "label": "Staging" },
        { "id": "production", "label": "Production", "description": "Requires an approved release window" }
      ],
      "allowOther": false
    },
    {
      "id": "checks",
      "label": "Pre-flight checks",
      "prompt": "Which checks must pass before the deploy?",
      "type": "multi",
      "options": [
        { "id": "unit", "label": "Unit tests" },
        { "id": "e2e", "label": "End-to-end tests" },
        { "id": "lint", "label": "Lint and types" }
      ],
      "minSelections": 1,
      "maxSelections": 3
    }
  ]
}
```

## Reading results

The tool result text starts with a status marker and the questionnaire ID and revision:

| Marker | Meaning | What to do |
| --- | --- | --- |
| `QUESTIONNAIRE_COMPLETED` | All questions answered | Use the answers and continue the task |
| `QUESTIONNAIRE_NEEDS_CLARIFICATION` | User asked Pi something first | Explain, then resume immediately (see below) |
| `QUESTIONNAIRE_CANCELLED` | User cancelled, or the call was aborted | Stop; ask in normal text what to do next |
| `QUESTIONNAIRE_UNAVAILABLE` | No usable interactive UI | Ask the same questions in normal text instead |

Answers come back as `{ questionId, selectedOptionIds, other? }` in the original question order:

- `selectedOptionIds` holds option IDs in their declared order.
- `other` holds the trimmed custom answer when the user supplied one.
- For a `single` question answered with Other, `selectedOptionIds` is empty and only `other` is set.
- For a `multi` question, `other` is additive: it does not replace selected option IDs and it counts as one choice against `minSelections` / `maxSelections`.

Treat cancelled and unavailable as real user outcomes. Never guess the answers the user did not give.

## Clarification is mandatory

When the result is `QUESTIONNAIRE_NEEDS_CLARIFICATION`, the user paused at one question to ask you something. The prior answers and the current multi-select toggles are already stored.

You must:

1. Answer the user's request in normal assistant text, concretely and briefly.
2. Immediately call `questionnaire` again with `action: "resume"` and **only** `questionnaireId`, `revision`, and `clarificationResponse` copied from that result.

```json
{
  "action": "resume",
  "questionnaireId": "3f2a6f2c-1d47-4c2b-9a0e-1f7c9d1a55b1",
  "revision": 1,
  "clarificationResponse": "Production deploys need an approved release window; staging does not."
}
```

Hard rules:

- Never resend `questions` on resume — the stored snapshot is authoritative and cannot be replaced.
- Never start a new questionnaire to recover from a clarification request; that loses the user's prior answers.
- Never infer, assume, or fabricate the pending answer; the user still has to choose.
- Use the exact `questionnaireId` and the exact `revision` from the latest result. A stale or unknown pair is an error.
- Keep `clarificationResponse` a concise summary (≤1000 characters) of the explanation you just gave.
- Do not end your turn after a clarification result without resuming.

Clarification can repeat: each request returns a new, higher revision. Answer and resume each time.

## Privacy and safety

- Answers are ordinary tool results: they are visible to the model and persisted with the session and its branch.
- Never use `questionnaire` to collect passwords, API keys, tokens, or other secrets, including via the Other field.
- Do not copy answers into logs, files, or external systems unless the user asked for that.
- Resume only works on the same session branch that produced the clarification result.
