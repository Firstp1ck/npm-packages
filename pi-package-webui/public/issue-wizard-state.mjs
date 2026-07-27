const CATEGORY_DEFINITIONS = Object.freeze([
  { id: "feature", label: "Feature" },
  { id: "bug", label: "Bug" },
  { id: "ux", label: "UX" },
  { id: "documentation", label: "Documentation" },
  { id: "performance", label: "Performance" },
  { id: "compatibility", label: "Compatibility" },
  { id: "other", label: "Other" },
]);

const TEMPLATE_DEFINITIONS = Object.freeze([
  {
    id: "feature-new-capability",
    categoryIds: ["feature"],
    label: "New capability",
    description: "Propose a focused capability and define the outcome and acceptance boundary.",
    fields: [
      { id: "desiredOutcome", label: "Desired outcome", kind: "textarea", required: true },
      {
        id: "userImpact",
        label: "Who benefits?",
        kind: "select",
        required: true,
        options: [
          { id: "all-users", label: "All users" },
          { id: "new-users", label: "New users" },
          { id: "advanced-users", label: "Advanced users" },
          { id: "maintainers", label: "Maintainers" },
        ],
      },
      { id: "acceptanceCriteria", label: "Acceptance criteria", kind: "textarea", required: true },
    ],
  },
  {
    id: "bug-defect-report",
    categoryIds: ["bug"],
    label: "Defect report",
    description: "Report reproducible behavior that differs from the expected WebUI experience.",
    fields: [
      {
        id: "severity",
        label: "Severity",
        kind: "choices",
        required: true,
        options: [
          { id: "low", label: "Low — workaround available" },
          { id: "medium", label: "Medium — degraded workflow" },
          { id: "high", label: "High — key workflow blocked" },
        ],
      },
      { id: "expectedBehavior", label: "Expected behavior", kind: "textarea", required: true },
      { id: "actualBehavior", label: "Actual behavior", kind: "textarea", required: true },
      { id: "reproductionSteps", label: "Steps to reproduce", kind: "textarea", required: true },
    ],
  },
  {
    id: "ux-interaction-improvement",
    categoryIds: ["ux"],
    label: "Interaction improvement",
    description: "Describe a usability, workflow, onboarding, or accessibility improvement.",
    fields: [
      {
        id: "affectedWorkflow",
        label: "Affected workflow",
        kind: "select",
        required: true,
        options: [
          { id: "first-use", label: "First use or onboarding" },
          { id: "daily-use", label: "Daily use" },
          { id: "configuration", label: "Configuration" },
          { id: "accessibility", label: "Accessibility" },
        ],
      },
      { id: "currentExperience", label: "Current experience", kind: "textarea", required: true },
      { id: "proposedExperience", label: "Proposed experience", kind: "textarea", required: true },
    ],
  },
  {
    id: "documentation-update",
    categoryIds: ["documentation"],
    label: "Documentation update",
    description: "Identify missing or unclear guidance and the documentation change needed.",
    fields: [
      {
        id: "documentationArea",
        label: "Documentation area",
        kind: "select",
        required: true,
        options: [
          { id: "readme", label: "README or getting started" },
          { id: "reference", label: "Reference documentation" },
          { id: "examples", label: "Examples" },
          { id: "troubleshooting", label: "Troubleshooting" },
        ],
      },
      { id: "documentationGap", label: "What is missing or unclear?", kind: "textarea", required: true },
      { id: "proposedChange", label: "Proposed change", kind: "textarea", required: true },
    ],
  },
  {
    id: "performance-regression",
    categoryIds: ["performance"],
    label: "Performance regression",
    description: "Capture a measurable slowdown or resource-use regression and its impact.",
    fields: [
      {
        id: "performanceArea",
        label: "Affected area",
        kind: "select",
        required: true,
        options: [
          { id: "startup", label: "Startup" },
          { id: "interaction", label: "Interaction or rendering" },
          { id: "resource-use", label: "Resource use" },
          { id: "background-work", label: "Background work" },
        ],
      },
      { id: "observedPerformance", label: "Observed performance", kind: "textarea", required: true },
      { id: "impact", label: "User impact", kind: "textarea", required: true },
      { id: "measurement", label: "Measurement or comparison", kind: "textarea", required: true },
    ],
  },
  {
    id: "compatibility-environment-issue",
    categoryIds: ["compatibility"],
    label: "Environment issue",
    description: "Report behavior tied to a browser, operating system, runtime, or integration.",
    fields: [
      {
        id: "environmentType",
        label: "Environment type",
        kind: "choices",
        required: true,
        options: [
          { id: "browser", label: "Browser" },
          { id: "operating-system", label: "Operating system" },
          { id: "runtime", label: "Runtime or package version" },
          { id: "integration", label: "Integration" },
        ],
      },
      { id: "environment", label: "Environment details", kind: "textarea", required: true },
      { id: "expectedBehavior", label: "Expected behavior", kind: "textarea", required: true },
      { id: "actualBehavior", label: "Actual behavior", kind: "textarea", required: true },
    ],
  },
  {
    id: "other-general-request",
    categoryIds: ["other"],
    label: "General request",
    description: "Share a question, idea, or feedback that does not fit another category.",
    fields: [
      { id: "requestType", label: "Request type", kind: "choices", required: true, options: [
        { id: "question", label: "Question" },
        { id: "idea", label: "Idea" },
        { id: "feedback", label: "Feedback" },
      ] },
      { id: "context", label: "Context", kind: "textarea", required: true },
      { id: "request", label: "Request", kind: "textarea", required: true },
    ],
  },
]);

