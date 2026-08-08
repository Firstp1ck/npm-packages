const MISSING_DOCS_REPORT = /\blocal raspberry pi documentation docs are not available at\b|raspberrypi-wiki-local-missing-docs/i;

export function shouldRouteLocalWikiPrompt(prompt, promptDetection) {
  if (MISSING_DOCS_REPORT.test(prompt)) return false;
  return promptDetection.test(prompt);
}
