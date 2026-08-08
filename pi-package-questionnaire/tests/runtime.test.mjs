import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import questionnaireExtension, {
  LIMITS,
  QuestionnaireParameters,
  createQuestionnaireRuntime,
  normalizeQuestions,
  normalizeToolInput,
} from "../index.ts";

const single = (id, overrides = {}) => ({
  id,
  label: `Label ${id}`,
  prompt: `Choose ${id}`,
  type: "single",
  options: [{ id: `${id}-a`, label: "Alpha" }, { id: `${id}-b`, label: "Beta" }],
  allowOther: false,
  ...overrides,
});

const multi = (id, overrides = {}) => ({
  id,
  label: `Label ${id}`,
  prompt: `Choose ${id}`,
  type: "multi",
  options: [{ id: `${id}-a`, label: "Alpha" }, { id: `${id}-b`, label: "Beta" }],
  allowOther: true,
  minSelections: 1,
  maxSelections: 3,
  ...overrides,
});

function choose(fragment, occurrence = 0) {
  return ({ options }) => {
    const matches = options.filter((option) => option.includes(fragment));
    assert.ok(matches.length > occurrence, `expected choice containing ${JSON.stringify(fragment)} in ${JSON.stringify(options)}`);
    return matches[occurrence];
  };
}

function typeText(value) {
  return ({ kind }) => {
    assert.equal(kind, "input");
    return value;
  };
}

function fixture(script, { mode = "tui", hasUI = true, branch = [] } = {}) {
  const calls = [];
  let cursor = 0;
  const run = async (kind, title, options, opts) => {
    calls.push({ kind, title, options, opts });
    const step = script[cursor++];
    assert.notEqual(step, undefined, `unexpected ${kind} call: ${title}`);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step({ kind, title, options: options ?? [], opts, calls }) : step;
  };
  return {
    calls,
    done() { assert.equal(cursor, script.length, `unused scripted steps: ${script.length - cursor}`); },
    ctx: {
      mode,
      hasUI,
      ui: {
        select: (title, options, opts) => run("select", title, options, opts),
        input: (title, placeholder, opts) => run("input", title, [placeholder], opts),
      },
      sessionManager: { getBranch: () => branch },
    },
  };
}

