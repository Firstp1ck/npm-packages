#!/usr/bin/env node

import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(
  process.env.PI_ANTHROPIC_PATCH_SOURCE_DIR
    || join(packageDirectory, "..", "patches", "pi-anthropic-provider-dist-compat"),
);
const resourcesDirectory = join(packageDirectory, "resources");
const targetDirectory = join(resourcesDirectory, "pi-anthropic-provider-dist-compat");
const runtimeFiles = [
  "PATCH.md",
  "patch.manifest.json",
  join("scripts", "lifecycle.mjs"),
];

async function assertReadable(file) {
  try {
    await access(file, fsConstants.R_OK);
  } catch {
    throw new Error(`Required Anthropic compatibility patch resource is missing or unreadable: ${file}`);
  }
}

async function stage() {
  await Promise.all(runtimeFiles.map((relativePath) => assertReadable(join(sourceDirectory, relativePath))));
  await rm(resourcesDirectory, { recursive: true, force: true });
  for (const relativePath of runtimeFiles) {
    const target = join(targetDirectory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(sourceDirectory, relativePath), target);
  }
}

if (process.argv.includes("--clean")) {
  await rm(resourcesDirectory, { recursive: true, force: true });
} else {
  await stage();
}
