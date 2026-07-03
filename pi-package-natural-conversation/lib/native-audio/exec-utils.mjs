import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export function findExecutable(name, env = process.env) {
  if (!name || typeof name !== "string") return undefined;
  if (name.includes("/")) {
    try {
      accessSync(name, constants.X_OK);
      return name;
    } catch {
      return undefined;
    }
  }
  const pathValue = typeof env.PATH === "string" ? env.PATH : "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

export function substituteArgvTokens(argv, tokens = {}) {
  return argv.map((item) => {
    let value = String(item);
    for (const [token, replacement] of Object.entries(tokens)) {
      value = value.replaceAll(`{${token}}`, String(replacement));
    }
    return value;
  });
}