export const ISSUE_WIZARD_STEP_COUNT = 5;
export const ISSUE_WIZARD_CATEGORIES = CATEGORY_DEFINITIONS;
export const ISSUE_WIZARD_TEMPLATES = TEMPLATE_DEFINITIONS;

function freezeCatalogEntry(entry) {
  const options = entry.options?.map((option) => Object.freeze({ ...option }));
  return Object.freeze({
    ...entry,
    ...(options ? { options: Object.freeze(options) } : {}),
  });
}

function freezeTemplate(template) {
  return Object.freeze({
    ...template,
    categoryIds: Object.freeze([...template.categoryIds]),
    fields: Object.freeze(template.fields.map(freezeCatalogEntry)),
  });
}

const FROZEN_CATEGORIES = Object.freeze(CATEGORY_DEFINITIONS.map((category) => Object.freeze({ ...category })));
const FROZEN_TEMPLATES = Object.freeze(TEMPLATE_DEFINITIONS.map(freezeTemplate));

function normalizedText(value, { multiline = true } = {}) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!multiline) return text.replace(/\s+/g, " ").trim();
  return text.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

/** Normalize prose before validation or serialization without interpreting it as Markdown. */
export function normalizeIssueText(value, options) {
  return normalizedText(value, options);
}

function normalizedTitleSummary(value) {
  return normalizedText(value, { multiline: false }).replace(/[\[\]]/g, "").trim();
}

function componentSlug(label) {
  return normalizedText(label, { multiline: false })
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "feature";
}

/**
 * Builds the complete deterministic catalog. Optional feature labels are caller-owned
 * input so this module never maintains a second optional-feature catalog.
 */
