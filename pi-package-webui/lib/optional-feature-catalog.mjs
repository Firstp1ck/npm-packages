const entries = [
  ["bangCommandAutocomplete", "@firstpick/pi-extension-bang-command-autocomplete", "^0.2.2"],
  ["fishUserBash", "@firstpick/pi-extension-fish-user-bash", "^0.2.2"],
  ["btwCommand", "@firstpick/pi-extension-btw", "^0.1.4"],
  ["gitWorkflow", "@firstpick/pi-prompts-git-pr", "^0.1.5"],
  ["releaseNpm", "@firstpick/pi-extension-release-npm", "^0.4.4"],
  ["releaseAur", "@firstpick/pi-extension-release-aur", "^0.1.8"],
  ["aurReview", "@firstpick/pi-extension-aur-review", "^0.1.1"],
  ["workflows", "@firstpick/pi-extension-workflows", "^0.1.7"],
  ["safetyGuard", "@firstpick/pi-extension-safety-guard", "^0.2.6"],
  ["tuiSkillsCommand", "@firstpick/pi-extension-setup-skills", "^0.1.9"],
  ["todoProgressWidget", "@firstpick/pi-extension-todo-progress", "^0.2.9"],
  ["tuiToolsCommand", "@firstpick/pi-extension-tools", "^0.1.7"],
  ["remoteWebui", "@firstpick/pi-package-remote-webui", "^0.1.8"],
  ["questionnaire", "@firstpick/pi-package-questionnaire", "^0.1.0"],
  ["naturalConversation", "@firstpick/pi-package-natural-conversation", "^0.1.4"],
  ["gitFooterStatus", "@firstpick/pi-extension-git-footer-status", "^0.4.3"],
  ["statsCommand", "@firstpick/pi-extension-stats", "^0.2.9"],
  ["codexFastMode", "@firstpick/pi-extension-codex-fast-mode", "^0.1.0"],
  ["themeBundle", "@firstpick/pi-themes-bundle", "^0.1.5"],
];

export const OPTIONAL_FEATURE_CATALOG = Object.freeze(entries.map(([featureId, packageName, expectedSpec]) => Object.freeze({
  featureId,
  packageName,
  expectedSpec,
})));

export const OPTIONAL_FEATURE_BY_ID = new Map(OPTIONAL_FEATURE_CATALOG.map((feature) => [feature.featureId, feature]));
