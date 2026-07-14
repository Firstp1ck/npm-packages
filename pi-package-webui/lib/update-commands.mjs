export function piUpdateHelpSupportsAll(output) {
  return /(?:^|[^A-Za-z0-9_-])--all(?:$|[^A-Za-z0-9_-])/.test(String(output || ""));
}

export function piUpdateCommandSteps({ all = false, supportsAll = false } = {}) {
  if (!all) return [{ label: "Pi CLI", args: ["update", "--self"] }];
  if (supportsAll) return [{ label: "Pi CLI and configured packages", args: ["update", "--all"] }];

  // Explicit flags remain compatible with Pi releases that predate `--all`.
  return [
    { label: "Pi CLI", args: ["update", "--self"] },
    { label: "configured Pi packages", args: ["update", "--extensions"] },
  ];
}

export function piUpdateCommandText(options = {}) {
  return piUpdateCommandSteps(options)
    .map((step) => `pi ${step.args.join(" ")}`)
    .join(" && ");
}