export function createIssueWizardCatalog(optionalFeatureNames = []) {
  const labels = Array.isArray(optionalFeatureNames) ? optionalFeatureNames : [];
  const seenLabels = new Set(["webui"]);
  const usedIds = new Set(["webui"]);
  const optionalComponents = [];

  for (const featureName of labels) {
    const label = normalizedText(featureName, { multiline: false });
    const labelKey = label.toLocaleLowerCase();
    if (!label || seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);
    const baseId = `feature-${componentSlug(label)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    optionalComponents.push(Object.freeze({ id, label, source: "optional-feature" }));
  }

  return Object.freeze({
    categories: FROZEN_CATEGORIES,
    components: Object.freeze([
      Object.freeze({ id: "webui", label: "WebUI", source: "webui" }),
      ...optionalComponents,
    ]),
    templates: FROZEN_TEMPLATES,
  });
}

export function createIssueWizardState() {
  return {
    step: 1,
    categoryId: "",
    componentId: "",
    templateId: "",
    summary: "",
    fields: {},
  };
}

function categoryFor(catalog, id) {
  return catalog?.categories?.find((category) => category.id === id) || null;
}

function componentFor(catalog, id) {
  return catalog?.components?.find((component) => component.id === id) || null;
}

function templateFor(catalog, id) {
  return catalog?.templates?.find((template) => template.id === id) || null;
}

export function getCompatibleTemplates(catalog, categoryId, componentId) {
  if (!categoryFor(catalog, categoryId) || !componentFor(catalog, componentId)) return [];
  return (catalog?.templates || []).filter((template) => template.categoryIds.includes(categoryId));
}

export function isTemplateCompatible(catalog, categoryId, componentId, templateId) {
  return getCompatibleTemplates(catalog, categoryId, componentId).some((template) => template.id === templateId);
}

function selectionError(message) {
  return { valid: false, errors: { selection: message } };
}

export function validateIssueWizardState(state = {}, catalog) {
  const errors = {};
  const category = categoryFor(catalog, state.categoryId);
  const component = componentFor(catalog, state.componentId);
  const template = templateFor(catalog, state.templateId);

  if (!category) errors.categoryId = "Choose a category.";
  if (!component) errors.componentId = "Choose a component.";
  if (category && component && (!template || !isTemplateCompatible(catalog, category.id, component.id, state.templateId))) {
    errors.templateId = "Choose a compatible template.";
  }
  if (!normalizedTitleSummary(state.summary)) errors.summary = "Enter a short summary.";

  if (template && category && component && isTemplateCompatible(catalog, category.id, component.id, template.id)) {
    for (const field of template.fields) {
      const value = normalizedText(state.fields?.[field.id], { multiline: field.kind === "textarea" });
      if (field.required && !value) {
        errors[field.id] = `${field.label} is required.`;
        continue;
      }
      if (value && field.options && !field.options.some((option) => option.id === value)) {
        errors[field.id] = `Choose a valid ${field.label.toLocaleLowerCase()}.`;
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function isIssueWizardStepValid(state, catalog, step = state?.step) {
  const category = categoryFor(catalog, state?.categoryId);
  const component = componentFor(catalog, state?.componentId);
  const template = templateFor(catalog, state?.templateId);
  if (step === 1) return !!category;
  if (step === 2) return !!component;
  if (step === 3) return !!(category && component && template && isTemplateCompatible(catalog, category.id, component.id, template.id));
  if (step === 4) {
    if (!category || !component || !template || !isTemplateCompatible(catalog, category.id, component.id, template.id)) return false;
    const validation = validateIssueWizardState(state, catalog);
    return !Object.keys(validation.errors).some((key) => key !== "categoryId" && key !== "componentId" && key !== "templateId");
  }
  if (step === 5) return validateIssueWizardState(state, catalog).valid;
  return false;
}

function resetTemplateSelection(state) {
  return { ...state, templateId: "", fields: {} };
}

/** Apply a single pure state transition; invalid selection actions preserve state. */
export function reduceIssueWizardState(state = createIssueWizardState(), action = {}, catalog) {
  const current = {
    ...createIssueWizardState(),
    ...state,
    fields: { ...(state.fields || {}) },
  };

  switch (action.type) {
    case "select-category": {
      if (!categoryFor(catalog, action.categoryId)) return current;
      return { ...resetTemplateSelection(current), categoryId: action.categoryId, step: Math.min(current.step, 2) };
    }
    case "select-component": {
      if (!componentFor(catalog, action.componentId)) return current;
      return { ...resetTemplateSelection(current), componentId: action.componentId, step: Math.min(current.step, 3) };
    }
    case "select-template": {
      if (!isTemplateCompatible(catalog, current.categoryId, current.componentId, action.templateId)) return current;
      return { ...current, templateId: action.templateId, fields: {}, step: Math.min(current.step, 4) };
    }
    case "set-summary":
      return { ...current, summary: String(action.summary ?? "") };
    case "set-field": {
      const template = templateFor(catalog, current.templateId);
      if (!template?.fields.some((field) => field.id === action.fieldId)) return current;
      return { ...current, fields: { ...current.fields, [action.fieldId]: String(action.value ?? "") } };
    }
    case "next":
      return isIssueWizardStepValid(current, catalog, current.step)
        ? { ...current, step: Math.min(ISSUE_WIZARD_STEP_COUNT, current.step + 1) }
        : current;
    case "back":
      return { ...current, step: Math.max(1, current.step - 1) };
    case "reset":
      return createIssueWizardState();
    default:
      return current;
  }
}

function escapeMarkdown(value) {
  return normalizedText(value)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]<>()[\]|])/g, "\\$1")
    .replace(/^([>#]|[-+]|\d+\.)/gm, "\\$1");
}

function fieldValueForBody(field, value) {
  const normalized = normalizedText(value, { multiline: field.kind === "textarea" });
  const option = field.options?.find((candidate) => candidate.id === normalized);
  return escapeMarkdown(option?.label || normalized);
}

export class IssueWizardValidationError extends Error {
  constructor(errors) {
    super("Issue wizard state is incomplete or invalid.");
    this.name = "IssueWizardValidationError";
    this.errors = errors;
  }
}

/** Build the complete, I/O-free GitHub issue payload after validating the wizard state. */
export function buildIssuePayload(state, catalog) {
  const validation = validateIssueWizardState(state, catalog);
  if (!validation.valid) throw new IssueWizardValidationError(validation.errors);

  const category = categoryFor(catalog, state.categoryId);
  const component = componentFor(catalog, state.componentId);
  const template = templateFor(catalog, state.templateId);
  const summary = normalizedTitleSummary(state.summary);
  const title = `[${category.label}] [${component.label}] [${template.label}] ${summary}`;
  const details = template.fields.flatMap((field) => [
    `### ${field.label}`,
    fieldValueForBody(field, state.fields[field.id]),
    "",
  ]);
  const body = [
    `## ${template.label}`,
    "",
    `**Category:** ${category.label}`,
    `**Component:** ${component.label}`,
    "",
    "## Summary",
    escapeMarkdown(summary),
    "",
    "## Details",
    "",
    ...details,
  ].join("\n").trimEnd();

  return Object.freeze({ title, body });
}

/** Serializes the exact title/body payload that a future adapter will receive. */
export function serializeIssuePayload(payload) {
  return JSON.stringify({ title: String(payload?.title || ""), body: String(payload?.body || "") });
}

export function issueClipboardText(payload) {
  return `${String(payload?.title || "")}\n\n${String(payload?.body || "")}`;
}

/** Future integration seam. It deliberately performs no network, storage, or GitHub I/O. */
export async function submitIssueToGithubBot(_payload) {
  return Object.freeze({
    ok: false,
    status: "unavailable",
    message: "Send to GitHub bot is coming soon. Copy the issue instead.",
  });
}
