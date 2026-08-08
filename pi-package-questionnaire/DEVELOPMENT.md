# Development guide: Questionnaires for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

| Part | Purpose |
| --- | --- |
| Extension (`index.ts`) | Registers the sequential `questionnaire` tool with a strict, provider-compatible schema. |
| Runtime (`src/runtime.ts`) | Normalization, state machine, native dialog adapter, branch-scoped clarification resume, deterministic rendering. |
| Skill (`skills/questionnaire`) | Routing and usage rules for agents, including the mandatory clarification-resume behavior. |
## Tool contract

One tool, `questionnaire`, with two actions.

### `start`

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

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable, unique per questionnaire. Returned in the answers. |
| `label` | no | Short progress label; defaults to `id`. |
| `prompt` | yes | The question text shown to the user. |
| `type` | yes | `single` or `multi`. |
| `options[].id` | yes | Stable, unique within the question. |
| `options[].label` | yes | Visible text. |
| `options[].description` | no | Short clarifying text appended to the label. |
| `allowOther` | no | Defaults to `true`; adds a custom text answer. |
| `minSelections` / `maxSelections` | no | `multi` only; rejected on `single` questions. `minSelections` defaults to `0`; set it to `1` when an empty answer is not useful. Both count `Other` as one choice. |

### `resume`

```json
{
  "action": "resume",
  "questionnaireId": "3f2a6f2c-1d47-4c2b-9a0e-1f7c9d1a55b1",
  "revision": 1,
  "clarificationResponse": "Production deploys need an approved release window; staging does not."
}
```

`resume` never carries `questions`. The stored snapshot on the session branch is authoritative and cannot be replaced by the model.

## Validation

```bash
cd pi-package-questionnaire
npm test          # deterministic runtime, state/resume, and skill-contract tests
npm run check     # Node TypeScript-stripping syntax checks
npm pack --dry-run --json
```

The test suite drives the runtime with scripted native dialogs in both `tui` and `rpc` modes, asserts that only `select`/`input` are used, and checks that this README and the bundled skill stay aligned with the runtime's actual limits, statuses, and markers.

## Preserved detailed implementation reference

Native, resumable questionnaires for the Pi coding agent.

`@firstpick/pi-package-questionnaire` gives Pi one `questionnaire` tool that asks 1–20 structured single-select or multi-select questions through Pi's **native** dialog primitives. It adds no new RPC message type, no browser-side state, and no custom protocol: it uses only `ctx.ui.select()` and `ctx.ui.input()`, so it behaves correctly in the TUI and in the WebUI at the same time.

It also ships a `questionnaire` skill that tells the agent when to ask, how to phrase questions, and — importantly — how to answer and resume when the user pauses to ask Pi something mid-questionnaire.

## Installation

Installation is a **separate, explicit action**. Adding this package to the repository does not enable it; the tool stays inert until you install it yourself.

```bash
pi install npm:@firstpick/pi-package-questionnaire
```

Reload or restart Pi afterwards. To remove it again:

```bash
pi remove npm:@firstpick/pi-package-questionnaire
```

Requires Node.js >= 22.19.0 and a Pi installation that provides `@earendil-works/pi-coding-agent` and `typebox` (declared as peer dependencies).

## How it feels to the user

Questions are asked **one at a time**, in order, using the dialogs Pi already has.

### In the TUI

Each question is a native Pi selector. The standard keybindings apply:

| Key | Action |
| --- | --- |
| `Up` / `Down` | Move the selection |
| `PageUp` / `PageDown` | Page through long option lists |
| `Enter` | Confirm the highlighted entry |
| `Escape` / `Ctrl+C` | Cancel the dialog |

`Other…` and `Ask Pi to clarify…` open a native text input.

### In the WebUI

The same calls travel over the existing `extension_ui_request` / `extension_ui_response` RPC path. The WebUI renders every option as an ordinary **mouse-clickable button** and returns the exact clicked string; text input is a normal field with Submit and Cancel. No keyboard navigation is required, and no WebUI change is needed.

### Multi-select

Multi-select reopens the same native selector after every toggle. Each option shows `[x]` or `[ ]`, and a `Continue with N selection(s)` entry commits the question. This keeps one shared code path for TUI and WebUI; an all-at-once checkbox form is deliberately **not** implemented, because it would require a new Pi RPC/core protocol.

## Results

Tool-result details are versioned (`version: 1`) and contain the questionnaire ID, revision, current question index, the normalized question snapshot, accumulated answers, any multi-select draft, and the clarification history. The human-readable text begins with an explicit status marker.

| Status | Marker | Meaning |
| --- | --- | --- |
| `completed` | `QUESTIONNAIRE_COMPLETED` | Every question was answered. |
| `needs_clarification` | `QUESTIONNAIRE_NEEDS_CLARIFICATION` | The user asked Pi a question first. |
| `cancelled` | `QUESTIONNAIRE_CANCELLED` | `cancellationReason` is `user_cancelled` or `aborted`. |
| `unavailable` | `QUESTIONNAIRE_UNAVAILABLE` | `cancellationReason` is `ui_unavailable` or `ui_error`. |

Answers keep the original question and option order:

```json
{
  "questionId": "checks",
  "selectedOptionIds": ["unit", "lint"],
  "other": "contract tests"
}
```

For a `single` question answered through `Other…`, `selectedOptionIds` is empty and only `other` is set. For `multi`, `other` is additive and counts toward the selection bounds.

Malformed arguments, an unknown questionnaire ID, a stale revision, or a corrupt stored snapshot raise explicit tool errors rather than silently starting over.

## Clarification sequence

The user can pick `Ask Pi to clarify…` at any question without losing prior answers or the current multi-select toggles.

1. The tool returns `needs_clarification` with the immutable question snapshot, the answers so far, an opaque `questionnaireId`, and an incremented `revision` (starting at 1).
2. The agent answers the user's request in normal text.
3. The agent calls `questionnaire` again with `action: "resume"` and only `questionnaireId`, `revision`, and `clarificationResponse`.
4. The tool loads the latest matching `questionnaire` result on the **active session branch** and reopens the exact same question with prior state intact.

Clarification can repeat; each suspension increments the revision. The bundled skill makes explain-then-resume mandatory and forbids restarting or inferring the pending answer.

## Limits and known constraints

- 1–20 questions per questionnaire; 1–50 options per question.
- Text bounds: IDs ≤128 chars, labels ≤200, prompts and `Other` answers ≤2000, option descriptions ≤500, clarification text ≤1000.
- Resume works on the same session branch only. Cross-session or cross-branch transfer of a questionnaire ID is not supported.
- State is persisted at tool-result boundaries. Toggles made inside an open dialog are lost if the process dies before a result exists.
- Multi-select uses repeated native dialogs, not a single checkbox form (see above).
- No timeout is imposed on human dialogs.
- `select()` returns `undefined` in non-interactive modes; the tool then reports `unavailable` instead of hanging or guessing.

## Privacy

- Answers are normal tool results. They are visible to the model and are persisted with the session and its branch, exactly like any other tool output.
- The package does not log, copy, or export answers anywhere else.
- There is **no secret-input guarantee**. Do not use this tool for passwords, API keys, or tokens — including through the `Other` field.

## License

MIT — see [LICENSE](LICENSE).
