# Multi-Model Roundtable Extension Plan

Goal: enable two or more models to talk to each other in Pi WebUI, with a design that can also work in the native Pi TUI.

## Recommendation

Build this as a **shared orchestration core** plus two frontends:

1. **Pi extension core**: `/roundtable` commands, turn scheduler, model/session adapters, persistence.
2. **WebUI companion integration**: split-pane UI and tab/session orchestration.
3. **Native TUI mode**: same orchestration, but rendered as widgets, overlays, and transcript messages instead of real split panes.

For true isolation, prioritize **Option 2: multiple sessions** first. “Multiple models in one Pi session” is useful, but isolation is weaker unless hidden SDK sub-sessions are used.

---

## Package Shape

Suggested package name:

```text
@firstpick/pi-extension-roundtable
```

Suggested commands:

```text
/roundtable start
/roundtable next
/roundtable auto
/roundtable pause
/roundtable stop
/roundtable status
/roundtable export
/roundtable attach-tabs
```

Core state model:

```ts
type Participant = {
  id: "a" | "b" | "c" | "d";
  name: string;
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  systemPrompt?: string;
  sessionMode: "shared-session" | "webui-tab" | "sdk-hidden-session";
  tools: "none" | "read-only" | "full" | string[];
};

type RoundtableState = {
  id: string;
  mode: "shared" | "split-sessions" | "moderated" | "pipeline";
  status: "idle" | "running" | "paused" | "stopped" | "error";
  participants: Participant[];
  activeSpeakerId?: string;
  turnIndex: number;
  maxTurns: number;
  turnPolicy: "round-robin" | "moderator" | "vote" | "manual";
  transcript: RoundtableTurn[];
};
```

---

## Option 1: Multiple Models in One Visible Session

### How It Works

One Pi session is the visible transcript. The extension controls whose turn it is and switches the active model before each automated turn.

Flow:

1. User starts `/roundtable start`.
2. Extension asks for participants/models.
3. Extension stores state using `pi.appendEntry()`.
4. On each turn:
   - lock active speaker
   - call `pi.setModel(participantModel)`
   - inject a strict turn prompt
   - wait for `agent_end`
   - validate response belongs to the active speaker
   - advance to next speaker

### Turn Prompt Template

```text
You are participant {{name}} in a multi-model roundtable.

Rules:
- Speak only as {{name}}.
- Do not roleplay or answer as another participant.
- Produce exactly one turn.
- Do not continue the conversation after your own answer.
- If you want another participant to respond, end with: NEXT: {{participantId}}.
```

### Pros

- Simple to build.
- Works in native TUI immediately.
- Uses normal Pi session history and export.

### Cons

- Weaker isolation: every model sees the same session context.
- Model-change entries accumulate.
- Control prompts become part of the session unless carefully hidden or summarized.
- Models can still be influenced by previous models’ wording.

### Best Use

Brainstorming, lightweight debates, and “Claude vs GPT” style comparison.

---

## Option 2: Two to Four Independent Sessions in WebUI Split View

### How It Works

Each participant is a separate WebUI tab / Pi RPC process with its own session file, model, tools, and context. A coordinator drives turns between tabs.

This is the strongest design.

For 2–4 sessions:

```text
2 sessions:
┌─────────────┬─────────────┐
│ Session A   │ Session B   │
└─────────────┴─────────────┘

3 sessions:
┌─────────────┬─────────────┐
│ Session A   │ Session B   │
│             ├─────────────┤
│             │ Session C   │
└─────────────┴─────────────┘

4 sessions:
┌─────────────┬─────────────┐
│ Session A   │ Session B   │
├─────────────┼─────────────┤
│ Session C   │ Session D   │
└─────────────┴─────────────┘
```

“First split vertical, then horizontal” maps well to two columns, then row splits inside columns.

### Backend Integration

Use existing WebUI primitives:

- `POST /api/tabs` to create tabs.
- `POST /api/model` to set each tab’s model.
- `POST /api/prompt`, `/api/follow-up`, `/api/steer` to advance turns.
- `GET /api/events?tab=<id>` SSE to wait for `agent_end`.
- `GET /api/messages` to read each tab’s latest assistant response.

Relevant files:

- `pi-package-webui/bin/pi-webui.mjs` — tab/RPC backend.
- `pi-package-webui/public/app.js` — tab UI state and rendering.
- `pi-package-webui/public/styles.css` — split layout.
- Existing tab grouping logic can be reused but needs a stronger “roundtable group” concept.

