import { randomUUID } from "node:crypto";

export const QUESTIONNAIRE_DETAILS_VERSION = 1 as const;

export const LIMITS = Object.freeze({
  questions: 20,
  options: 50,
  id: 128,
  label: 200,
  prompt: 2_000,
  description: 500,
  clarification: 1_000,
});

export type QuestionType = "single" | "multi";
export type QuestionnaireStatus = "completed" | "needs_clarification" | "cancelled" | "unavailable";
export type CancellationReason = "user_cancelled" | "aborted";

export interface QuestionnaireOptionInput {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionnaireQuestionInput {
  id: string;
  label?: string;
  prompt: string;
  type: QuestionType;
  options: QuestionnaireOptionInput[];
  allowOther?: boolean;
  minSelections?: number;
  maxSelections?: number;
}

export interface QuestionnaireStartInput {
  action: "start";
  questions: QuestionnaireQuestionInput[];
}

export interface QuestionnaireResumeInput {
  action: "resume";
  questionnaireId: string;
  revision: number;
  clarificationResponse: string;
}

export type QuestionnaireInput = QuestionnaireStartInput | QuestionnaireResumeInput;

export interface NormalizedOption {
  id: string;
  label: string;
  description?: string;
}

export interface NormalizedQuestion {
  id: string;
  label: string;
  prompt: string;
  type: QuestionType;
  options: NormalizedOption[];
  allowOther: boolean;
  minSelections: number;
  maxSelections: number;
}

export interface QuestionnaireAnswer {
  questionId: string;
  selectedOptionIds: string[];
  other?: string;
}

export interface ClarificationRecord {
  revision: number;
  questionId: string;
  request: string;
  response?: string;
}

export interface QuestionnaireDetails {
  version: typeof QUESTIONNAIRE_DETAILS_VERSION;
  status: QuestionnaireStatus;
  questionnaireId: string;
  revision: number;
  currentQuestionIndex: number;
  questions: NormalizedQuestion[];
  answers: QuestionnaireAnswer[];
  draftAnswer?: QuestionnaireAnswer;
  clarifications: ClarificationRecord[];
  clarificationRequest?: string;
  cancellationReason?: CancellationReason | "ui_unavailable" | "ui_error";
}

export interface QuestionnaireResult {
  content: Array<{ type: "text"; text: string }>;
  details: QuestionnaireDetails;
}

export interface NativeQuestionnaireUi {
  select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
  input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
}

export interface QuestionnaireContext {
  hasUI: boolean;
  mode: string;
  ui: NativeQuestionnaireUi;
  sessionManager: { getBranch(fromId?: string): unknown[] };
}

interface ActiveState {
  questionnaireId: string;
  revision: number;
  currentQuestionIndex: number;
  questions: NormalizedQuestion[];
  answers: QuestionnaireAnswer[];
  draftAnswer?: QuestionnaireAnswer;
  clarifications: ClarificationRecord[];
}

interface RuntimeOptions {
  createId?: () => string;
}

const START_KEYS = new Set(["action", "questions"]);
const RESUME_KEYS = new Set(["action", "questionnaireId", "revision", "clarificationResponse"]);
const QUESTION_KEYS = new Set(["id", "label", "prompt", "type", "options", "allowOther", "minSelections", "maxSelections"]);
const OPTION_KEYS = new Set(["id", "label", "description"]);

function fail(message: string): never {
  throw new Error(`questionnaire: ${message}`);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, allowed: Set<string>, name: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) fail(`${name} contains unsupported field ${JSON.stringify(unexpected)}`);
}

