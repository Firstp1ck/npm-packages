export const POLICY_VERSION = "1" as const;

export type FieldKind = "textarea" | "select" | "choices";
export interface CatalogOption { id: string; label: string }
export interface CatalogField { id: string; label: string; kind: FieldKind; required: boolean; options?: readonly CatalogOption[] }
export interface CatalogTemplate { id: string; categoryIds: readonly string[]; label: string; fields: readonly CatalogField[] }
export interface CatalogCategory { id: string; label: string }
export interface CatalogComponent { id: string; label: string; source: "webui" | "optional-feature" }

/**
 * Policy-v1 server snapshot of `createIssueWizardCatalog(OPTIONAL_FEATURES.map(f => f.label))`.
 * It intentionally does not inspect browser code at runtime: catalog changes require a policy bump.
 */
export const CATALOG = Object.freeze({
  categories: Object.freeze([
    { id: "feature", label: "Feature" }, { id: "bug", label: "Bug" }, { id: "ux", label: "UX" },
    { id: "documentation", label: "Documentation" }, { id: "performance", label: "Performance" },
    { id: "compatibility", label: "Compatibility" }, { id: "other", label: "Other" },
  ] satisfies CatalogCategory[]),
  components: Object.freeze([
    { id: "webui", label: "WebUI", source: "webui" },
    { id: "feature-command-autocomplete", label: "! command autocomplete", source: "optional-feature" },
    { id: "feature-fish-user-bash", label: "Fish user bash", source: "optional-feature" },
    { id: "feature-btw-side-questions", label: "/btw side questions", source: "optional-feature" },
    { id: "feature-guided-git-workflow", label: "Guided Git workflow", source: "optional-feature" },
    { id: "feature-npm-release", label: "NPM Release", source: "optional-feature" },
    { id: "feature-aur-release", label: "AUR Release", source: "optional-feature" },
    { id: "feature-manual-repository-review", label: "Manual repository review", source: "optional-feature" },
    { id: "feature-workflows", label: "Workflows", source: "optional-feature" },
    { id: "feature-safety-guard", label: "Safety guard", source: "optional-feature" },
    { id: "feature-tui-skills-command", label: "TUI Skills command", source: "optional-feature" },
    { id: "feature-todo-progress-widget", label: "Todo progress widget", source: "optional-feature" },
    { id: "feature-tui-tools-command", label: "TUI Tools command", source: "optional-feature" },
    { id: "feature-remote-webui", label: "Remote WebUI", source: "optional-feature" },
    { id: "feature-natural-conversation", label: "Natural Conversation", source: "optional-feature" },
    { id: "feature-git-footer-status", label: "Git footer status", source: "optional-feature" },
    { id: "feature-stats-dashboard", label: "Stats dashboard", source: "optional-feature" },
    { id: "feature-theme-bundle", label: "Theme bundle", source: "optional-feature" },
  ] satisfies CatalogComponent[]),
  templates: Object.freeze([
    {
      id: "feature-new-capability", categoryIds: ["feature"], label: "New capability", fields: [
        { id: "desiredOutcome", label: "Desired outcome", kind: "textarea", required: true },
        { id: "userImpact", label: "Who benefits?", kind: "select", required: true, options: [
          { id: "all-users", label: "All users" }, { id: "new-users", label: "New users" }, { id: "advanced-users", label: "Advanced users" }, { id: "maintainers", label: "Maintainers" },
        ] },
        { id: "acceptanceCriteria", label: "Acceptance criteria", kind: "textarea", required: true },
      ],
    },
    {
      id: "bug-defect-report", categoryIds: ["bug"], label: "Defect report", fields: [
        { id: "severity", label: "Severity", kind: "choices", required: true, options: [
          { id: "low", label: "Low — workaround available" }, { id: "medium", label: "Medium — degraded workflow" }, { id: "high", label: "High — key workflow blocked" },
        ] },
        { id: "expectedBehavior", label: "Expected behavior", kind: "textarea", required: true },
        { id: "actualBehavior", label: "Actual behavior", kind: "textarea", required: true },
        { id: "reproductionSteps", label: "Steps to reproduce", kind: "textarea", required: true },
      ],
    },
    {
      id: "ux-interaction-improvement", categoryIds: ["ux"], label: "Interaction improvement", fields: [
        { id: "affectedWorkflow", label: "Affected workflow", kind: "select", required: true, options: [
          { id: "first-use", label: "First use or onboarding" }, { id: "daily-use", label: "Daily use" }, { id: "configuration", label: "Configuration" }, { id: "accessibility", label: "Accessibility" },
        ] },
        { id: "currentExperience", label: "Current experience", kind: "textarea", required: true },
        { id: "proposedExperience", label: "Proposed experience", kind: "textarea", required: true },
      ],
    },
    {
      id: "documentation-update", categoryIds: ["documentation"], label: "Documentation update", fields: [
        { id: "documentationArea", label: "Documentation area", kind: "select", required: true, options: [
          { id: "readme", label: "README or getting started" }, { id: "reference", label: "Reference documentation" }, { id: "examples", label: "Examples" }, { id: "troubleshooting", label: "Troubleshooting" },
        ] },
        { id: "documentationGap", label: "What is missing or unclear?", kind: "textarea", required: true },
        { id: "proposedChange", label: "Proposed change", kind: "textarea", required: true },
      ],
    },
    {
      id: "performance-regression", categoryIds: ["performance"], label: "Performance regression", fields: [
        { id: "performanceArea", label: "Affected area", kind: "select", required: true, options: [
          { id: "startup", label: "Startup" }, { id: "interaction", label: "Interaction or rendering" }, { id: "resource-use", label: "Resource use" }, { id: "background-work", label: "Background work" },
        ] },
        { id: "observedPerformance", label: "Observed performance", kind: "textarea", required: true },
        { id: "impact", label: "User impact", kind: "textarea", required: true },
        { id: "measurement", label: "Measurement or comparison", kind: "textarea", required: true },
      ],
    },
    {
      id: "compatibility-environment-issue", categoryIds: ["compatibility"], label: "Environment issue", fields: [
        { id: "environmentType", label: "Environment type", kind: "choices", required: true, options: [
          { id: "browser", label: "Browser" }, { id: "operating-system", label: "Operating system" }, { id: "runtime", label: "Runtime or package version" }, { id: "integration", label: "Integration" },
        ] },
        { id: "environment", label: "Environment details", kind: "textarea", required: true },
        { id: "expectedBehavior", label: "Expected behavior", kind: "textarea", required: true },
        { id: "actualBehavior", label: "Actual behavior", kind: "textarea", required: true },
      ],
    },
    {
      id: "other-general-request", categoryIds: ["other"], label: "General request", fields: [
        { id: "requestType", label: "Request type", kind: "choices", required: true, options: [
          { id: "question", label: "Question" }, { id: "idea", label: "Idea" }, { id: "feedback", label: "Feedback" },
        ] },
        { id: "context", label: "Context", kind: "textarea", required: true },
        { id: "request", label: "Request", kind: "textarea", required: true },
      ],
    },
  ] satisfies CatalogTemplate[]),
});