### Turn Isolation

Each tab receives only bounded shared context:

```text
Shared roundtable transcript since your last turn:
...

You are {{participantName}}.
Respond with one turn only.
```

Each session keeps its own private context, tool history, and model settings.

### Pros

- Best isolation.
- Cleanest model comparison.
- Each model can use different context/tools.
- Easy to inspect individual reasoning/output per tab.
- WebUI is already multi-tab/process oriented.

### Cons

- Requires WebUI changes, not just a pure Pi extension.
- Native TUI cannot literally split panes unless using tmux or a custom overlay.
- More complex error/abort handling.

### Best Use

Serious model debates, reviewer/executor workflows, red-team/blue-team loops, and independent context experiments.

---

## Native TUI Support

Native TUI should use the same orchestrator but render differently:

- Status line: current speaker, round, mode.
- Widget above editor: compact transcript and turn queue.
- Optional overlay: participant table and controls.
- Commands:
  - `/roundtable next`
  - `/roundtable auto 6`
  - `/roundtable pause`
  - `/roundtable stop`

For split-session mode in native TUI, use hidden SDK sessions or subprocess/RPC sessions and show a merged transcript. Real visual splitting should be WebUI-only or tmux-based.

---

## Turn System

Core rule: **only the orchestrator may advance turns**.

State machine:

```text
idle
  → preparing_turn
  → speaker_running
  → collecting_response
  → validating_response
  → committing_turn
  → next_turn | paused | stopped | error
```

Guards:

- One active speaker at a time.
- No concurrent prompts to the same session.
- If a tab/session is busy, queue or pause.
- Validate speaker identity.
- Stop on max turns, explicit `STOP`, moderator decision, or user pause.
- Abort should stop the active session first, then pause the roundtable.

---

## Other Recommended Modes

### 1. Moderator Mode

Add a cheap/fast moderator model that decides who speaks next and summarizes rounds.

Good for:

- avoiding infinite debates
- extracting consensus
- deciding when to stop

Turn order:

```text
User → Model A → Model B → Moderator → A/B/... → Moderator summary
```

### 2. Pipeline Mode

Instead of free conversation, assign roles:

```text
Architect → Implementer → Reviewer → Fixer → Summarizer
```

This is probably the most useful coding workflow.

### 3. Judge/Vote Mode

After N rounds, each model gives:

```text
Verdict:
Confidence:
Risks:
Recommended answer:
```

Then a judge model or user picks the final result.

### 4. Shared Blackboard

Maintain one canonical shared artifact:

```text
.roundtable/<id>/transcript.md
.roundtable/<id>/claims.md
.roundtable/<id>/decision.md
```

Models contribute to the blackboard instead of only chatting. This helps prevent context drift.

---

## Implementation Phases

### Phase 1 — Core TUI/shared-session prototype

- Add `/roundtable` command.
- Support 2–4 participants.
- Implement round-robin turns.
- Switch model per turn with `pi.setModel()`.
- Persist state with custom session entries.
- Render status/widget in TUI and WebUI RPC widget.

### Phase 2 — WebUI split-session mode

- Add backend “roundtable group” state.
- Create/attach 2–4 tabs.
- Add split-pane layout.
- Drive turns via tab-scoped RPC calls.
- Show active speaker, locked/busy states, transcript merge.

### Phase 3 — Strong isolation SDK mode

- Use hidden `AgentSession`s per participant.
- Store only merged transcript in the visible Pi session.
- Allow per-participant tools/context/model settings.

### Phase 4 — Advanced workflows

- Moderator mode.
- Pipeline templates.
- Voting/judge mode.
- Cost/token budgets.
- Export to Markdown/JSONL.

---

## Safety Defaults

Recommended defaults:

- Max turns: `8`
- Tools: disabled for all participants by default
- File mutation: only one “executor” participant may use write/edit/bash
- Auto mode: asks confirmation before first run
- WebUI LAN: warn if remote clients can control the roundtable
- Cost guard: stop after configurable token/cost threshold

---

## Best First Build

Recommended build order:

1. **Core orchestrator + `/roundtable` in native TUI**
2. **WebUI compact roundtable panel**
3. **WebUI split-session layout**
4. **Moderator/pipeline modes**

This gives a useful extension quickly, while keeping the WebUI split architecture clean and not overfitting the first version.
