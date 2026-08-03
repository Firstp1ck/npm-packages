import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// A direct string enum avoids TypeBox's anyOf/const encoding, which Google tool schemas reject.
function StringEnum<T extends readonly string[]>(values: T, options: { description?: string } = {}) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}
import {
  LIMITS,
  createQuestionnaireRuntime,
  type QuestionnaireContext,
  type QuestionnaireDetails,
} from "./src/runtime.ts";

const OptionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: LIMITS.id, description: "Stable option ID, unique within its question." }),
  label: Type.String({ minLength: 1, maxLength: LIMITS.label, description: "Visible option label." }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: LIMITS.description, description: "Optional concise option explanation." })),
}, { additionalProperties: false });

const QuestionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: LIMITS.id, description: "Stable question ID, unique within this questionnaire." }),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: LIMITS.label, description: "Short progress label; defaults to the question ID." })),
  prompt: Type.String({ minLength: 1, maxLength: LIMITS.prompt, description: "Question shown to the user." }),
  type: StringEnum(["single", "multi"] as const, { description: "Whether the user chooses one or multiple answers." }),
  options: Type.Array(OptionSchema, { minItems: 1, maxItems: LIMITS.options }),
  allowOther: Type.Optional(Type.Boolean({ description: "Allow a custom Other answer; defaults to true." })),
  minSelections: Type.Optional(Type.Integer({ minimum: 0, maximum: LIMITS.options + 1, description: "Minimum total choices for a multi question, counting Other." })),
  maxSelections: Type.Optional(Type.Integer({ minimum: 0, maximum: LIMITS.options + 1, description: "Maximum total choices for a multi question, counting Other." })),
}, { additionalProperties: false });

export const QuestionnaireParameters = Type.Object({
  action: StringEnum(["start", "resume"] as const, { description: "Start a new questionnaire or resume a stored clarification snapshot." }),
  questions: Type.Optional(Type.Array(QuestionSchema, { minItems: 1, maxItems: LIMITS.questions, description: "Required only for start." })),
  questionnaireId: Type.Optional(Type.String({ minLength: 1, maxLength: LIMITS.id, description: "Opaque ID returned by needs_clarification; required only for resume." })),
  revision: Type.Optional(Type.Integer({ minimum: 1, description: "Exact revision returned by needs_clarification; required only for resume." })),
  clarificationResponse: Type.Optional(Type.String({ minLength: 1, maxLength: LIMITS.clarification, description: "Concise explanation answering the user's clarification request; required only for resume." })),
}, { additionalProperties: false });

const executeQuestionnaire = createQuestionnaireRuntime();

export default function questionnaireExtension(pi: ExtensionAPI): void {
  pi.registerTool<typeof QuestionnaireParameters, QuestionnaireDetails>({
    name: "questionnaire",
    label: "Questionnaire",
    description: "Ask 1-20 structured single- or multi-select questions through Pi's native TUI/RPC dialogs, with optional Other answers and resumable clarification.",
    promptSnippet: "Ask related structured questions in one native questionnaire and resume any clarification request using its exact ID and revision.",
    promptGuidelines: [
      "Use questionnaire for related structured choices; combine them into one start call with stable question and option IDs.",
      "When questionnaire returns QUESTIONNAIRE_NEEDS_CLARIFICATION, explain the requested point in normal text and immediately call resume with only its questionnaireId, revision, and clarificationResponse.",
      "Never restart or infer an answer after a clarification request, and never use questionnaire to request secrets.",
    ],
    parameters: QuestionnaireParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
      const questionnaireContext: QuestionnaireContext = {
        hasUI: ctx.hasUI,
        mode: ctx.mode,
        ui: ctx.ui,
        sessionManager: ctx.sessionManager,
      };
      return executeQuestionnaire(params, signal, questionnaireContext);
    },
  });
}

export * from "./src/runtime.ts";
