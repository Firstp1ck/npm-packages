import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;

  const modulePath = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(modulePath);
  } catch {
    return path.resolve(argv1) === path.resolve(modulePath);
  }
}
