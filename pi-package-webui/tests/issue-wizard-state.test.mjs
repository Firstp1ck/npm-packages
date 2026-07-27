import assert from "node:assert/strict";
import {
  ISSUE_WIZARD_STEP_COUNT,
  IssueWizardValidationError,
  buildIssuePayload,
  createIssueWizardCatalog,
  createIssueWizardState,
  getCompatibleTemplates,
  isIssueWizardStepValid,
  issueClipboardText,
  normalizeIssueText,
  reduceIssueWizardState,
  serializeIssuePayload,
  submitIssueToGithubBot,
  validateIssueWizardState,
} from "../public/issue-wizard-state.mjs";

const catalog = createIssueWizardCatalog([
  "Guided Git workflow",
  "NPM Release",
  "Guided Git workflow",
  "WebUI",
  "  Theme bundle  ",
  "",
]);

assert.deepEqual(
  catalog.categories.map((category) => category.label),
  ["Feature", "Bug", "UX", "Documentation", "Performance", "Compatibility", "Other"],
  "the approved category catalog should be deterministic and omit Security",
);
assert.deepEqual(
  catalog.components.map((component) => component.label),
  ["WebUI", "Guided Git workflow", "NPM Release", "Theme bundle"],
  "optional component labels should come only from caller input and be normalized/deduplicated",
);
assert.equal(catalog.components[0].id, "webui");
assert.ok(Object.isFrozen(catalog), "the generated catalog should not be mutable by a caller");
assert.ok(catalog.templates.every((template) => template.fields.some((field) => field.kind === "choices" || field.kind === "select")), "every template should prefer a structured choice or dropdown field");

const featureTemplates = getCompatibleTemplates(catalog, "feature", "webui");
assert.deepEqual(featureTemplates.map((template) => template.id), ["feature-new-capability"], "template choices should be filtered by category and component");
assert.deepEqual(getCompatibleTemplates(catalog, "feature", "missing"), [], "an unknown component must not expose templates");
assert.deepEqual(getCompatibleTemplates(catalog, "bug", "webui").map((template) => template.id), ["bug-defect-report"]);

let state = createIssueWizardState();
assert.equal(state.step, 1);
assert.equal(isIssueWizardStepValid(state, catalog), false, "the first page requires a category");
state = reduceIssueWizardState(state, { type: "next" }, catalog);
assert.equal(state.step, 1, "next must not advance an invalid step");
state = reduceIssueWizardState(state, { type: "select-category", categoryId: "bug" }, catalog);
assert.equal(state.categoryId, "bug");
assert.equal(state.templateId, "", "choosing a category resets its dependent template state");
state = reduceIssueWizardState(state, { type: "next" }, catalog);
assert.equal(state.step, 2);
state = reduceIssueWizardState(state, { type: "select-component", componentId: "webui" }, catalog);
state = reduceIssueWizardState(state, { type: "next" }, catalog);
assert.equal(state.step, 3);
state = reduceIssueWizardState(state, { type: "select-template", templateId: "feature-new-capability" }, catalog);
assert.equal(state.templateId, "", "an incompatible template action must preserve the current state");
state = reduceIssueWizardState(state, { type: "select-template", templateId: "bug-defect-report" }, catalog);
assert.equal(state.templateId, "bug-defect-report");
state = reduceIssueWizardState(state, { type: "next" }, catalog);
assert.equal(state.step, 4);
state = reduceIssueWizardState(state, { type: "set-summary", summary: "Panel fails to open" }, catalog);
state = reduceIssueWizardState(state, { type: "set-field", fieldId: "severity", value: "high" }, catalog);
state = reduceIssueWizardState(state, { type: "set-field", fieldId: "expectedBehavior", value: "The panel opens." }, catalog);
state = reduceIssueWizardState(state, { type: "set-field", fieldId: "actualBehavior", value: "Nothing appears." }, catalog);
state = reduceIssueWizardState(state, { type: "set-field", fieldId: "reproductionSteps", value: "1. Open the deck\n2. Select the panel" }, catalog);
assert.equal(isIssueWizardStepValid(state, catalog), true, "a completed form should validate at the details step");
state = reduceIssueWizardState(state, { type: "next" }, catalog);
assert.equal(state.step, ISSUE_WIZARD_STEP_COUNT, "a valid details form should advance to review");
state = reduceIssueWizardState(state, { type: "back" }, catalog);
assert.equal(state.step, 4, "back should preserve prior selections and answers");
state = reduceIssueWizardState(state, { type: "select-component", componentId: "feature-npm-release" }, catalog);
assert.equal(state.templateId, "", "changing component resets template and field answers");
assert.deepEqual(state.fields, {});
assert.equal(state.summary, "Panel fails to open", "changing a dependent selection must retain the independent summary");

const incomplete = createIssueWizardState();
const incompleteValidation = validateIssueWizardState(incomplete, catalog);
assert.equal(incompleteValidation.valid, false);
assert.deepEqual(Object.keys(incompleteValidation.errors).sort(), ["categoryId", "componentId", "summary"], "validation should expose field-specific errors without inventing a template error before selections exist");

const payloadState = {
  step: 5,
  categoryId: "bug",
  componentId: "webui",
  templateId: "bug-defect-report",
  summary: "  Preview [breaks]\n on launch  ",
  fields: {
    severity: "high",
    expectedBehavior: "A preview appears.",
    actualBehavior: "# heading\n- fake list\n[untrusted](https://example.test)",
    reproductionSteps: "1. Open preview\r\n2. Observe failure\u0000",
  },
};
const payload = buildIssuePayload(payloadState, catalog);
assert.equal(payload.title, "[Bug] [WebUI] [Defect report] Preview breaks on launch", "titles must use the approved category/component/template prefix and a normalized summary");
assert.match(payload.body, /^## Defect report/m);
assert.match(payload.body, /### Actual behavior\n\\# heading\n\\- fake list\n\\\[untrusted\\\]\\\(https:\/\/example\.test\\\)/, "prose must be escaped so it cannot introduce user-controlled Markdown structure");
assert.match(payload.body, /\\1\. Open preview\n\\2\. Observe failure/, "multiline prose should normalize CRLF and remove controls");
assert.deepEqual(JSON.parse(serializeIssuePayload(payload)), payload, "serialization should contain the exact complete title/body payload");
assert.equal(issueClipboardText(payload), `${payload.title}\n\n${payload.body}`, "copy output should include both title and body");
assert.equal(normalizeIssueText("  a\r\nb\u0000  "), "a\nb", "normalization should trim surrounding whitespace while removing controls");

assert.equal(
  validateIssueWizardState({ ...payloadState, summary: "[ ]" }, catalog).valid,
  false,
  "a bracket-only summary must not pass when brackets are removed from the generated title",
);

assert.throws(
  () => buildIssuePayload({ ...payloadState, fields: { ...payloadState.fields, severity: "critical" } }, catalog),
  (error) => error instanceof IssueWizardValidationError && Boolean(error.errors.severity),
  "unknown choice values must be rejected before payload generation",
);

const submission = await submitIssueToGithubBot(payload);
assert.deepEqual(submission, {
  ok: false,
  status: "unavailable",
  message: "Automatic submission is coming soon. Copy the issue instead.",
}, "the future submission seam must explicitly remain unavailable");

console.log("issue-wizard-state.test.mjs passed");