function text(value: unknown, name: string, maxLength: number, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") fail(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) fail(`${name} must not be blank`);
  if (normalized.length > maxLength) fail(`${name} must be at most ${maxLength} characters`);
  return normalized;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${name} must be a finite integer`);
  return value;
}

function unique(values: string[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${name} contains duplicate ID ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

export function normalizeQuestions(raw: unknown): NormalizedQuestion[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.questions) {
    fail(`questions must contain 1-${LIMITS.questions} items`);
  }

  const questions = raw.map((item, questionIndex): NormalizedQuestion => {
    const source = object(item, `questions[${questionIndex}]`);
    strictKeys(source, QUESTION_KEYS, `questions[${questionIndex}]`);
    const id = text(source.id, `questions[${questionIndex}].id`, LIMITS.id)!;
    const label = text(source.label, `questions[${questionIndex}].label`, LIMITS.label, true) ?? id;
    const prompt = text(source.prompt, `questions[${questionIndex}].prompt`, LIMITS.prompt)!;
    if (source.type !== "single" && source.type !== "multi") fail(`questions[${questionIndex}].type must be single or multi`);
    if (!Array.isArray(source.options) || source.options.length < 1 || source.options.length > LIMITS.options) {
      fail(`questions[${questionIndex}].options must contain 1-${LIMITS.options} items`);
    }
    const options = source.options.map((option, optionIndex): NormalizedOption => {
      const optionSource = object(option, `questions[${questionIndex}].options[${optionIndex}]`);
      strictKeys(optionSource, OPTION_KEYS, `questions[${questionIndex}].options[${optionIndex}]`);
      const normalized: NormalizedOption = {
        id: text(optionSource.id, `questions[${questionIndex}].options[${optionIndex}].id`, LIMITS.id)!,
        label: text(optionSource.label, `questions[${questionIndex}].options[${optionIndex}].label`, LIMITS.label)!,
      };
      const description = text(optionSource.description, `questions[${questionIndex}].options[${optionIndex}].description`, LIMITS.description, true);
      if (description !== undefined) normalized.description = description;
      return normalized;
    });
    unique(options.map((option) => option.id), `questions[${questionIndex}].options`);

    if (source.allowOther !== undefined && typeof source.allowOther !== "boolean") fail(`questions[${questionIndex}].allowOther must be a boolean`);
    const allowOther = source.allowOther ?? true;
    let minSelections = source.minSelections === undefined ? (source.type === "multi" ? 0 : 1) : integer(source.minSelections, `questions[${questionIndex}].minSelections`);
    let maxSelections = source.maxSelections === undefined ? (source.type === "multi" ? options.length + (allowOther ? 1 : 0) : 1) : integer(source.maxSelections, `questions[${questionIndex}].maxSelections`);
    const availableSelections = options.length + (allowOther ? 1 : 0);
    if (source.type === "single" && (source.minSelections !== undefined || source.maxSelections !== undefined)) {
      fail(`questions[${questionIndex}] selection bounds are only valid for multi questions`);
    }
    if (minSelections < 0 || maxSelections < 0 || minSelections > maxSelections || maxSelections > availableSelections) {
      fail(`questions[${questionIndex}] has invalid selection bounds`);
    }
    if (source.type === "single") {
      minSelections = 1;
      maxSelections = 1;
    }
    return { id, label, prompt, type: source.type, options, allowOther, minSelections, maxSelections };
  });
  unique(questions.map((question) => question.id), "questions");
  return questions;
}

export function normalizeToolInput(raw: unknown): ({ action: "start"; questions: NormalizedQuestion[] } | QuestionnaireResumeInput) {
  const source = object(raw, "arguments");
  if (source.action === "start") {
    strictKeys(source, START_KEYS, "start arguments");
    if (!("questions" in source)) fail("start requires questions");
    return { action: "start", questions: normalizeQuestions(source.questions) };
  }
  if (source.action === "resume") {
    strictKeys(source, RESUME_KEYS, "resume arguments");
    const questionnaireId = text(source.questionnaireId, "questionnaireId", LIMITS.id)!;
    const revision = integer(source.revision, "revision");
    if (revision < 1) fail("revision must be at least 1");
    const clarificationResponse = text(source.clarificationResponse, "clarificationResponse", LIMITS.clarification)!;
    return { action: "resume", questionnaireId, revision, clarificationResponse };
  }
  fail("action must be start or resume");
}

function cloneAnswer(answer: QuestionnaireAnswer): QuestionnaireAnswer {
  return { questionId: answer.questionId, selectedOptionIds: [...answer.selectedOptionIds], ...(answer.other === undefined ? {} : { other: answer.other }) };
}

function snapshot(state: ActiveState, status: QuestionnaireStatus, extra: Partial<QuestionnaireDetails> = {}): QuestionnaireDetails {
  return {
    version: QUESTIONNAIRE_DETAILS_VERSION,
    status,
    questionnaireId: state.questionnaireId,
    revision: state.revision,
    currentQuestionIndex: state.currentQuestionIndex,
    questions: state.questions.map((question) => ({ ...question, options: question.options.map((option) => ({ ...option })) })),
    answers: state.answers.map(cloneAnswer),
    ...(state.draftAnswer ? { draftAnswer: cloneAnswer(state.draftAnswer) } : {}),
    clarifications: state.clarifications.map((entry) => ({ ...entry })),
    ...extra,
  };
}

function answerCount(answer: QuestionnaireAnswer): number {
  return answer.selectedOptionIds.length + (answer.other === undefined ? 0 : 1);
}

function title(question: NormalizedQuestion, index: number, total: number, instruction: string): string {
  return [`Question ${index + 1} of ${total}: ${question.label}`, question.prompt, instruction].join("\n\n");
}

function optionDisplay(option: NormalizedOption, index: number, selected?: boolean): string {
  const marker = selected === undefined ? "" : selected ? "[selected] " : "[ ] ";
  return `${String(index + 1).padStart(2, "0")}. ${marker}${option.label}${option.description ? ` — ${option.description}` : ""}`;
}

function makeResult(details: QuestionnaireDetails): QuestionnaireResult {
  return { content: [{ type: "text", text: renderQuestionnaireResult(details) }], details };
}

export function renderQuestionnaireResult(details: QuestionnaireDetails): string {
  const marker = `QUESTIONNAIRE_${details.status.toUpperCase()}`;
  const lines = [`${marker} id=${details.questionnaireId} revision=${details.revision}`];
  if (details.status === "needs_clarification") {
    lines.push(`Question ${details.currentQuestionIndex + 1}/${details.questions.length} requires clarification: ${details.clarificationRequest}`);
    lines.push(`Explain the requested point, then call questionnaire resume with questionnaireId=${details.questionnaireId} and revision=${details.revision}.`);
    return lines.join("\n");
  }
  if (details.status === "cancelled" || details.status === "unavailable") {
    lines.push(`Outcome: ${details.cancellationReason ?? details.status}`);
  }
  for (const answer of details.answers) {
    const question = details.questions.find((candidate) => candidate.id === answer.questionId);
    const labels = answer.selectedOptionIds.map((id) => question?.options.find((option) => option.id === id)?.label ?? id);
    lines.push(`${answer.questionId} (${question?.label ?? answer.questionId}): optionIds=[${answer.selectedOptionIds.join(", ")}] labels=[${labels.join(", ")}]${answer.other === undefined ? "" : ` other=${JSON.stringify(answer.other)}`}`);
  }
  return lines.join("\n");
}

function cancelled(state: ActiveState, reason: CancellationReason): QuestionnaireResult {
  return makeResult(snapshot(state, "cancelled", { cancellationReason: reason }));
}

function unavailable(state: ActiveState, reason: "ui_unavailable" | "ui_error"): QuestionnaireResult {
  return makeResult(snapshot(state, "unavailable", { cancellationReason: reason }));
}

function isAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function select(ui: NativeQuestionnaireUi, heading: string, options: string[], signal: AbortSignal | undefined): Promise<string | undefined> {
  return ui.select(heading, options, signal ? { signal } : undefined);
}

async function input(ui: NativeQuestionnaireUi, heading: string, placeholder: string, signal: AbortSignal | undefined): Promise<string | undefined> {
  return ui.input(heading, placeholder, signal ? { signal } : undefined);
}

function clarification(state: ActiveState, request: string): QuestionnaireResult {
  state.revision += 1;
  const question = state.questions[state.currentQuestionIndex];
  state.clarifications.push({ revision: state.revision, questionId: question.id, request });
  return makeResult(snapshot(state, "needs_clarification", { clarificationRequest: request }));
}

async function askForClarification(state: ActiveState, ui: NativeQuestionnaireUi, signal: AbortSignal | undefined): Promise<QuestionnaireResult | undefined> {
  let heading = "Ask Pi to clarify";
  while (true) {
    const raw = await input(ui, heading, "What should Pi explain before you answer?", signal);
    if (isAbort(signal)) return cancelled(state, "aborted");
    const request = raw?.trim();
    if (!request) return undefined;
    if (request.length > LIMITS.clarification) {
      heading = `Ask Pi to clarify — please use at most ${LIMITS.clarification} characters`;
      continue;
    }
    return clarification(state, request);
  }
}

async function runSingle(state: ActiveState, ui: NativeQuestionnaireUi, signal: AbortSignal | undefined): Promise<QuestionnaireResult | undefined> {
  const question = state.questions[state.currentQuestionIndex];
  const displays = question.options.map((option, index) => optionDisplay(option, index));
  const optionMap = new Map(displays.map((display, index) => [display, question.options[index].id]));
  const otherChoice = "Other… (enter a custom answer)";
  const clarificationChoice = "Ask Pi to clarify…";
  const cancelChoice = "Cancel questionnaire";
  const choices = [...displays, ...(question.allowOther ? [otherChoice] : []), clarificationChoice, cancelChoice];
  const picked = await select(ui, title(question, state.currentQuestionIndex, state.questions.length, "Choose one option."), choices, signal);
  if (isAbort(signal)) return cancelled(state, "aborted");
  if (picked === undefined || picked === cancelChoice) return cancelled(state, "user_cancelled");
  if (picked === clarificationChoice) return askForClarification(state, ui, signal);
  if (picked === otherChoice) {
    let heading = `${question.label}: Other`;
    while (true) {
      const raw = await input(ui, heading, "Enter your answer", signal);
      if (isAbort(signal)) return cancelled(state, "aborted");
      const other = raw?.trim();
      if (!other) return undefined;
      if (other.length > LIMITS.prompt) {
        heading = `${question.label}: Other — please use at most ${LIMITS.prompt} characters`;
        continue;
      }
      state.answers.push({ questionId: question.id, selectedOptionIds: [], other });
      break;
    }
  } else {
    const selected = optionMap.get(picked);
    if (!selected) fail("UI returned an unknown selection");
    state.answers.push({ questionId: question.id, selectedOptionIds: [selected] });
  }
  state.draftAnswer = undefined;
  state.currentQuestionIndex += 1;
  return undefined;
}

async function runMulti(state: ActiveState, ui: NativeQuestionnaireUi, signal: AbortSignal | undefined): Promise<QuestionnaireResult | undefined> {
  const question = state.questions[state.currentQuestionIndex];
  const draft = state.draftAnswer?.questionId === question.id ? cloneAnswer(state.draftAnswer) : { questionId: question.id, selectedOptionIds: [] };
  state.draftAnswer = draft;
  let instruction = `Toggle options, then Continue. Select ${question.minSelections}-${question.maxSelections} total choice(s).`;

  while (true) {
    const displays = question.options.map((option, index) => optionDisplay(option, index, draft.selectedOptionIds.includes(option.id)));
    const optionMap = new Map(displays.map((display, index) => [display, question.options[index].id]));
    const continueChoice = `Continue with ${answerCount(draft)} selection(s)`;
    const otherChoice = draft.other === undefined ? "Add Other…" : `Change Other… (currently ${JSON.stringify(draft.other)})`;
    const removeOtherChoice = "Remove Other answer";
    const clarificationChoice = "Ask Pi to clarify…";
    const cancelChoice = "Cancel questionnaire";
    const choices = [...displays, ...(question.allowOther ? [otherChoice, ...(draft.other === undefined ? [] : [removeOtherChoice])] : []), clarificationChoice, continueChoice, cancelChoice];
    const picked = await select(ui, title(question, state.currentQuestionIndex, state.questions.length, instruction), choices, signal);
    if (isAbort(signal)) return cancelled(state, "aborted");
    if (picked === undefined || picked === cancelChoice) return cancelled(state, "user_cancelled");
    if (picked === clarificationChoice) return askForClarification(state, ui, signal);
    if (picked === continueChoice) {
      const count = answerCount(draft);
      if (count < question.minSelections || count > question.maxSelections) {
        instruction = `Cannot continue: choose ${question.minSelections}-${question.maxSelections} total choice(s); currently ${count}.`;
        continue;
      }
      const stableIds = question.options.filter((option) => draft.selectedOptionIds.includes(option.id)).map((option) => option.id);
      state.answers.push({ questionId: question.id, selectedOptionIds: stableIds, ...(draft.other === undefined ? {} : { other: draft.other }) });
      state.draftAnswer = undefined;
      state.currentQuestionIndex += 1;
      return undefined;
    }
    if (picked === removeOtherChoice && draft.other !== undefined) {
      delete draft.other;
      instruction = "Other answer removed. Toggle options, add Other, or Continue.";
      continue;
    }
    if (picked === otherChoice && question.allowOther) {
      let heading = `${question.label}: Other`;
      while (true) {
        const raw = await input(ui, heading, draft.other ?? "Enter your answer", signal);
        if (isAbort(signal)) return cancelled(state, "aborted");
        const other = raw?.trim();
        if (!other) break;
        if (other.length > LIMITS.prompt) {
          heading = `${question.label}: Other — please use at most ${LIMITS.prompt} characters`;
          continue;
        }
        if (draft.other === undefined && answerCount(draft) >= question.maxSelections) {
          instruction = `Cannot add Other: maximum ${question.maxSelections} selections reached.`;
        } else {
          draft.other = other;
          instruction = "Other answer saved. Toggle options or Continue.";
        }
        break;
      }
      continue;
    }
    const optionId = optionMap.get(picked);
    if (!optionId) fail("UI returned an unknown selection");
    const selectedIndex = draft.selectedOptionIds.indexOf(optionId);
    if (selectedIndex >= 0) {
      draft.selectedOptionIds.splice(selectedIndex, 1);
      instruction = "Selection removed. Toggle options or Continue.";
    } else if (answerCount(draft) >= question.maxSelections) {
      instruction = `Cannot add selection: maximum ${question.maxSelections} reached.`;
    } else {
      draft.selectedOptionIds.push(optionId);
      instruction = "Selection added. Toggle options or Continue.";
    }
  }
}

async function runState(state: ActiveState, ctx: QuestionnaireContext, signal: AbortSignal | undefined): Promise<QuestionnaireResult> {
  if (isAbort(signal)) return cancelled(state, "aborted");
  if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return unavailable(state, "ui_unavailable");
  try {
    while (state.currentQuestionIndex < state.questions.length) {
      const result = state.questions[state.currentQuestionIndex].type === "single"
        ? await runSingle(state, ctx.ui, signal)
        : await runMulti(state, ctx.ui, signal);
      if (result) return result;
    }
    return makeResult(snapshot(state, "completed"));
  } catch (error) {
    if (isAbort(signal) || (error instanceof Error && error.name === "AbortError")) return cancelled(state, "aborted");
    return unavailable(state, "ui_error");
  }
}

function parsePersistedAnswer(raw: unknown, questions: NormalizedQuestion[], name: string): QuestionnaireAnswer {
  const source = object(raw, name);
  strictKeys(source, new Set(["questionId", "selectedOptionIds", "other"]), name);
  const questionId = text(source.questionId, `${name}.questionId`, LIMITS.id)!;
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) fail(`stored state is corrupt: ${name} references an unknown question`);
  if (!Array.isArray(source.selectedOptionIds)) fail(`stored state is corrupt: ${name}.selectedOptionIds must be an array`);
  const selectedOptionIds = source.selectedOptionIds.map((value, index) => text(value, `${name}.selectedOptionIds[${index}]`, LIMITS.id)!);
  unique(selectedOptionIds, `${name}.selectedOptionIds`);
  if (selectedOptionIds.some((id) => !question.options.some((option) => option.id === id))) fail(`stored state is corrupt: ${name} references an unknown option`);
  const canonicalOptionIds = question.options.filter((option) => selectedOptionIds.includes(option.id)).map((option) => option.id);
  if (canonicalOptionIds.some((id, index) => selectedOptionIds[index] !== id)) fail(`stored state is corrupt: ${name} option IDs are out of order`);
  if (question.type === "single" && selectedOptionIds.length > 1) fail(`stored state is corrupt: ${name} has multiple single selections`);
  const other = text(source.other, `${name}.other`, LIMITS.prompt, true);
  if (other !== undefined && !question.allowOther) fail(`stored state is corrupt: ${name} has a forbidden Other answer`);
  return { questionId, selectedOptionIds, ...(other === undefined ? {} : { other }) };
}

function parseStoredQuestions(raw: unknown): NormalizedQuestion[] {
  if (!Array.isArray(raw)) fail("stored state is corrupt: questions must be an array");
  const inputShape = raw.map((value, index) => {
    const question = object(value, `stored details.questions[${index}]`);
    if (question.type === "single") {
      if (question.minSelections !== 1 || question.maxSelections !== 1) fail("stored state is corrupt: invalid single selection bounds");
      const { minSelections: _minSelections, maxSelections: _maxSelections, ...withoutBounds } = question;
      return withoutBounds;
    }
    return question;
  });
  return normalizeQuestions(inputShape);
}

function parseStoredDetails(raw: unknown): QuestionnaireDetails {
  const source = object(raw, "stored details");
  const requiredKeys = new Set(["version", "status", "questionnaireId", "revision", "currentQuestionIndex", "questions", "answers", "draftAnswer", "clarifications", "clarificationRequest", "cancellationReason"]);
  strictKeys(source, requiredKeys, "stored details");
  if (source.version !== QUESTIONNAIRE_DETAILS_VERSION) fail("stored state is corrupt: unsupported details version");
  if (source.status !== "needs_clarification") fail("stored questionnaire is not awaiting clarification");
  const questionnaireId = text(source.questionnaireId, "stored details.questionnaireId", LIMITS.id)!;
  const revision = integer(source.revision, "stored details.revision");
  const questions = parseStoredQuestions(source.questions);
  const currentQuestionIndex = integer(source.currentQuestionIndex, "stored details.currentQuestionIndex");
  if (currentQuestionIndex < 0 || currentQuestionIndex >= questions.length) fail("stored state is corrupt: invalid current question index");
  if (!Array.isArray(source.answers) || source.answers.length !== currentQuestionIndex) fail("stored state is corrupt: answers do not match current question index");
  const answers = source.answers.map((answer, index) => parsePersistedAnswer(answer, questions, `stored details.answers[${index}]`));
  for (let index = 0; index < answers.length; index += 1) {
    if (answers[index].questionId !== questions[index].id) fail("stored state is corrupt: answers are out of order");
    const count = answerCount(answers[index]);
    if (count < questions[index].minSelections || count > questions[index].maxSelections) fail("stored state is corrupt: answer violates selection bounds");
  }
  const draftAnswer = source.draftAnswer === undefined ? undefined : parsePersistedAnswer(source.draftAnswer, questions, "stored details.draftAnswer");
  const currentQuestion = questions[currentQuestionIndex];
  if (draftAnswer && draftAnswer.questionId !== currentQuestion.id) fail("stored state is corrupt: draft answer targets the wrong question");
  if (draftAnswer && (currentQuestion.type !== "multi" || answerCount(draftAnswer) > currentQuestion.maxSelections)) fail("stored state is corrupt: invalid draft answer");
  if (!Array.isArray(source.clarifications) || source.clarifications.length < 1) fail("stored state is corrupt: clarification history is missing");
  const clarifications = source.clarifications.map((entry, index): ClarificationRecord => {
    const item = object(entry, `stored details.clarifications[${index}]`);
    strictKeys(item, new Set(["revision", "questionId", "request", "response"]), `stored details.clarifications[${index}]`);
    const record: ClarificationRecord = {
      revision: integer(item.revision, `stored details.clarifications[${index}].revision`),
      questionId: text(item.questionId, `stored details.clarifications[${index}].questionId`, LIMITS.id)!,
      request: text(item.request, `stored details.clarifications[${index}].request`, LIMITS.clarification)!,
    };
    const response = text(item.response, `stored details.clarifications[${index}].response`, LIMITS.clarification, true);
    if (response !== undefined) record.response = response;
    return record;
  });
  if (revision !== clarifications.length || source.cancellationReason !== undefined) fail("stored state is corrupt: invalid revision metadata");
  for (let index = 0; index < clarifications.length; index += 1) {
    const record = clarifications[index];
    const questionIndex = questions.findIndex((question) => question.id === record.questionId);
    if (record.revision !== index + 1 || questionIndex < 0 || questionIndex > currentQuestionIndex) fail("stored state is corrupt: invalid clarification history");
    if (index < clarifications.length - 1 && record.response === undefined) fail("stored state is corrupt: unanswered prior clarification");
  }
  const last = clarifications.at(-1)!;
  const clarificationRequest = text(source.clarificationRequest, "stored details.clarificationRequest", LIMITS.clarification)!;
  if (last.revision !== revision || last.questionId !== currentQuestion.id || last.request !== clarificationRequest || last.response !== undefined) {
    fail("stored state is corrupt: active clarification does not match revision");
  }
  return {
    version: QUESTIONNAIRE_DETAILS_VERSION,
    status: "needs_clarification",
    questionnaireId,
    revision,
    currentQuestionIndex,
    questions,
    answers,
    ...(draftAnswer ? { draftAnswer } : {}),
    clarifications,
    clarificationRequest,
  };
}

function toolResultDetails(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as { type?: unknown; message?: unknown };
  if (candidate.type !== "message" || !candidate.message || typeof candidate.message !== "object") return undefined;
  const message = candidate.message as { role?: unknown; toolName?: unknown; details?: unknown };
  if (message.role !== "toolResult" || message.toolName !== "questionnaire") return undefined;
  return message.details;
}

function findStoredState(branch: unknown[], questionnaireId: string, revision: number): QuestionnaireDetails {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const rawDetails = toolResultDetails(branch[index]);
    if (!rawDetails || typeof rawDetails !== "object" || (rawDetails as { questionnaireId?: unknown }).questionnaireId !== questionnaireId) continue;
    const details = parseStoredDetails(rawDetails);
    if (details.revision !== revision) fail(`stale revision ${revision}; latest revision is ${details.revision}`);
    return details;
  }
  fail(`unknown questionnaire ID ${JSON.stringify(questionnaireId)} on the active branch`);
}

export function createQuestionnaireRuntime(options: RuntimeOptions = {}) {
  const createId = options.createId ?? randomUUID;
  return async function execute(raw: unknown, signal: AbortSignal | undefined, ctx: QuestionnaireContext): Promise<QuestionnaireResult> {
    const parsed = normalizeToolInput(raw);
    if (parsed.action === "start") {
      const state: ActiveState = {
        questionnaireId: createId(),
        revision: 0,
        currentQuestionIndex: 0,
        questions: parsed.questions,
        answers: [],
        clarifications: [],
      };
      return runState(state, ctx, signal);
    }

    const stored = findStoredState(ctx.sessionManager.getBranch(), parsed.questionnaireId, parsed.revision);
    const clarifications = stored.clarifications.map((entry) => ({ ...entry }));
    clarifications[clarifications.length - 1].response = parsed.clarificationResponse;
    const state: ActiveState = {
      questionnaireId: stored.questionnaireId,
      revision: stored.revision,
      currentQuestionIndex: stored.currentQuestionIndex,
      questions: stored.questions,
      answers: stored.answers,
      ...(stored.draftAnswer ? { draftAnswer: stored.draftAnswer } : {}),
      clarifications,
    };
    return runState(state, ctx, signal);
  };
}