function branchResult(details) {
  return {
    type: "message",
    id: "result-entry",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "questionnaire",
      content: [{ type: "text", text: "persisted" }],
      details,
      isError: false,
      timestamp: 0,
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

const runtime = () => createQuestionnaireRuntime({ createId: () => "questionnaire-test-id" });

async function executeStart(questions, script, options) {
  const ui = fixture(script, options);
  const result = await runtime()({ action: "start", questions }, undefined, ui.ctx);
  ui.done();
  return { result, calls: ui.calls };
}

test("registers exactly one sequential Google-compatible questionnaire tool", () => {
  const tools = [];
  questionnaireExtension({ registerTool: (tool) => tools.push(tool) });
  assert.equal(tools.length, 1);
  const [tool] = tools;
  assert.equal(tool.name, "questionnaire");
  assert.equal(tool.executionMode, "sequential");
  assert.ok(tool.promptSnippet.includes("questionnaire"));
  assert.ok(tool.promptGuidelines.some((line) => line.includes("QUESTIONNAIRE_NEEDS_CLARIFICATION")));
  assert.deepEqual(QuestionnaireParameters.properties.action.enum, ["start", "resume"]);
  assert.equal(QuestionnaireParameters.additionalProperties, false);
  const questionSchema = QuestionnaireParameters.properties.questions.items;
  assert.equal(questionSchema.additionalProperties, false);
  assert.deepEqual(questionSchema.properties.type.enum, ["single", "multi"]);
  assert.equal(questionSchema.properties.options.items.additionalProperties, false);
  assert.equal("anyOf" in QuestionnaireParameters.properties.action, false);
});

test("package metadata declares runtime and future skill resources with shared test discovery", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.match(manifest.scripts.test, /tests\/\*\.test\.mjs/);
  assert.ok(manifest.files.includes("skills"));
  assert.equal(manifest.files.includes("plans"), false);
});

test("normalizes bounded input and rejects malformed start/resume XOR and question contracts", () => {
  const normalized = normalizeToolInput({ action: "start", questions: [single(" q ", { label: undefined, allowOther: undefined })] });
  assert.equal(normalized.questions[0].id, "q");
  assert.equal(normalized.questions[0].label, "q");
  assert.equal(normalized.questions[0].allowOther, true);

  const invalid = [
    {},
    { action: "start" },
    { action: "start", questions: [single("q")], revision: 1 },
    { action: "resume", questionnaireId: "id", revision: 1, clarificationResponse: "ok", questions: [single("q")] },
    { action: "resume", questionnaireId: "id", revision: 0, clarificationResponse: "ok" },
    { action: "resume", questionnaireId: "id", revision: 1, clarificationResponse: " " },
    { action: "start", questions: [] },
    { action: "start", questions: [single("q"), single(" q ")] },
    { action: "start", questions: [single("q", { options: [{ id: "x", label: "X" }, { id: " x ", label: "Y" }] })] },
    { action: "start", questions: [single("q", { type: "invalid" })] },
    { action: "start", questions: [single("q", { minSelections: 0 })] },
    { action: "start", questions: [multi("q", { minSelections: 3, maxSelections: 2 })] },
    { action: "start", questions: [multi("q", { maxSelections: 4 })] },
    { action: "start", questions: [single("q", { prompt: "x".repeat(LIMITS.prompt + 1) })] },
    { action: "start", questions: [single("q", { unknown: true })] },
  ];
  for (const value of invalid) assert.throws(() => normalizeToolInput(value), /questionnaire:/);
  assert.throws(() => normalizeQuestions(Array.from({ length: LIMITS.questions + 1 }, (_, i) => single(`q${i}`))), /1-20/);
});

test("completes single choices and maps duplicate visible Unicode labels by exact generated display", async () => {
  const question = single("unicode-✓", {
    label: "同じ",
    options: [
      { id: "first", label: "同じ", description: "説明" },
      { id: "second", label: "同じ", description: "説明" },
    ],
  });
  const { result, calls } = await executeStart([question], [({ options }) => {
    assert.deepEqual(options, [
      "01. 同じ — 説明",
      "02. 同じ — 説明",
      "Ask Pi to clarify…",
      "Cancel questionnaire",
    ]);
    assert.equal(new Set(options).size, options.length);
    return "02. 同じ — 説明";
  }]);
  assert.equal(result.details.status, "completed");
  assert.deepEqual(result.details.answers, [{ questionId: "unicode-✓", selectedOptionIds: ["second"] }]);
  assert.match(result.content[0].text, /QUESTIONNAIRE_COMPLETED/);
  assert.match(result.content[0].text, /optionIds=\[second\]/);
  assert.equal(calls.every((call) => call.kind === "select"), true);
});

test("single Other returns custom text without an option ID and blank input returns to the question", async () => {
  const { result } = await executeStart([
    single("q", { allowOther: true }),
  ], [choose("Other…"), typeText("   "), choose("Other…"), typeText(" custom answer ")]);
  assert.deepEqual(result.details.answers, [{ questionId: "q", selectedOptionIds: [], other: "custom answer" }]);
});

test("multi rows use exact two-digit selected and unselected strings while mapping display values to IDs", async () => {
  const question = multi("q", {
    allowOther: false,
    maxSelections: 2,
    options: [
      { id: "alpha-id", label: "Alpha", description: "First choice" },
      { id: "beta-id", label: "Beta" },
    ],
  });
  const { result } = await executeStart([question], [
    ({ options }) => {
      assert.deepEqual(options.slice(0, 2), ["01. [ ] Alpha — First choice", "02. [ ] Beta"]);
      return "01. [ ] Alpha — First choice";
    },
    ({ options }) => {
      assert.deepEqual(options.slice(0, 2), ["01. [x] Alpha — First choice", "02. [ ] Beta"]);
      return "Continue with 1 selection(s)";
    },
  ]);
  assert.deepEqual(result.details.answers, [{ questionId: "q", selectedOptionIds: ["alpha-id"] }]);
});

test("multi toggle loop enforces bounds and supports add/change/remove Other", async () => {
  const { result, calls } = await executeStart([
    multi("q", { minSelections: 1, maxSelections: 2 }),
  ], [
    ({ options }) => {
      assert.match(options[0], /Alpha/, "the first highlighted multi-select row should be a real option, not Continue");
      return options.find((option) => option.includes("Continue with 0"));
    },
    choose("Alpha"),
    choose("Add Other"),
    typeText("first custom"),
    choose("Change Other"),
    typeText("changed custom"),
    choose("Beta"),
    choose("Remove Other"),
    choose("Beta"),
    choose("Alpha"),
    choose("Continue with 1"),
  ]);
  assert.equal(result.details.status, "completed");
  assert.deepEqual(result.details.answers, [{ questionId: "q", selectedOptionIds: ["q-b"] }]);
  assert.ok(calls.some((call) => call.title.includes("Cannot continue")));
  assert.ok(calls.some((call) => call.title.includes("maximum 2")));
});

test("cancelled Other input preserves the current multi selection", async () => {
  const { result } = await executeStart([multi("q")], [
    choose("Alpha"),
    choose("Add Other"),
    () => undefined,
    choose("Continue with 1"),
  ]);
  assert.deepEqual(result.details.answers, [{ questionId: "q", selectedOptionIds: ["q-a"] }]);
});

test("over-limit native text is explained and reprompted without losing questionnaire state", async () => {
  const longOther = "x".repeat(LIMITS.prompt + 1);
  const longClarification = "y".repeat(LIMITS.clarification + 1);

  const singleResult = await executeStart([single("single", { allowOther: true })], [
    choose("Other…"),
    typeText(longOther),
    ({ kind, title }) => {
      assert.equal(kind, "input");
      assert.match(title, new RegExp(`at most ${LIMITS.prompt}`));
      return "short answer";
    },
  ]);
  assert.deepEqual(singleResult.result.details.answers, [{ questionId: "single", selectedOptionIds: [], other: "short answer" }]);

  const multiResult = await executeStart([multi("multi")], [
    choose("Alpha"),
    choose("Add Other"),
    typeText(longOther),
    ({ kind, title }) => {
      assert.equal(kind, "input");
      assert.match(title, new RegExp(`at most ${LIMITS.prompt}`));
      return "short custom";
    },
    choose("Continue with 2"),
  ]);
  assert.deepEqual(multiResult.result.details.answers, [{ questionId: "multi", selectedOptionIds: ["multi-a"], other: "short custom" }]);

  const clarificationResult = await executeStart([single("clarify")], [
    choose("Ask Pi to clarify"),
    typeText(longClarification),
    ({ kind, title }) => {
      assert.equal(kind, "input");
      assert.match(title, new RegExp(`at most ${LIMITS.clarification}`));
      return "What is the difference?";
    },
  ]);
  assert.equal(clarificationResult.result.details.status, "needs_clarification");
  assert.equal(clarificationResult.result.details.clarificationRequest, "What is the difference?");
});

test("clarification at a middle multi question persists prior answers and draft toggles, then resumes", async () => {
  const questions = [single("first"), multi("middle"), single("last")];
  const initial = fixture([
    choose("Alpha"),
    choose("Beta"),
    choose("Ask Pi to clarify"),
    typeText("What does Beta mean?"),
  ], { mode: "rpc" });
  const suspended = await runtime()({ action: "start", questions }, undefined, initial.ctx);
  initial.done();
  assert.equal(suspended.details.status, "needs_clarification");
  assert.equal(suspended.details.revision, 1);
  assert.equal(suspended.details.currentQuestionIndex, 1);
  assert.deepEqual(suspended.details.answers, [{ questionId: "first", selectedOptionIds: ["first-a"] }]);
  assert.deepEqual(suspended.details.draftAnswer, { questionId: "middle", selectedOptionIds: ["middle-b"] });
  assert.match(suspended.content[0].text, /Explain the requested point, then call questionnaire resume/);

  const resumedUi = fixture([
    choose("Alpha"),
    choose("Continue with 2"),
    choose("Beta"),
  ], { mode: "rpc", branch: [branchResult(suspended.details)] });
  const resumed = await runtime()({
    action: "resume",
    questionnaireId: suspended.details.questionnaireId,
    revision: 1,
    clarificationResponse: "Beta is the second choice.",
  }, undefined, resumedUi.ctx);
  resumedUi.done();
  assert.equal(resumed.details.status, "completed");
  assert.deepEqual(resumed.details.answers, [
    { questionId: "first", selectedOptionIds: ["first-a"] },
    { questionId: "middle", selectedOptionIds: ["middle-a", "middle-b"] },
    { questionId: "last", selectedOptionIds: ["last-b"] },
  ]);
  assert.equal(resumed.details.clarifications[0].response, "Beta is the second choice.");
  assert.equal(resumedUi.calls.every((call) => call.kind === "select"), true);
});

for (const location of [0, 1, 2]) {
  test(`clarification suspends and resumes the exact single question at location ${location + 1}`, async () => {
    const questions = [single("q1"), single("q2"), single("q3")];
    const before = Array.from({ length: location }, () => choose("Alpha"));
    const suspendedUi = fixture([...before, choose("Ask Pi to clarify"), typeText(`clarify-${location}`)]);
    const suspended = await runtime()({ action: "start", questions }, undefined, suspendedUi.ctx);
    assert.equal(suspended.details.currentQuestionIndex, location);
    assert.equal(suspended.details.answers.length, location);

    const remaining = Array.from({ length: questions.length - location }, () => choose("Beta"));
    const resumedUi = fixture(remaining, { branch: [branchResult(suspended.details)] });
    const resumed = await runtime()({ action: "resume", questionnaireId: suspended.details.questionnaireId, revision: 1, clarificationResponse: "explained" }, undefined, resumedUi.ctx);
    assert.equal(resumed.details.status, "completed");
    assert.equal(resumed.details.answers[location].questionId, questions[location].id);
    assert.deepEqual(resumed.details.answers[location].selectedOptionIds, [`q${location + 1}-b`]);
  });
}

test("a resumed questionnaire may suspend again with an incremented revision and complete later", async () => {
  const firstUi = fixture([choose("Ask Pi to clarify"), typeText("first request")]);
  const first = await runtime()({ action: "start", questions: [single("q")] }, undefined, firstUi.ctx);
  const secondUi = fixture([choose("Ask Pi to clarify"), typeText("second request")], { branch: [branchResult(first.details)] });
  const second = await runtime()({ action: "resume", questionnaireId: first.details.questionnaireId, revision: 1, clarificationResponse: "first response" }, undefined, secondUi.ctx);
  assert.equal(second.details.revision, 2);
  assert.equal(second.details.clarifications[0].response, "first response");
  assert.equal(second.details.clarifications[1].request, "second request");
  const finalUi = fixture([choose("Alpha")], { branch: [branchResult(second.details)] });
  const final = await runtime()({ action: "resume", questionnaireId: second.details.questionnaireId, revision: 2, clarificationResponse: "second response" }, undefined, finalUi.ctx);
  assert.equal(final.details.status, "completed");
  assert.equal(final.details.clarifications[1].response, "second response");
});

test("resume rejects unknown IDs, stale revisions, non-active results, and corrupt snapshots", async () => {
  const suspendedUi = fixture([choose("Ask Pi to clarify"), typeText("request")]);
  const suspended = await runtime()({ action: "start", questions: [single("q")] }, undefined, suspendedUi.ctx);
  const args = { action: "resume", questionnaireId: suspended.details.questionnaireId, revision: 1, clarificationResponse: "answer" };

  await assert.rejects(runtime()(args, undefined, fixture([], { branch: [] }).ctx), /unknown questionnaire ID/);
  await assert.rejects(runtime()({ ...args, revision: 2 }, undefined, fixture([], { branch: [branchResult(suspended.details)] }).ctx), /stale revision/);

  const completed = clone(suspended.details);
  completed.status = "completed";
  await assert.rejects(runtime()(args, undefined, fixture([], { branch: [branchResult(completed)] }).ctx), /not awaiting clarification/);

  const corrupt = clone(suspended.details);
  corrupt.currentQuestionIndex = 99;
  await assert.rejects(runtime()(args, undefined, fixture([], { branch: [branchResult(corrupt)] }).ctx), /stored state is corrupt/);

  const corruptHistory = clone(suspended.details);
  corruptHistory.clarifications[0].revision = 9;
  await assert.rejects(runtime()(args, undefined, fixture([], { branch: [branchResult(corruptHistory)] }).ctx), /stored state is corrupt/);

  const multiUi = fixture([choose("Alpha"), choose("Beta"), choose("Continue with 2"), choose("Ask Pi to clarify"), typeText("request")]);
  const withPriorMulti = await runtime()({ action: "start", questions: [multi("multi"), single("q")] }, undefined, multiUi.ctx);
  const corruptOrder = clone(withPriorMulti.details);
  corruptOrder.answers[0].selectedOptionIds.reverse();
  await assert.rejects(runtime()({ action: "resume", questionnaireId: corruptOrder.questionnaireId, revision: 1, clarificationResponse: "answer" }, undefined, fixture([], { branch: [branchResult(corruptOrder)] }).ctx), /option IDs are out of order/);
});

test("latest matching active-branch result is authoritative", async () => {
  const firstUi = fixture([choose("Ask Pi to clarify"), typeText("first")]);
  const first = await runtime()({ action: "start", questions: [single("q")] }, undefined, firstUi.ctx);
  const newer = clone(first.details);
  newer.revision = 2;
  newer.clarificationRequest = "newer";
  newer.clarifications[0].response = "first response";
  newer.clarifications.push({ revision: 2, questionId: "q", request: "newer" });
  const branch = [branchResult(first.details), branchResult(newer)];
  await assert.rejects(runtime()({ action: "resume", questionnaireId: first.details.questionnaireId, revision: 1, clarificationResponse: "answer" }, undefined, fixture([], { branch }).ctx), /latest revision is 2/);
});

test("distinguishes user cancellation, abort, unavailable mode, and UI failure", async () => {
  const cancelled = await executeStart([single("q")], [() => undefined]);
  assert.equal(cancelled.result.details.status, "cancelled");
  assert.equal(cancelled.result.details.cancellationReason, "user_cancelled");

  const preAborted = new AbortController();
  preAborted.abort();
  const noCalls = fixture([]);
  const aborted = await runtime()({ action: "start", questions: [single("q")] }, preAborted.signal, noCalls.ctx);
  assert.equal(aborted.details.cancellationReason, "aborted");
  assert.equal(noCalls.calls.length, 0);

  const duringAbort = new AbortController();
  const abortUi = fixture([() => { duringAbort.abort(); return undefined; }]);
  const interrupted = await runtime()({ action: "start", questions: [single("q")] }, duringAbort.signal, abortUi.ctx);
  assert.equal(interrupted.details.cancellationReason, "aborted");
  assert.equal(abortUi.calls[0].opts.signal, duringAbort.signal);

  const unavailableUi = fixture([], { mode: "print", hasUI: false });
  const unavailable = await runtime()({ action: "start", questions: [single("q")] }, undefined, unavailableUi.ctx);
  assert.equal(unavailable.details.status, "unavailable");
  assert.equal(unavailable.details.cancellationReason, "ui_unavailable");

  const failedUi = fixture([new Error("transport closed")], { mode: "rpc" });
  const failed = await runtime()({ action: "start", questions: [single("q")] }, undefined, failedUi.ctx);
  assert.equal(failed.details.status, "unavailable");
  assert.equal(failed.details.cancellationReason, "ui_error");
  assert.doesNotMatch(failed.content[0].text, /transport closed/);
});

test("TUI and RPC use the same native select/input controller without custom protocol calls", async () => {
  for (const mode of ["tui", "rpc"]) {
    const ui = fixture([choose("Other…"), typeText("native")], { mode });
    const result = await runtime()({ action: "start", questions: [single("q", { allowOther: true })] }, undefined, ui.ctx);
    assert.equal(result.details.status, "completed");
    assert.deepEqual(ui.calls.map((call) => call.kind), ["select", "input"]);
  }
});

test("result snapshots are detached from caller input and deterministic in question order", async () => {
  const questions = [single("q1"), single("q2")];
  const { result } = await executeStart(questions, [choose("Beta"), choose("Alpha")]);
  questions[0].options[1].label = "mutated";
  assert.equal(result.details.questions[0].options[1].label, "Beta");
  assert.deepEqual(result.details.answers.map((answer) => answer.questionId), ["q1", "q2"]);
});