const DISALLOWED_UNICODE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const UNPAIRED_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u;

export function normalizeIssueText(value: string, multiline = true): string | null {
  if (DISALLOWED_UNICODE.test(value) || UNPAIRED_SURROGATE.test(value)) return null;
  const text = value.normalize("NFKC").replace(/\r\n?/g, "\n");
  return multiline ? text.split("\n").map((line) => line.trimEnd()).join("\n").trim() : text.replace(/\s+/g, " ").trim();
}

function neutralizeGithubReferences(value: string): string {
  return value.replace(/@(?=[A-Za-z0-9_-])/gu, "@\u200B").replace(/#(?=\d)/gu, "#\u200B");
}

function escapeMarkdown(value: string): string {
  return neutralizeGithubReferences(value).replace(/\\/g, "\\\\").replace(/([`*_{}\[\]<>()[\]|])/g, "\\$1").replace(/^([>#]|[-+]|\d+\.)/gm, "\\$1");
}

export interface CanonicalIssue {
  categoryId: string; componentId: string; templateId: string; summary: string; fields: Record<string, string>; title: string; body: string;
}

export function canonicalizeIssue(input: { categoryId: string; componentId: string; templateId: string; summary: string; fields: Record<string, string> }): CanonicalIssue | null {
  const category = CATALOG.categories.find((entry) => entry.id === input.categoryId);
  const component = CATALOG.components.find((entry) => entry.id === input.componentId);
  const template = CATALOG.templates.find((entry) => entry.id === input.templateId);
  if (!category || !component || !template || !template.categoryIds.includes(category.id)) return null;
  const summary = normalizeIssueText(input.summary, false)?.replace(/[\[\]]/g, "").trim();
  if (!summary || summary.length > 160) return null;
  const expectedKeys = new Set(template.fields.map((field) => field.id));
  if (Object.keys(input.fields).length !== expectedKeys.size || Object.keys(input.fields).some((key) => !expectedKeys.has(key))) return null;
  const fields: Record<string, string> = {};
  for (const field of template.fields) {
    const normalized = normalizeIssueText(input.fields[field.id] ?? "", field.kind === "textarea");
    if (!normalized || normalized.length > 4_000) return null;
    if (field.options && !field.options.some((option) => option.id === normalized)) return null;
    fields[field.id] = normalized;
  }
  const title = `[${category.label}] [${component.label}] [${template.label}] ${neutralizeGithubReferences(summary)}`;
  const details = template.fields.flatMap((field) => {
    const option = field.options?.find((candidate) => candidate.id === fields[field.id]);
    return [`### ${field.label}`, escapeMarkdown(option?.label ?? fields[field.id]), ""];
  });
  const body = [
    `## ${template.label}`, "", `**Category:** ${category.label}`, `**Component:** ${component.label}`, "",
    "## Summary", escapeMarkdown(summary), "", "## Details", "", ...details,
  ].join("\n").trimEnd();
  if (body.length > 16_000) return null;
  return { categoryId: category.id, componentId: component.id, templateId: template.id, summary, fields, title, body };
}
