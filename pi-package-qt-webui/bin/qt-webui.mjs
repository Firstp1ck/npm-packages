#!/usr/bin/env node
import { launchQtWebUi } from "../lib/launcher.mjs";

try {
  process.exitCode = await launchQtWebUi();
} catch (error) {
  console.error(`qt-webui: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
