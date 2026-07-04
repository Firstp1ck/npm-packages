// Guided local STT provisioning for /talk setup: detect what the system
// already has (whisper-server binary, downloaded ggml models, systemd user
// session, package manager), then walk the user from "nothing" to a verified
// local endpoint. Every state-changing action happens only after an explicit
// confirm, and system package installation is never performed by this code —
// the user gets the exact command and we re-detect afterwards.
import { spawn as nodeSpawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { findExecutable } from "./native-audio/exec-utils.mjs";
import { createLocalSttAdapter } from "./providers/stt-local-endpoint.mjs";

export const DEFAULT_STT_PORT = 8178;
export const STT_SERVICE_NAME = "whisper-server.service";

export const MODEL_CATALOG = Object.freeze([
  { id: "base.en", file: "ggml-base.en.bin", sizeMb: 148, note: "fast, English-only, fine on CPU" },
  { id: "small.en", file: "ggml-small.en.bin", sizeMb: 488, note: "better accuracy, English-only" },
  { id: "large-v3-turbo", file: "ggml-large-v3-turbo.bin", sizeMb: 1620, note: "best accuracy, wants a GPU" },
].map((model) => ({ ...model, url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}` })));

const MODEL_SEARCH_DIRS = (home, env) => [
  join(env.XDG_DATA_HOME || join(home, ".local", "share"), "whisper"),
  join(env.XDG_DATA_HOME || join(home, ".local", "share"), "pywhispercpp", "models"),
  join(env.XDG_DATA_HOME || join(home, ".local", "share"), "whisper.cpp"),
  join(home, ".cache", "whisper.cpp"),
];

function defaultRunCommand(command, args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function downloadFile(url, targetPath, { fetchImpl = fetch, onProgress } = {}) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
  if (!onProgress) {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath, { mode: 0o644 }));
    return;
  }
  const totalBytes = Number(response.headers.get("content-length")) || 0;
  let receivedBytes = 0;
  const counter = async function* () {
    for await (const chunk of response.body) {
      receivedBytes += chunk.byteLength ?? chunk.length;
      onProgress({ receivedBytes, totalBytes });
      yield chunk;
    }
  };
  await pipeline(counter(), createWriteStream(targetPath, { mode: 0o644 }));
}

export function sttInstallHint(packageManager) {
  if (packageManager === "pacman") {
    return [
      "Install whisper.cpp from the official repos (pick one):",
      "  sudo pacman -S whisper-cpp-vulkan   # GPU via Vulkan (AMD/Intel/NVIDIA), recommended",
      "  sudo pacman -S whisper-cpp          # CPU only",
    ].join("\n");
  }
  if (packageManager === "brew") {
    return "Install whisper.cpp:\n  brew install whisper-cpp";
  }
  return [
    "whisper.cpp does not appear to be packaged for your system; build it from source:",
    "  git clone https://github.com/ggerganov/whisper.cpp",
    "  cd whisper.cpp && cmake -B build -DGGML_VULKAN=1 && cmake --build build -j",
    "  sudo cmake --install build",
    "(drop -DGGML_VULKAN=1 for a CPU-only build)",
  ].join("\n");
}

/** Pure-ish system detection; every probe is injectable for tests. */
export function detectSttEnvironment({ env = process.env, findExec = findExecutable, home = homedir() } = {}) {
  const packageManager = ["pacman", "brew", "apt-get", "dnf", "zypper"].find((tool) => findExec(tool, env));
  const models = [];
  for (const dir of MODEL_SEARCH_DIRS(home, env)) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^ggml-.*\.bin$/.test(entry)) continue;
      const path = join(dir, entry);
      try {
        const sizeMb = Math.round(statSync(path).size / (1024 * 1024));
        if (sizeMb >= 10) models.push({ path, file: entry, sizeMb });
      } catch {
        // unreadable entry; skip
      }
    }
  }
  return {
    serverBinary: findExec("whisper-server", env),
    models,
    packageManager,
    installHint: sttInstallHint(packageManager),
    espeak: Boolean(findExec("espeak-ng", env)),
  };
}

function serviceUnitText(modelPath, port) {
  return [
    "[Unit]",
    "Description=whisper.cpp STT server for Pi Natural Conversation (/talk)",
    "Documentation=https://github.com/ggerganov/whisper.cpp",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=/usr/bin/env whisper-server -m ${modelPath} --host 127.0.0.1 --port ${port}`,
    "Restart=on-failure",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function manualStartCommand(modelPath, port) {
  return `whisper-server -m ${modelPath} --host 127.0.0.1 --port ${port}`;
}

/**
 * Guided local STT provisioning. Returns `{ url, mode }` on success
 * (`mode`: "existing-endpoint" | "service" | "manual"), or undefined when the
 * user skips/cancels. `ctx.ui` must support select/confirm/notify (the wizard
 * checks that before calling).
 */
export async function provisionLocalStt({ ctx, env = process.env, port = DEFAULT_STT_PORT, deps = {} }) {
  const ui = ctx.ui;
  const notify = (message, level = "info") => ui.notify(message, level);
  const detect = deps.detect ?? (() => detectSttEnvironment({ env, findExec: deps.findExec }));
  const makeSttAdapter = deps.makeSttAdapter ?? createLocalSttAdapter;
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const download = deps.download ?? downloadFile;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const home = deps.home ?? homedir();
  const writeFile = deps.writeFile ?? ((path, content) => writeFileSync(path, content));
  const mkdir = deps.mkdir ?? ((path) => mkdirSync(path, { recursive: true }));
  const url = `http://127.0.0.1:${port}/inference`;

  async function probeEndpoint(timeoutMs = 4000) {
    try {
      return (await makeSttAdapter({ url, timeoutMs }).probe({})).ok;
    } catch {
      return false;
    }
  }

  // 0. Something already listening? Done.
  if (await probeEndpoint()) {
    notify(`Found a running STT endpoint at ${url} — using it.`, "info");
    return { url, mode: "existing-endpoint" };
  }

  // 1. whisper-server binary, with an install-hint-and-recheck loop.
  let detection = detect();
  while (!detection.serverBinary) {
    notify(`whisper-server is not installed.\n${detection.installHint}`, "warning");
    const answer = await ui.select("whisper-server not found", [
      "I installed it — check again",
      "Skip local STT setup",
    ]);
    if (answer === undefined || answer.startsWith("Skip")) return undefined;
    detection = detect();
    if (detection.serverBinary) notify(`Found whisper-server at ${detection.serverBinary}.`, "info");
  }

  // 2. Pick a model: reuse what is on disk, or download after a size warning.
  let modelPath;
  const reuseOptions = detection.models.map((model) => `${model.file} (${model.sizeMb} MB, ${model.path})`);
  const downloadOptions = MODEL_CATALOG.map((model) => `download ${model.id} (${model.sizeMb} MB — ${model.note})`);
  const choice = await ui.select("Whisper model", [...reuseOptions, ...downloadOptions]);
  if (choice === undefined) return undefined;
  const reuseIndex = reuseOptions.indexOf(choice);
  if (reuseIndex >= 0) {
    modelPath = detection.models[reuseIndex].path;
  } else {
    const model = MODEL_CATALOG[downloadOptions.indexOf(choice)];
    const targetDir = join(env.XDG_DATA_HOME || join(home, ".local", "share"), "whisper");
    modelPath = join(targetDir, model.file);
    if (!existsSync(modelPath)) {
      const go = await ui.confirm("Download model?", `Download ${model.file} (${model.sizeMb} MB) from huggingface.co to ${targetDir}?`);
      if (!go) return undefined;
      mkdir(targetDir);
      notify(`Downloading ${model.file} (${model.sizeMb} MB)… this can take a while.`, "info");
      try {
        await download(model.url, modelPath, deps);
      } catch (error) {
        notify(`Model download failed: ${error.message}`, "error");
        return undefined;
      }
      notify("Model downloaded.", "info");
    }
  }

  // 3. Run mode: systemd user service (survives reboots) or manual.
  const systemd = (await runCommand("systemctl", ["--user", "is-system-running"])).code >= 0 &&
    (await runCommand("systemctl", ["--user", "show-environment"])).code === 0;
  const startCommand = manualStartCommand(modelPath, port);

  if (systemd) {
    const auto = await ui.confirm(
      "Start automatically?",
      `Install a user systemd service (${STT_SERVICE_NAME}) so the STT server starts at every login? Note: it keeps the model resident in RAM. Declining shows the manual start command instead.`,
    );
    if (auto) {
      const unitDir = join(env.XDG_CONFIG_HOME || join(home, ".config"), "systemd", "user");
      mkdir(unitDir);
      writeFile(join(unitDir, STT_SERVICE_NAME), serviceUnitText(modelPath, port));
      const reload = await runCommand("systemctl", ["--user", "daemon-reload"]);
      const enable = await runCommand("systemctl", ["--user", "enable", "--now", STT_SERVICE_NAME]);
      if (reload.code !== 0 || enable.code !== 0) {
        notify(`Could not enable the service: ${(enable.stderr || reload.stderr || "unknown error").trim()}\nStart it manually instead:\n  ${startCommand}`, "error");
        return undefined;
      }
      // Model load can take a few seconds; poll the real contract.
      for (let attempt = 0; attempt < 15; attempt++) {
        if (await probeEndpoint(8000)) {
          notify(`STT service is running and verified at ${url} (enabled at login).`, "info");
          return { url, mode: "service" };
        }
        await sleep(2000);
      }
      notify(`The service was enabled but the endpoint did not answer yet. Check: systemctl --user status ${STT_SERVICE_NAME}`, "warning");
      return { url, mode: "service" };
    }
  } else {
    notify("No systemd user session detected; the server has to be started manually (or via your init system).", "warning");
  }

  // Manual path: user starts it in another terminal, we verify.
  notify(`Start the server yourself (e.g. in another terminal):\n  ${startCommand}`, "info");
  const started = await ui.confirm("Verify endpoint", "Press confirm once the server is running and I will verify the endpoint.");
  if (started && (await probeEndpoint(8000))) {
    notify(`STT endpoint verified at ${url}. Remember to start it again after a reboot.`, "info");
    return { url, mode: "manual" };
  }
  if (started) notify(`The endpoint at ${url} did not answer. You can re-run /talk setup or /talk doctor stt later.`, "warning");
  return started ? { url, mode: "manual" } : undefined;
}
