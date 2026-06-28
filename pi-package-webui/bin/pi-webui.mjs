#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { access, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { AuthStorage, SessionManager, SettingsManager, DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { authProvidersPayload, createAuthContext, logoutStoredProvider } from "../lib/auth-actions.mjs";
import {
  collectOpenSessionFiles,
  deleteSessionFile,
  isSessionPathAllowed,
  renameSessionMetadata,
  validateSessionDelete,
} from "../lib/session-actions.mjs";
import { sweepStaleTempEntries } from "../lib/temp-artifacts.mjs";
import {
  evaluateDispatchTrustGuards,
  guardsForNativeCommand,
  isLocalRequest,
  remoteShellTrustWarning,
  requireLocalhost,
  requireLocalhostRoute,
} from "../lib/trust-boundaries.mjs";
import {
  nativeCommandBlocked,
  nativeCommandResponse,
  nativeCommandUnavailable,
  nativeSlashCommandEntries,
  parseSlashCommand as parseNativeSlashCommand,
} from "../lib/native-command-adapter.mjs";
import {
  WORKTREE_ERROR_CODES,
  createGitWorktree,
  gitWorktreeErrorPayload,
  listGitWorktrees,
  openGitWorktree,
  pathInside,
  removeGitWorktree,
} from "../lib/git-worktrees.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(__dirname, "..");
const publicDir = path.join(packageRoot, "public");
const webuiHelperExtensionPath = path.join(packageRoot, "webui-rpc-helper.mjs");
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
const OPTIONAL_FEATURE_INSTALL_ROOT_ENV = "PI_WEBUI_OPTIONAL_FEATURE_INSTALL_ROOT";
const WEBUI_SETTINGS_FILE_ENV = "PI_WEBUI_SETTINGS_FILE";
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
let piPackageJson = {};
try {
  const piPackageJsonPath = require.resolve("@earendil-works/pi-coding-agent/package.json", { paths: [packageRoot] });
  piPackageJson = JSON.parse(await readFile(piPackageJsonPath, "utf8"));
} catch {
  piPackageJson = {};
}
const nativeParityMatrix = JSON.parse(await readFile(path.join(packageRoot, "lib", "WEBUI_TUI_NATIVE_PARITY.json"), "utf8"));
const webuiDevServer = isTruthyEnv(process.env.PI_WEBUI_DEV) || isSourceCheckout(packageRoot);
let remoteQrCorePromise = null;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 31415;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PROMPT_REQUEST_TIMEOUT_MS = Math.max(REQUEST_TIMEOUT_MS, Number.parseInt(process.env.PI_WEBUI_PROMPT_TIMEOUT_MS || "7200000", 10) || 7200000);
const WEBUI_HELPER_TIMEOUT_MS = 8 * 1000;
const WEBUI_HELPER_COMMAND = "webui-helper";
const WEBUI_HELPER_RESPONSE_PREFIX = "__PI_WEBUI_HELPER_RESPONSE__:";
const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
const WEBUI_PACKAGE = packageJson.name || "@firstpick/pi-package-webui";
const PI_LATEST_VERSION_URL = process.env.PI_WEBUI_PI_LATEST_VERSION_URL || "https://pi.dev/api/latest-version";
const NPM_REGISTRY_URL = (process.env.PI_WEBUI_NPM_REGISTRY_URL || "https://registry.npmjs.org").replace(/\/+$/, "");
const UPDATE_STATUS_CACHE_MS = 10 * 60 * 1000;
const UPDATE_STATUS_TIMEOUT_MS = 10 * 1000;
const PI_UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
const PI_UPDATE_OUTPUT_MAX_CHARS = 120_000;
const UPDATE_PACKAGE_NAMES = [PI_CODING_AGENT_PACKAGE, WEBUI_PACKAGE];
const PACKAGE_UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
const PACKAGE_UPDATE_OUTPUT_MAX_CHARS = 120_000;
const CODEX_USAGE_TIMEOUT_MS = 15 * 1000;
const CODEX_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const OPENAI_CODEX_USAGE_ENDPOINT = process.env.PI_WEBUI_CODEX_USAGE_URL || "https://chatgpt.com/backend-api/wham/usage";
const BODY_LIMIT_BYTES = 1024 * 1024;
const SKILL_FILE_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const PROMPT_BODY_LIMIT_BYTES = 24 * 1024 * 1024;
const UPLOAD_BODY_LIMIT_BYTES = 96 * 1024 * 1024;
const ATTACHMENT_UPLOAD_MAX_FILES = 12;
const ATTACHMENT_UPLOAD_MAX_FILE_BYTES = 64 * 1024 * 1024;
const ATTACHMENT_UPLOAD_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const INLINE_IMAGE_TOTAL_MAX_BYTES = 16 * 1024 * 1024;
const RPC_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const SETTINGS_TRANSPORT_CHOICES = ["sse", "websocket", "websocket-cached", "auto"];
const SETTINGS_HTTP_IDLE_TIMEOUT_CHOICES = [
  { label: "30 sec", timeoutMs: 30_000 },
  { label: "1 min", timeoutMs: 60_000 },
  { label: "2 min", timeoutMs: 120_000 },
  { label: "5 min", timeoutMs: 300_000 },
  { label: "disabled", timeoutMs: 0 },
];
const SETTINGS_DOUBLE_ESCAPE_ACTIONS = ["tree", "fork", "none"];
const SETTINGS_TREE_FILTER_MODES = ["default", "no-tools", "user-only", "labeled-only", "all"];
const SETTINGS_IMAGE_WIDTH_CELLS = [60, 80, 120];
const SETTINGS_EDITOR_PADDING_X = [0, 1, 2, 3];
const SETTINGS_AUTOCOMPLETE_MAX_VISIBLE = [3, 5, 7, 10, 15, 20];
const SETTINGS_RELOAD_RECOMMENDED_KEYS = new Set(["transport", "httpIdleTimeoutMs", "autoResizeImages", "blockImages", "enableSkillCommands"]);
const SETTINGS_RELOAD_LABELS = new Map([
  ["transport", "Transport"],
  ["httpIdleTimeoutMs", "HTTP idle timeout"],
  ["autoResizeImages", "Auto-resize images"],
  ["blockImages", "Block images"],
  ["enableSkillCommands", "Skill commands"],
]);
const EVENT_HISTORY_LIMIT = 200;
const EXTENSION_UI_BLOCKING_METHODS = new Set(["select", "confirm", "input", "editor"]);
const STATUS_RPC_TIMEOUT_MS = 1_800;
const FAST_PICK_LIMIT = 30;
const PATH_SUGGESTION_LIMIT = 20;
const PATH_SUGGESTION_QUERY_LIMIT = 512;
const PATH_SUGGESTION_SCAN_LIMIT = 5000;
const PATH_SUGGESTION_MAX_OUTPUT_LENGTH = 300000;
const PATH_SUGGESTION_EXCLUDED_DIRS = new Set([".git", "node_modules"]);
const RESTORE_TAB_LIMIT = 30;
const SESSION_SELECTOR_LIMIT = 200;
const TREE_SELECTOR_TEXT_LIMIT = 260;
const NETWORK_REBIND_DELAY_MS = 100;
const NETWORK_REBIND_FORCE_CLOSE_MS = 750;
const NATIVE_DOWNLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TEMP_ROOT = path.join(tmpdir(), "pi-webui-uploads");
const NATIVE_EXPORT_TEMP_ROOT = path.join(tmpdir(), "pi-webui-native-exports");
const UPLOAD_TEMP_TTL_MS = 24 * 60 * 60 * 1000;
const NATIVE_EXPORT_TEMP_TTL_MS = 60 * 60 * 1000;
const TEMP_ARTIFACT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_TAB_TITLE_MAX_LENGTH = 44;
const AUTO_TAB_TITLE_WORD_LIMIT = 8;
const AUTO_TAB_TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "best",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "s",
  "should",
  "that",
  "the",
  "this",
  "to",
  "way",
  "what",
  "whats",
  "when",
  "with",
  "you",
  "your",
]);

const APP_RUNNER_CONFIG_FILE = ".pi-webui-runners.json";
const APP_RUNNER_CUSTOM_LIMIT = 48;
const APP_RUNNER_CUSTOM_ARG_LIMIT = 32;
const APP_RUNNER_FILE_PICKER_LIMIT = 500;
const APP_RUNNER_DETECTION_TIMEOUT_MS = 1_200;
const APP_RUNNER_COMMAND_CACHE_TTL_MS = 30_000;
const APP_RUNNER_OUTPUT_LINE_LIMIT = 1_000;
const APP_RUNNER_OUTPUT_MAX_CHARS = 240_000;
const APP_RUNNER_INPUT_MAX_CHARS = 16_000;
const APP_RUNNER_CONTEXT_DEFAULT_LINES = 80;
const APP_RUNNER_CONTEXT_MAX_LINES = APP_RUNNER_OUTPUT_LINE_LIMIT;
const APP_RUNNER_STOP_GRACE_MS = 2_500;
const APP_RUNNER_PTY_DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const APP_RUNNER_PTY_SCRIPT_CACHE_TTL_MS = 5 * 60 * 1000;
const APP_RUNNER_PYTHON_ENTRIES = ["Main.py", "main.py", "src/main.py", "src/Main.py", "app.py", "src/app.py"];
const APP_RUNNER_JS_ENTRIES = ["main.js", "src/main.js", "index.js", "src/index.js", "server.js", "src/server.js", "app.js", "src/app.js"];
const APP_RUNNER_ZIG_ENTRIES = ["src/main.zig", "main.zig"];
const APP_RUNNER_C_ENTRIES = ["main.c", "src/main.c"];
const APP_RUNNER_CPP_ENTRIES = ["main.cpp", "src/main.cpp", "main.cc", "src/main.cc", "main.cxx", "src/main.cxx"];
const APP_RUNNER_DOCKER_COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const APP_RUNNER_SHELL_SCRIPT_DIRS = ["", "dev", "scripts", "dev/scripts"];
const APP_RUNNER_SHELL_SCRIPT_LIMIT = 24;
const APP_RUNNER_SHELL_EXTENSIONS = new Map([
  [".sh", "bash"],
  [".bash", "bash"],
  [".zsh", "zsh"],
  [".fish", "fish"],
]);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function isTruthyEnv(value) {
  return ["1", "true", "yes", "dev"].includes(String(value || "").trim().toLowerCase());
}

function isSourceCheckout(root) {
  const normalized = String(root || "").replace(/\\/g, "/");
  return normalized.includes("/npm-packages/") && !normalized.includes("/node_modules/");
}

const NATIVE_SLASH_COMMANDS = nativeSlashCommandEntries(nativeParityMatrix);
const NATIVE_SLASH_COMMAND_NAMES = new Set(NATIVE_SLASH_COMMANDS.map((command) => command.name));
const respondNative = (command, data = {}) => nativeCommandResponse(command, data, nativeParityMatrix);
const unavailableNative = (command, details = {}) => nativeCommandUnavailable(command, details, nativeParityMatrix);

function parseSlashCommand(message) {
  return parseNativeSlashCommand(message, NATIVE_SLASH_COMMAND_NAMES);
}
const OPTIONAL_FEATURE_PACKAGES = new Map([
  ["btwCommand", "@firstpick/pi-extension-btw"],
  ["gitWorkflow", "@firstpick/pi-prompts-git-pr"],
  ["releaseNpm", "@firstpick/pi-extension-release-npm"],
  ["releaseAur", "@firstpick/pi-extension-release-aur"],
  ["workflows", "@firstpick/pi-extension-workflows"],
  ["safetyGuard", "@firstpick/pi-extension-safety-guard"],
  ["tuiSkillsCommand", "@firstpick/pi-extension-setup-skills"],
  ["todoProgressWidget", "@firstpick/pi-extension-todo-progress"],
  ["tuiToolsCommand", "@firstpick/pi-extension-tools"],
  ["remoteWebui", "@firstpick/pi-package-remote-webui"],
  ["gitFooterStatus", "@firstpick/pi-extension-git-footer-status"],
  ["statsCommand", "@firstpick/pi-extension-stats"],
  ["themeBundle", "@firstpick/pi-themes-bundle"],
]);
const WEBUI_CONTROLLED_PACKAGES = new Set([WEBUI_PACKAGE, ...OPTIONAL_FEATURE_PACKAGES.values()]);
const PACKAGE_NAME_CACHE = new Map();

function usage() {
  console.log(`pi-webui ${packageJson.version}

Pi Web UI companion server for Pi coding agent RPC mode.

Usage:
  pi-webui [options] [-- <pi args...>]

Options:
  --host <host>       HTTP bind host (default: ${DEFAULT_HOST})
  --port <port>       HTTP port (default: ${DEFAULT_PORT})
  --cwd <path>        Start the first Pi terminal in this working directory
  --pi <command>      Pi executable to spawn (default: bundled dependency, then "pi")
  --no-session        Start Pi RPC with --no-session
  --name <name>       Initial Web UI tab display name
  --remote-auth       Enable startup PIN authentication for non-local clients
  --no-remote-auth    Disable startup PIN authentication
  -h, --help          Show this help
  -v, --version       Print version

If --cwd is omitted, the server starts first and the browser asks for
  the first terminal CWD.

Examples:
  pi-webui
  pi-webui --cwd ~/src/my-project
  pi-webui --port 3000 -- --model anthropic/claude-sonnet-4-5:high
  PI_WEBUI_PI_BIN=/path/to/pi pi-webui --no-session

Security:
  The web UI controls Pi tools. It binds to localhost by default. Remote PIN
  authentication is off by default on first use; enabling it in Controls saves
  that preference for later starts.
`);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    host: process.env.PI_WEBUI_HOST || DEFAULT_HOST,
    port: Number.parseInt(process.env.PI_WEBUI_PORT || String(DEFAULT_PORT), 10),
    cwd: process.cwd(),
    cwdExplicit: false,
    piBin: process.env.PI_WEBUI_PI_BIN || "pi",
    piBinExplicit: !!process.env.PI_WEBUI_PI_BIN,
    noSession: false,
    name: undefined,
    remoteAuth: isTruthyEnv(process.env.PI_WEBUI_REMOTE_AUTH),
    remoteAuthExplicit: process.env.PI_WEBUI_REMOTE_AUTH !== undefined,
    piArgs: [],
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      options.piArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }
    if (arg === "--host") {
      options.host = takeValue(argv, i, arg);
      i++;
      continue;
    }
    if (arg === "--port") {
      const value = Number.parseInt(takeValue(argv, i, arg), 10);
      if (!Number.isFinite(value) || value <= 0 || value > 65535) {
        throw new Error("--port must be a TCP port between 1 and 65535");
      }
      options.port = value;
      i++;
      continue;
    }
    if (arg === "--cwd") {
      options.cwd = path.resolve(expandUserPath(takeValue(argv, i, arg)));
      options.cwdExplicit = true;
      i++;
      continue;
    }
    if (arg === "--pi") {
      options.piBin = takeValue(argv, i, arg);
      options.piBinExplicit = true;
      i++;
      continue;
    }
    if (arg === "--no-session") {
      options.noSession = true;
      continue;
    }
    if (arg === "--name") {
      options.name = takeValue(argv, i, arg);
      i++;
      continue;
    }
    if (arg === "--remote-auth") {
      options.remoteAuth = true;
      options.remoteAuthExplicit = true;
      continue;
    }
    if (arg === "--no-remote-auth") {
      options.remoteAuth = false;
      options.remoteAuthExplicit = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}. Pass Pi CLI args after --.`);
  }

  if (!Number.isFinite(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("Invalid PI_WEBUI_PORT; expected a TCP port between 1 and 65535");
  }

  return options;
}

async function validateStartupCwd(cwd) {
  const normalized = path.resolve(String(cwd || ""));
  let info;
  try {
    info = await stat(normalized);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw new Error(`--cwd does not exist: ${normalized}`);
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw new Error(`--cwd is not accessible: ${normalized}`);
    }
    throw new Error(`Cannot access --cwd ${normalized}: ${formatCliError(error)}`);
  }
  if (!info.isDirectory()) throw new Error(`--cwd is not a directory: ${normalized}`);
  return normalized;
}

function isLocalHost(host) {
  return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
}

function formatUrlHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function sanitizeError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.stack || error.message || String(error);
}

function formatCliError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateLongText(value, maxLength = 8000) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stripAnsi(text) {
  return String(text ?? "").replace(/(?:\x1B|\u241B)(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function parsePackageVersion(version) {
  const match = String(version || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  };
}

function comparePackageVersions(leftVersion, rightVersion) {
  const left = parsePackageVersion(leftVersion);
  const right = parsePackageVersion(rightVersion);
  if (!left || !right) return undefined;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function isNewerPackageVersion(candidateVersion, currentVersion) {
  const comparison = comparePackageVersions(candidateVersion, currentVersion);
  if (comparison !== undefined) return comparison > 0;
  return String(candidateVersion || "").trim() !== String(currentVersion || "").trim();
}

async function fetchJsonWithTimeout(url, { timeoutMs = UPDATE_STATUS_TIMEOUT_MS, headers = {} } = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
  return response.json();
}

class PiRpcProcess {
  constructor({ command, args, displayCommand, cwd }) {
    this.command = command;
    this.args = args;
    this.displayCommand = displayCommand;
    this.cwd = cwd;
    this.child = undefined;
    this.pending = new Map();
    this.listeners = new Set();
    this.startedAt = new Date().toISOString();
  }

  start() {
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child.on("error", (error) => {
      const message = sanitizeError(error);
      this.emit({ type: "pi_process_error", error: message });
      this.rejectAll(new Error(message));
    });

    this.child.on("exit", (code, signal) => {
      this.emit({ type: "pi_process_exit", code, signal });
      this.rejectAll(new Error(`Pi RPC process exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`));
    });

    this.attachJsonlReader(this.child.stdout, (line) => this.handleStdoutLine(line));
    this.attachTextReader(this.child.stderr, (text) => {
      if (text.length > 0) {
        process.stderr.write(text);
        this.emit({ type: "pi_stderr", text });
      }
    });

    this.emit({ type: "pi_process_start", pid: this.child.pid, cwd: this.cwd, command: this.displayCommand, args: this.args });
  }

  isRunning() {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("webui listener failed:", error);
      }
    }
  }

  attachJsonlReader(stream, onLine) {
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    stream.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        onLine(line);
      }
    });

    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.length > 0) {
        onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      }
    });
  }

  attachTextReader(stream, onText) {
    const decoder = new StringDecoder("utf8");
    stream.on("data", (chunk) => onText(typeof chunk === "string" ? chunk : decoder.write(chunk)));
    stream.on("end", () => {
      const tail = decoder.end();
      if (tail) onText(tail);
    });
  }

  handleStdoutLine(line) {
    if (!line.trim()) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.emit({ type: "pi_stdout_parse_error", line, error: sanitizeError(error) });
      return;
    }

    if (event?.type === "response" && event.id && this.pending.has(event.id)) {
      const pending = this.pending.get(event.id);
      this.pending.delete(event.id);
      clearTimeout(pending.timeout);
      pending.resolve(event);
    }

    this.emit(event);
  }

  send(command, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!this.isRunning() || !this.child?.stdin) {
      return Promise.reject(new Error("Pi RPC process is not running"));
    }

    const id = command.id || randomUUID();
    const payload = { ...command, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for RPC response to ${command.type}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.writeRaw(payload).catch((error) => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async writeRaw(command) {
    if (!this.isRunning() || !this.child?.stdin) {
      throw new Error("Pi RPC process is not running");
    }

    const line = `${JSON.stringify(command)}\n`;
    if (!this.child.stdin.write(line)) {
      await new Promise((resolve) => this.child.stdin.once("drain", resolve));
    }
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    setTimeout(() => {
      if (this.child && this.child.exitCode === null) this.child.kill("SIGKILL");
    }, 3000).unref();
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function makeHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendError(res, statusCode, error) {
  const message = statusCode >= 500 ? sanitizeError(error) : formatCliError(error);
  sendJson(res, statusCode, { ok: false, error: message });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let scaled = value / 1024;
  for (const unit of units) {
    if (scaled < 1024 || unit === units[units.length - 1]) return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${unit}`;
    scaled /= 1024;
  }
  return `${value} B`;
}

async function readJsonBody(req, { limitBytes = BODY_LIMIT_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw makeHttpError(413, `Request body too large (limit ${formatBytes(limitBytes)})`);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function parseCookieHeader(header = "") {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      try {
        cookies.set(name, decodeURIComponent(value));
      } catch {
        cookies.set(name, value);
      }
    }
  }
  return cookies;
}

function safeTimingEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeReturnPath(value) {
  const text = String(value || "/").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text;
}

function remoteAuthCookie(token = remoteAuth.token) {
  const maxAge = Math.max(0, Math.floor((remoteAuth.tokenExpiresAt - Date.now()) / 1000));
  return `pi_remote_auth=${encodeURIComponent(token || "")}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearRemoteAuthCookie() {
  return "pi_remote_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function requestHasRemoteAuth(req) {
  if (!remoteAuthRequired()) return true;
  const token = parseCookieHeader(req.headers.cookie).get("pi_remote_auth");
  return !!(token && remoteAuth.token && remoteAuth.tokenExpiresAt > Date.now() && safeTimingEqual(token, remoteAuth.token));
}

function isRemoteAuthPublicPath(pathname) {
  return pathname === "/remote-auth" || pathname === "/api/remote-auth" || pathname === "/favicon.svg";
}

function shouldChallengeRemoteAuth(req, url) {
  if (isLocalRequest(req) || !remoteAuthRequired() || isRemoteAuthPublicPath(url.pathname)) return false;
  return !requestHasRemoteAuth(req);
}

function sendRemoteAuthPage(res, returnPath = "/") {
  const safeReturn = safeReturnPath(returnPath);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pi Web UI Remote PIN</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e5e7eb; }
    body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 24px; box-sizing: border-box; }
    main { width: min(420px, 100%); padding: 28px; border: 1px solid rgba(148, 163, 184, 0.28); border-radius: 20px; background: rgba(15, 23, 42, 0.92); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); }
    h1 { margin: 0 0 8px; font-size: 1.45rem; }
    p { margin: 0 0 20px; color: #94a3b8; line-height: 1.5; }
    label { display: block; margin-bottom: 8px; color: #cbd5e1; font-weight: 650; }
    input { width: 100%; box-sizing: border-box; border: 1px solid rgba(148, 163, 184, 0.36); border-radius: 14px; padding: 14px 16px; background: #020617; color: #f8fafc; font: inherit; font-size: 1.6rem; letter-spacing: 0.32em; text-align: center; }
    button { width: 100%; margin-top: 16px; border: 0; border-radius: 14px; padding: 14px 16px; background: #22c55e; color: #052e16; font: inherit; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: 0.65; cursor: wait; }
    .error { min-height: 1.4em; margin-top: 14px; color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <h1>Remote PIN required</h1>
    <p>Scan a trusted /remote QR code to unlock automatically, or enter the 4-digit PIN shown in the local Pi terminal or local Web UI.</p>
    <form id="pinForm" autocomplete="off">
      <label for="pin">PIN</label>
      <input id="pin" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autofocus required>
      <button id="submit" type="submit">Unlock Web UI</button>
      <div id="error" class="error" role="alert"></div>
    </form>
  </main>
  <script>
    const returnPath = ${JSON.stringify(safeReturn).replace(/</g, "\\u003c")};
    const form = document.getElementById("pinForm");
    const input = document.getElementById("pin");
    const button = document.getElementById("submit");
    const error = document.getElementById("error");
    function pinFromHash() {
      const params = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
      const pin = String(params.get("pin") || "").trim();
      return /^\\d{4}$/.test(pin) ? pin : "";
    }
    async function submitPin(pin) {
      button.disabled = true;
      error.textContent = "";
      try {
        const response = await fetch("/api/remote-auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true) throw new Error(data.error || "Incorrect PIN");
        window.location.replace(returnPath || "/");
      } catch (err) {
        error.textContent = err?.message || String(err);
        input.select();
      } finally {
        button.disabled = false;
      }
    }
    input.addEventListener("input", () => { input.value = input.value.replace(/\\D/g, "").slice(0, 4); error.textContent = ""; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitPin(input.value);
    });
    const autoPin = pinFromHash();
    if (autoPin) {
      input.value = autoPin;
      window.history.replaceState(null, "", window.location.pathname + (window.location.search || ""));
      submitPin(autoPin);
    }
  </script>
</body>
</html>`;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function sendRemoteAuthRequired(req, res, url) {
  const acceptsHtml = String(req.headers.accept || "").includes("text/html");
  if (req.method === "GET" && (acceptsHtml || url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/remote-auth")) {
    sendRemoteAuthPage(res, `${url.pathname}${url.search || ""}`);
    return;
  }
  sendJson(res, 401, { ok: false, error: "Remote PIN required", remoteAuthRequired: true }, { "www-authenticate": "PiRemotePin" });
}

function sendSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function rpcSuccess(command, data = {}) {
  return { type: "response", command, success: true, data };
}

const nativeDownloadTokens = new Map();

function pruneNativeDownloadTokens(now = Date.now()) {
  for (const [token, item] of nativeDownloadTokens) {
    if (!item || item.expiresAt <= now) nativeDownloadTokens.delete(token);
  }
}

function safeDownloadFileName(name, fallback = "pi-export") {
  const text = String(name || fallback).replace(/[\r\n\\/]+/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 180);
}

function contentDispositionHeader(fileName, disposition = "attachment") {
  const safeName = safeDownloadFileName(fileName);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function contentDispositionAttachment(fileName) {
  return contentDispositionHeader(fileName, "attachment");
}

function contentDispositionInline(fileName) {
  return contentDispositionHeader(fileName, "inline");
}

function registerNativeDownload(filePath, { fileName, contentType, command = "native" } = {}) {
  pruneNativeDownloadTokens();
  const token = randomUUID();
  const expiresAt = Date.now() + NATIVE_DOWNLOAD_TOKEN_TTL_MS;
  const record = {
    path: filePath,
    fileName: safeDownloadFileName(fileName || path.basename(filePath)),
    contentType: contentType || MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    command,
    expiresAt,
  };
  nativeDownloadTokens.set(token, record);
  const url = `/api/native-download/${encodeURIComponent(token)}`;
  return {
    url,
    openUrl: record.contentType === MIME_TYPES.get(".html") ? `${url}?disposition=inline` : undefined,
    fileName: record.fileName,
    contentType: record.contentType,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function sendNativeDownload(res, token, { inline = false } = {}) {
  pruneNativeDownloadTokens();
  const item = nativeDownloadTokens.get(token);
  if (!item) throw makeHttpError(404, "Download token expired or not found");
  const fileStats = await stat(item.path).catch(() => null);
  if (!fileStats?.isFile()) {
    nativeDownloadTokens.delete(token);
    throw makeHttpError(404, "Download file expired or not found");
  }
  const canRenderInline = inline === true && item.contentType === MIME_TYPES.get(".html");
  res.writeHead(200, {
    "content-type": item.contentType,
    "content-length": String(fileStats.size),
    "content-disposition": canRenderInline ? contentDispositionInline(item.fileName) : contentDispositionAttachment(item.fileName),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  await new Promise((resolve, reject) => {
    const stream = createReadStream(item.path);
    stream.on("error", reject);
    res.on("error", reject);
    res.on("close", resolve);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

const ACTION_FEEDBACK_REACTIONS = new Set(["up", "down", "question"]);

function trimFeedbackField(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeActionFeedbackItems(body) {
  const rawItems = Array.isArray(body?.feedback) ? body.feedback : Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) throw new Error("feedback is required");
  if (rawItems.length > 20) throw new Error("feedback is limited to 20 reactions per submission");
  return rawItems.map((item, index) => {
    const reaction = String(item?.reaction || "").trim();
    if (!ACTION_FEEDBACK_REACTIONS.has(reaction)) throw new Error(`Invalid feedback reaction at item ${index + 1}`);
    return {
      reaction,
      comment: trimFeedbackField(item?.comment, 800),
      kind: trimFeedbackField(item?.kind || "action", 80),
      title: trimFeedbackField(item?.title || `item ${index + 1}`, 240),
      snippet: trimFeedbackField(item?.snippet, 2000),
      messageIndex: Number.isFinite(Number(item?.messageIndex)) ? Number(item.messageIndex) : index,
      createdAt: trimFeedbackField(item?.createdAt, 80),
    };
  });
}

function actionFeedbackReactionLabel(reaction) {
  if (reaction === "up") return "👍 thumbs up — Good job; repeat this pattern when appropriate.";
  if (reaction === "down") return "👎 thumbs down — avoid or reconsider this target/pattern; prioritize the user comment.";
  return "? question mark — explain this target in detail in the final output.";
}

function formatActionFeedbackLearningPrompt(items) {
  const lines = [
    "The user submitted direct feedback on specific Web UI action or final-output cards from your last run.",
    "Use it to steer future behavior and create or update a concise LEARNING note from this feedback.",
    "Reaction semantics:",
    "- 👍 thumbs up: treat as 'Good job!' and reinforce the action/pattern.",
    "- 👎 thumbs down: avoid or reconsider this target/pattern; include any user comment.",
    "- ? question mark: explain the target in detail in your final output.",
    "",
    "Feedback items:",
  ];

  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${actionFeedbackReactionLabel(item.reaction)}`,
      `   Target (${item.kind}): ${item.title}`,
      item.comment ? `   User comment: ${item.comment}` : undefined,
      item.snippet ? `   Action excerpt:\n${item.snippet.split(/\r?\n/).map((line) => `     ${line}`).join("\n")}` : undefined,
    );
  });

  lines.push(
    "",
    "After processing this feedback, report which LEARNING was created or updated. If any item used '?', include the requested detailed explanation in the final response.",
  );
  return lines.filter((line) => line !== undefined).join("\n");
}

async function handleActionFeedback(tab, body) {
  const feedbackItems = normalizeActionFeedbackItems(body);
  const state = await tab.rpc.send({ type: "get_state" });
  if (state.success === false) return state;
  if (state.data?.isStreaming || state.data?.isCompacting) {
    throw makeHttpError(409, "Wait for the current agent run or compaction to finish before sending feedback.");
  }

  const command = { type: "prompt", message: formatActionFeedbackLearningPrompt(feedbackItems) };
  markTabWorking(tab);
  const response = await tab.rpc.send(command);
  if (response.success === false) markTabIdle(tab);
  return response;
}

function truncateTabTitle(title, maxLength = AUTO_TAB_TITLE_MAX_LENGTH) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function titleCaseTabTitle(title) {
  return title ? `${title.charAt(0).toUpperCase()}${title.slice(1)}` : "";
}

function generatedTabTitleFromPrompt(message) {
  const line = String(message || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("```"));
  if (!line) return "";

  const cleaned = line
    .replace(/https?:\/\/\S+/gi, "link")
    .replace(/^\/+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/[`*_~#>{}\[\]()<>'"“”‘’,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
    .replace(/^(?:please\s+)?(?:help\s+me\s+|i\s+(?:need|want)\s+(?:you\s+to\s+)?)/i, "")
    .replace(/^(?:for|in|on)\s+the\s+/i, "");
  if (!cleaned) return "";

  const words = cleaned.split(/\s+/).map((word) => word.replace(/^[^\w]+|[^\w]+$/g, "")).filter(Boolean);
  const meaningfulWords = words.filter((word) => !AUTO_TAB_TITLE_STOP_WORDS.has(word.toLowerCase()));
  const selectedWords = (meaningfulWords.length >= 3 ? meaningfulWords : words).slice(0, AUTO_TAB_TITLE_WORD_LIMIT);
  return truncateTabTitle(titleCaseTabTitle(selectedWords.join(" ")));
}

function uniqueTabTitle(title, currentTab, maxLength = AUTO_TAB_TITLE_MAX_LENGTH) {
  const base = truncateTabTitle(title, maxLength);
  if (!base) return "";
  const existing = new Set([...tabs.values()].filter((tab) => tab.id !== currentTab?.id).map((tab) => tab.title));
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const suffixText = ` ${suffix}`;
    const candidate = `${truncateTabTitle(base, Math.max(1, maxLength - suffixText.length))}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${truncateTabTitle(base, Math.max(1, maxLength - 4))} ${currentTab?.index || 1}`;
}

const eventHistory = [];

function truncateStatusText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function statusEventSummary(event) {
  const summary = {
    timestamp: new Date().toISOString(),
    type: String(event?.type || "event"),
  };
  for (const key of ["id", "tabId", "tabTitle", "previousTabTitle", "titleSource", "pid", "cwd", "code", "signal", "command", "method", "replayed", "queueLength", "pendingMessageCount", "pendingExtensionUiRequestCount"]) {
    if (event?.[key] !== undefined) summary[key] = event[key];
  }
  if (event?.assistantMessageEvent?.type) summary.updateType = event.assistantMessageEvent.type;
  if (event?.message?.role) summary.messageRole = event.message.role;
  if (event?.error) summary.error = truncateStatusText(event.error);
  if (event?.text && summary.type === "pi_stderr") summary.text = truncateStatusText(event.text);
  return summary;
}

function recordEvent(event) {
  eventHistory.push(statusEventSummary(event));
  if (eventHistory.length > EVENT_HISTORY_LIMIT) eventHistory.splice(0, eventHistory.length - EVENT_HISTORY_LIMIT);
}

function latestEvents(limit = 40) {
  return eventHistory.slice(-Math.max(0, Math.min(EVENT_HISTORY_LIMIT, limit)));
}

function runCommand(command, args, { cwd, timeoutMs = 2000, maxOutputLength = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: undefined, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > maxOutputLength) stdout = stdout.slice(-maxOutputLength);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > maxOutputLength) stderr = stderr.slice(-maxOutputLength);
    });
    child.on("error", (error) => finish({ exitCode: undefined, stdout, stderr: sanitizeError(error), error: sanitizeError(error) }));
    child.on("exit", (exitCode) => finish({ exitCode, stdout, stderr, timedOut: false }));
  });
}

function nodeModulesParentForPackageRoot(root = packageRoot) {
  const parts = root.split(path.sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex >= 0) {
    const parent = parts.slice(0, nodeModulesIndex).join(path.sep);
    return parent || path.parse(root).root;
  }
  return root;
}

function declaredDependencySpec(pkg, packageName) {
  return firstDefined(
    pkg?.dependencies?.[packageName],
    pkg?.optionalDependencies?.[packageName],
    pkg?.devDependencies?.[packageName],
    pkg?.peerDependencies?.[packageName],
  );
}

async function installRootDeclaresPackage(root, packageName) {
  const pkg = await readJsonFileIfExists(path.join(root, "package.json"));
  return declaredDependencySpec(pkg, packageName) !== undefined;
}

async function installRootContainsPackage(root, packageName) {
  return directoryExists(packageNodeModulesPath(path.join(root, "node_modules"), packageName));
}

function configuredAgentNpmRoot() {
  const root = process.env.PI_CODING_AGENT_DIR ? path.resolve(expandUserPath(process.env.PI_CODING_AGENT_DIR)) : agentDir;
  return path.join(root, "npm");
}

async function optionalDependencyInstallRoot() {
  const configuredRoot = process.env[OPTIONAL_FEATURE_INSTALL_ROOT_ENV];
  if (configuredRoot) return path.resolve(expandUserPath(configuredRoot));

  const installRoot = nodeModulesParentForPackageRoot(packageRoot);
  if (await installRootDeclaresPackage(installRoot, "@firstpick/pi-package-webui") || await installRootContainsPackage(installRoot, "@firstpick/pi-package-webui")) return installRoot;

  const agentNpmRoot = configuredAgentNpmRoot();
  if (installRoot !== agentNpmRoot && (await installRootDeclaresPackage(agentNpmRoot, "@firstpick/pi-package-webui") || await installRootContainsPackage(agentNpmRoot, "@firstpick/pi-package-webui"))) return agentNpmRoot;

  if (webuiDevServer) return installRoot;

  throw makeHttpError(
    500,
    `Could not determine a safe optional feature install root. Set ${OPTIONAL_FEATURE_INSTALL_ROOT_ENV} to the Pi package root.`,
  );
}

function minimumPackageVersionFromSpec(spec) {
  const match = String(spec || "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] || "";
}

function packageVersionBelowSpec(currentVersion, spec) {
  const minimum = minimumPackageVersionFromSpec(spec);
  return !!(currentVersion && minimum && isNewerPackageVersion(minimum, currentVersion));
}

function formatCommandForDisplay(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

let optionalPackageNodeModulesRootsCache = null;
async function optionalPackageNodeModulesRoots() {
  if (optionalPackageNodeModulesRootsCache) return optionalPackageNodeModulesRootsCache;
  const roots = [];
  const seen = new Set();
  const add = (root) => {
    if (!root) return;
    const normalized = path.resolve(root);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    roots.push(normalized);
  };
  const configuredRoot = process.env[OPTIONAL_FEATURE_INSTALL_ROOT_ENV];
  if (configuredRoot) add(path.join(path.resolve(expandUserPath(configuredRoot)), "node_modules"));
  add(path.join(packageRoot, "node_modules"));
  add(path.join(nodeModulesParentForPackageRoot(packageRoot), "node_modules"));
  add(path.join(configuredAgentNpmRoot(), "node_modules"));
  const npmGlobalRoot = await npmGlobalNodeModulesRoot();
  if (npmGlobalRoot) add(npmGlobalRoot);
  for (const bunRoot of await bunGlobalNodeModulesRoots()) add(bunRoot);
  optionalPackageNodeModulesRootsCache = roots;
  return roots;
}

async function optionalPackageCandidateRoots(packageName) {
  return (await optionalPackageNodeModulesRoots()).map((root) => packageNodeModulesPath(root, packageName));
}

async function resolveInstalledPackageRoot(packageName) {
  const workspaceRoot = await workspacePackageRootForName(packageName);
  if (workspaceRoot) return workspaceRoot;
  for (const candidate of await optionalPackageCandidateRoots(packageName)) {
    if (await directoryExists(candidate)) return candidate;
  }
  return null;
}

async function resolveInstalledPackageSubpath(packageName, subpath = "") {
  const root = await resolveInstalledPackageRoot(packageName);
  if (!root) return null;
  const candidate = path.join(root, subpath || "");
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function optionalFeatureDeclaredSpec(packageName) {
  return declaredDependencySpec(packageJson, packageName) || "";
}

async function optionalFeaturePackageStatus(featureId) {
  const packageName = OPTIONAL_FEATURE_PACKAGES.get(featureId);
  if (!packageName) throw makeHttpError(400, `Unknown optional feature: ${featureId}`);
  const declaredSpec = optionalFeatureDeclaredSpec(packageName);
  const installedRoot = await resolveInstalledPackageRoot(packageName);
  const manifest = installedRoot ? await readJsonFileIfExists(path.join(installedRoot, "package.json")) : null;
  const installedVersion = typeof manifest?.version === "string" ? manifest.version : "";
  const updateAvailable = !!(installedVersion && packageVersionBelowSpec(installedVersion, declaredSpec));
  return {
    featureId,
    packageName,
    declaredSpec,
    installed: !!installedRoot,
    installedVersion,
    installedRoot,
    updateAvailable,
    updateReason: updateAvailable ? `installed ${installedVersion} is older than Web UI expects (${declaredSpec})` : "",
  };
}

async function optionalFeaturePackageStatuses() {
  const features = [];
  for (const featureId of OPTIONAL_FEATURE_PACKAGES.keys()) features.push(await optionalFeaturePackageStatus(featureId));
  return { features };
}

async function installOptionalFeaturePackage(featureId) {
  const beforeStatus = await optionalFeaturePackageStatus(featureId);
  const packageName = beforeStatus.packageName;

  const installRoot = await optionalDependencyInstallRoot();
  const npmCommand = process.env.PI_WEBUI_NPM_BIN || "npm";
  const args = ["install", "--prefix", installRoot, packageName];
  const result = await runCommand(npmCommand, args, {
    cwd: installRoot,
    timeoutMs: 5 * 60 * 1000,
    maxOutputLength: 80000,
  });
  const command = formatCommandForDisplay(npmCommand, args);
  const ok = result.exitCode === 0 && !result.timedOut && !result.error;
  if (!ok) {
    const details = [result.error, result.timedOut ? "timed out" : undefined, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n");
    throw makeHttpError(500, `Optional feature install failed: ${command}${details ? `\n${details}` : ""}`);
  }
  const afterStatus = await optionalFeaturePackageStatus(featureId);
  const operation = beforeStatus.installed ? "Updated" : "Installed";
  return {
    featureId,
    packageName,
    installRoot,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    status: afterStatus,
    message: `${operation} optional feature package ${packageName}${afterStatus.installedVersion ? ` to ${afterStatus.installedVersion}` : ""}. Reload the active Pi tab to load new resources.`,
  };
}

function displayPath(cwd) {
  const normalized = cwd.replace(/\\/g, "/");
  const home = (process.env.USERPROFILE || process.env.HOME || "").replace(/\\/g, "/");
  if (home && normalized.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${normalized.slice(home.length)}` || "~";
  }
  return normalized;
}

function expandUserPath(value) {
  const input = String(value || "").trim();
  if (input === "~") {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) throw makeHttpError(400, "Cannot expand ~ because no home directory is configured");
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) throw makeHttpError(400, "Cannot expand ~ because no home directory is configured");
    return path.join(home, input.slice(2));
  }
  return input;
}

async function resolveCwd(value, baseCwd = options.cwd) {
  const input = expandUserPath(value);
  if (!input) throw makeHttpError(400, "cwd is required");
  const cwd = path.resolve(baseCwd, input);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw makeHttpError(400, `cwd does not exist: ${cwd}`);
  }
  if (!info.isDirectory()) throw makeHttpError(400, `cwd is not a directory: ${cwd}`);
  return cwd;
}

function uniquePathItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item?.cwd || seen.has(item.cwd)) continue;
    seen.add(item.cwd);
    result.push(item);
  }
  return result;
}

function normalizePathFastPicks(value) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.picks) ? value.picks : [];
  const seen = new Set();
  const picks = [];
  for (const item of items) {
    const rawCwd = typeof item === "string" ? item : item?.cwd;
    if (!rawCwd) continue;
    let cwd;
    try {
      cwd = path.resolve(options.cwd, expandUserPath(rawCwd));
    } catch {
      continue;
    }
    if (!cwd || seen.has(cwd)) continue;
    seen.add(cwd);
    const displayCwd = String(typeof item === "object" && item?.displayCwd ? item.displayCwd : displayPath(cwd)).slice(0, 4096);
    picks.push({ cwd, displayCwd });
    if (picks.length >= FAST_PICK_LIMIT) break;
  }
  return picks;
}

function fastPicksStorageFile() {
  if (process.env.PI_WEBUI_FAST_PICKS_FILE) return path.resolve(expandUserPath(process.env.PI_WEBUI_FAST_PICKS_FILE));
  const stateRoot = process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
  return path.join(stateRoot, "pi-webui", "fast-picks.json");
}

let pathFastPicksCache = null;

async function readPathFastPicks() {
  if (pathFastPicksCache) return pathFastPicksCache;
  try {
    const parsed = JSON.parse(await readFile(fastPicksStorageFile(), "utf8"));
    pathFastPicksCache = normalizePathFastPicks(parsed);
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`failed to read path fast picks: ${sanitizeError(error)}`);
    pathFastPicksCache = [];
  }
  return pathFastPicksCache;
}

async function writePathFastPicks(picks) {
  const normalized = normalizePathFastPicks(picks);
  const storageFile = fastPicksStorageFile();
  await mkdir(path.dirname(storageFile), { recursive: true });
  const tmpFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify({ version: 1, picks: normalized }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpFile, storageFile);
  pathFastPicksCache = normalized;
  return normalized;
}

function webuiSettingsFile() {
  if (process.env[WEBUI_SETTINGS_FILE_ENV]) return path.resolve(expandUserPath(process.env[WEBUI_SETTINGS_FILE_ENV]));
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(configRoot, "pi-webui", "settings.json");
}

function normalizeWebuiSettings(value) {
  return {
    version: 1,
    remoteAuthEnabled: value?.remoteAuthEnabled === true,
  };
}

let webuiSettingsCache = null;

async function readWebuiSettings() {
  if (webuiSettingsCache) return webuiSettingsCache;
  webuiSettingsCache = normalizeWebuiSettings(await readJsonFileIfExists(webuiSettingsFile()));
  return webuiSettingsCache;
}

async function writeWebuiSettings(patch) {
  const current = await readWebuiSettings();
  const next = normalizeWebuiSettings({ ...current, ...(patch || {}) });
  const storageFile = webuiSettingsFile();
  await mkdir(path.dirname(storageFile), { recursive: true });
  const tmpFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpFile, storageFile);
  webuiSettingsCache = next;
  return next;
}

async function readPersistedRemoteAuthEnabled() {
  return (await readWebuiSettings()).remoteAuthEnabled === true;
}

async function saveRemoteAuthPreference(enabled) {
  const nextEnabled = enabled === true;
  await writeWebuiSettings({ remoteAuthEnabled: nextEnabled });
  persistedRemoteAuthEnabled = nextEnabled;
  return persistedRemoteAuthEnabled;
}

function parseCliScopedModelPatterns() {
  for (let index = 0; index < options.piArgs.length; index++) {
    const arg = options.piArgs[index];
    if (arg === "--models" && options.piArgs[index + 1]) return options.piArgs[index + 1].split(",").map((item) => item.trim()).filter(Boolean);
    if (arg.startsWith("--models=")) return arg.slice("--models=".length).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

async function readJsonFileIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    console.warn(`failed to read ${filePath}: ${sanitizeError(error)}`);
    return undefined;
  }
}

const appRunnerCommandAvailability = new Map();
let appRunnerPtyScriptAvailability = { available: false, expiresAt: 0 };

async function fileStatsIfExists(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

async function appRunnerFileExists(cwd, relativePath) {
  const stats = await fileStatsIfExists(path.join(cwd, relativePath));
  return !!stats?.isFile();
}

async function appRunnerDirectoryExists(cwd, relativePath) {
  const stats = await fileStatsIfExists(path.join(cwd, relativePath));
  return !!stats?.isDirectory();
}

async function appRunnerTextIfExists(cwd, relativePath, maxLength = 120_000) {
  try {
    const text = await readFile(path.join(cwd, relativePath), "utf8");
    return text.slice(0, maxLength);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "";
    return "";
  }
}

async function firstExistingRunnerFile(cwd, candidates) {
  for (const candidate of candidates) {
    if (await appRunnerFileExists(cwd, candidate)) return candidate;
  }
  return "";
}

async function appRunnerCommandAvailable(command, cwd) {
  const name = String(command || "").trim();
  if (!name) return false;
  const key = `${name}\0${cwd || ""}`;
  const cached = appRunnerCommandAvailability.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.available;

  const result = await runCommand(name, ["--version"], {
    cwd,
    timeoutMs: APP_RUNNER_DETECTION_TIMEOUT_MS,
    maxOutputLength: 2_000,
  });
  const available = !result.error && !result.timedOut && (result.exitCode === 0 || Boolean(result.stdout || result.stderr));
  appRunnerCommandAvailability.set(key, { available, expiresAt: now + APP_RUNNER_COMMAND_CACHE_TTL_MS });
  return available;
}

function appRunnerPtyDisabled() {
  return APP_RUNNER_PTY_DISABLED_VALUES.has(String(process.env.PI_WEBUI_APP_RUNNER_PTY || "").trim().toLowerCase());
}

async function appRunnerScriptPtyAvailable(cwd) {
  if (process.platform === "win32" || appRunnerPtyDisabled()) return false;
  const now = Date.now();
  if (appRunnerPtyScriptAvailability.expiresAt > now) return appRunnerPtyScriptAvailability.available;
  const result = await runCommand("script", ["--version"], {
    cwd,
    timeoutMs: APP_RUNNER_DETECTION_TIMEOUT_MS,
    maxOutputLength: 4_000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const available = !result.error && !result.timedOut && /util-linux/i.test(output);
  appRunnerPtyScriptAvailability = { available, expiresAt: now + APP_RUNNER_PTY_SCRIPT_CACHE_TTL_MS };
  return available;
}

function appRunnerPackageScripts(pkg) {
  return pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
}

function preferredPackageScript(pkg) {
  const scripts = appRunnerPackageScripts(pkg);
  for (const script of ["dev", "start", "serve"]) {
    if (typeof scripts[script] === "string" && scripts[script].trim()) return script;
  }
  return "";
}

function packageDependencyNames(pkg) {
  return new Set([
    ...Object.keys(pkg?.dependencies || {}),
    ...Object.keys(pkg?.devDependencies || {}),
    ...Object.keys(pkg?.optionalDependencies || {}),
  ]);
}

function appRunnerId(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(":")
    .replace(/[^a-z0-9_.:-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function appRunnerShellCommandLine(command, args = []) {
  return [command, ...args].map(shellQuote).join(" ");
}

async function spawnAppRunnerChild(run) {
  const baseOptions = {
    cwd: run.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  };
  if (await appRunnerScriptPtyAvailable(run.cwd)) {
    run.executionMode = "pty";
    return spawn("script", [
      "-q",
      "-e",
      "-f",
      "-c",
      `stty -echo 2>/dev/null || true; exec ${appRunnerShellCommandLine(run.command, run.args || [])}`,
      "/dev/null",
    ], {
      ...baseOptions,
      env: {
        ...process.env,
        TERM: process.env.TERM || "xterm-256color",
        COLUMNS: process.env.COLUMNS || "120",
        LINES: process.env.LINES || "40",
      },
    });
  }
  run.executionMode = "pipe";
  return spawn(run.command, run.args || [], baseOptions);
}

function appRunnerCandidate({ id, label, kind, command, args = [], projectFile = "", description = "", shortDisplayCommand = "", priority = 100, cwd = "", custom = false, configFile = "" }) {
  return {
    id,
    label,
    kind,
    command,
    args,
    displayCommand: formatCommandForDisplay(command, args),
    shortDisplayCommand,
    projectFile,
    description,
    priority,
    cwd,
    custom,
    configFile,
  };
}

function addAppRunner(runners, runner) {
  if (!runner?.id || !runner.command) return;
  if (runners.some((item) => item.id === runner.id || item.displayCommand === runner.displayCommand)) return;
  runners.push(runner);
}

function appRunnerPathInside(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeProjectRelativePath(value, { allowEmpty = false } = {}) {
  const raw = normalizeSuggestionPath(value).replace(/\0/g, "").trim();
  const withoutDot = raw.replace(/^\.\/+/, "").replace(/\/+$/g, "");
  if (!withoutDot) {
    if (allowEmpty) return "";
    throw makeHttpError(400, "Path to file is required");
  }
  if (path.isAbsolute(withoutDot) || /^[a-z]:\//i.test(withoutDot)) throw makeHttpError(400, "Path must be relative to the project root");
  const parts = withoutDot.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw makeHttpError(400, "Path cannot contain . or .. segments");
  return parts.join("/").slice(0, 4096);
}

function resolveProjectRelativePath(projectRoot, relativePath) {
  const target = path.resolve(projectRoot, relativePath || ".");
  if (!appRunnerPathInside(projectRoot, target)) throw makeHttpError(400, "Path must stay inside the project root");
  return target;
}

async function findAppRunnerProjectRoot(cwd) {
  const start = await resolveCwd(cwd || options.cwd, options.cwd);
  let fallback = "";
  for (let current = start; current; current = path.dirname(current)) {
    if (await appRunnerFileExists(current, APP_RUNNER_CONFIG_FILE)) return current;
    if (!fallback && (await appRunnerFileExists(current, "package.json") || await appRunnerDirectoryExists(current, ".git"))) fallback = current;
    const parent = path.dirname(current);
    if (parent === current) break;
  }
  return fallback || start;
}

function cleanCustomRunnerCommand(value) {
  const command = String(value || "./").trim().replace(/\s+/g, " ") || "./";
  if (command.includes("\0") || /[\r\n]/.test(command)) throw makeHttpError(400, "Command cannot contain newlines or null bytes");
  if (command.length > 512) throw makeHttpError(400, "Command is too long");
  return command === "." ? "./" : command;
}

function customRunnerCommandParts(command) {
  const clean = cleanCustomRunnerCommand(command);
  return clean === "./" ? ["./"] : clean.split(" ").filter(Boolean);
}

function parseCustomRunnerArgs(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "").trim()
      ? String(value || "").trim().split(/\s+/)
      : [];
  const args = [];
  for (const item of rawItems) {
    const text = String(item || "").trim();
    if (!text) continue;
    if (text.includes("\0") || /[\r\n]/.test(text)) throw makeHttpError(400, "Args cannot contain newlines or null bytes");
    if (text.length > 2048) throw makeHttpError(400, "One arg is too long");
    args.push(text);
    if (args.length > APP_RUNNER_CUSTOM_ARG_LIMIT) throw makeHttpError(400, `Too many args; limit is ${APP_RUNNER_CUSTOM_ARG_LIMIT}`);
  }
  return args;
}

function publicCustomRunnerDefinition(runner) {
  const command = cleanCustomRunnerCommand(runner.command);
  const args = parseCustomRunnerArgs(runner.args);
  const filePath = normalizeProjectRelativePath(runner.path || runner.projectFile);
  const commandParts = customRunnerCommandParts(command);
  const effectiveCommand = command === "./" ? `./${filePath}` : commandParts[0];
  const effectiveArgs = command === "./" ? args : [...commandParts.slice(1), filePath, ...args];
  return {
    id: runner.id,
    label: runner.label,
    command,
    path: filePath,
    args,
    displayCommand: formatCommandForDisplay(effectiveCommand, effectiveArgs),
  };
}

function normalizeCustomRunnerDefinition(raw, projectRoot, { strict = false } = {}) {
  const filePath = normalizeProjectRelativePath(raw?.path || raw?.projectFile);
  const absolutePath = resolveProjectRelativePath(projectRoot, filePath);
  const command = cleanCustomRunnerCommand(raw?.command);
  const args = parseCustomRunnerArgs(raw?.args);
  const label = String(raw?.label || path.basename(filePath)).trim().slice(0, 120) || path.basename(filePath);
  const rawId = String(raw?.id || "").trim();
  const id = appRunnerId(rawId || label, command, filePath) || appRunnerId(command, filePath);
  if (!id) throw makeHttpError(400, "Custom runner id could not be generated");
  if (strict && !appRunnerPathInside(projectRoot, absolutePath)) throw makeHttpError(400, "Path must stay inside the project root");
  return { id, label, command, path: filePath, args };
}

function customAppRunnerDiagnostic(severity, message, runner = {}) {
  const source = runner && typeof runner === "object" ? runner : {};
  return {
    severity,
    message,
    runnerId: source.id || "",
    runnerLabel: source.label || "",
    path: source.path || source.projectFile || "",
  };
}

function directCustomRunnerUnavailableReason(filePath, stats) {
  if (process.platform !== "win32" && stats && (stats.mode & 0o111) === 0) {
    return `Path is not executable: ${filePath}. Run chmod +x ${filePath} or set Command to bash, python3, node, etc.`;
  }
  return "";
}

async function customAppRunnerUnavailableReason(projectRoot, runner) {
  const filePath = runner.path;
  let stats;
  try {
    stats = await fileStatsIfExists(resolveProjectRelativePath(projectRoot, filePath));
  } catch (error) {
    return `Cannot access path ${filePath}: ${formatCliError(error)}`;
  }
  if (!stats?.isFile()) return `Path to file does not exist: ${filePath}`;
  const command = cleanCustomRunnerCommand(runner.command);
  const directReason = command === "./" ? directCustomRunnerUnavailableReason(filePath, stats) : "";
  if (directReason) return directReason;
  const commandParts = customRunnerCommandParts(command);
  if (command !== "./" && !await appRunnerCommandAvailable(commandParts[0], projectRoot)) return `Command is not available: ${commandParts[0]}`;
  return "";
}

async function readAppRunnerConfig(projectRoot, { strictRead = false } = {}) {
  const configPath = path.join(projectRoot, APP_RUNNER_CONFIG_FILE);
  let source = {};
  const diagnostics = [];
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      source = parsed;
    } else {
      const message = `${APP_RUNNER_CONFIG_FILE} must contain a JSON object`;
      if (strictRead) throw makeHttpError(400, message);
      diagnostics.push(customAppRunnerDiagnostic("error", message));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      const message = `Cannot read ${APP_RUNNER_CONFIG_FILE}: ${formatCliError(error)}`;
      if (strictRead) throw makeHttpError(400, message);
      diagnostics.push(customAppRunnerDiagnostic("error", message));
      console.warn(`failed to read custom app runner config ${configPath}: ${sanitizeError(error)}`);
    }
  }
  if (source.runners !== undefined && !Array.isArray(source.runners)) {
    const message = `${APP_RUNNER_CONFIG_FILE} runners must be an array`;
    if (strictRead) throw makeHttpError(400, message);
    diagnostics.push(customAppRunnerDiagnostic("error", message));
  }
  const rawRunners = Array.isArray(source.runners) ? source.runners : [];
  const runners = [];
  for (const raw of rawRunners) {
    try {
      const runner = normalizeCustomRunnerDefinition(raw, projectRoot);
      if (runners.some((item) => item.id === runner.id)) {
        diagnostics.push(customAppRunnerDiagnostic("warning", `Duplicate custom runner ignored: ${runner.label || runner.path || runner.id}`, runner));
      } else {
        runners.push(runner);
      }
    } catch (error) {
      const message = `Invalid custom runner ignored: ${formatCliError(error)}`;
      diagnostics.push(customAppRunnerDiagnostic("error", message, raw));
      console.warn(`skipping invalid custom app runner in ${configPath}: ${sanitizeError(error)}`);
    }
    if (runners.length >= APP_RUNNER_CUSTOM_LIMIT) break;
  }
  return { projectRoot, configPath, runners, diagnostics };
}

async function writeAppRunnerConfig(projectRoot, runners) {
  const configPath = path.join(projectRoot, APP_RUNNER_CONFIG_FILE);
  const normalized = [];
  for (const runner of runners) {
    normalized.push(normalizeCustomRunnerDefinition(runner, projectRoot, { strict: true }));
    if (normalized.length >= APP_RUNNER_CUSTOM_LIMIT) break;
  }
  const tmpFile = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify({ version: 1, runners: normalized }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpFile, configPath);
  return { projectRoot, configPath, runners: normalized };
}

async function customAppRunnerCandidate(projectRoot, configPath, runner) {
  const filePath = runner.path;
  if (await customAppRunnerUnavailableReason(projectRoot, runner)) return null;
  const command = cleanCustomRunnerCommand(runner.command);
  const args = parseCustomRunnerArgs(runner.args);
  const commandParts = customRunnerCommandParts(command);
  const effectiveCommand = command === "./" ? `./${filePath}` : commandParts[0];
  const effectiveArgs = command === "./" ? args : [...commandParts.slice(1), filePath, ...args];
  return appRunnerCandidate({
    id: appRunnerId("custom", runner.id),
    label: runner.label || path.basename(filePath),
    kind: "custom",
    command: effectiveCommand,
    args: effectiveArgs,
    projectFile: filePath,
    description: `Custom project runner from ${APP_RUNNER_CONFIG_FILE}`,
    priority: 8,
    cwd: projectRoot,
    custom: true,
    configFile: configPath,
  });
}

async function addCustomAppRunners(runners, cwd) {
  const projectRoot = await findAppRunnerProjectRoot(cwd);
  const config = await readAppRunnerConfig(projectRoot);
  for (const runner of config.runners) {
    const candidate = await customAppRunnerCandidate(projectRoot, config.configPath, runner);
    if (candidate) addAppRunner(runners, candidate);
  }
}

async function getCustomAppRunnerConfigData(tab) {
  const projectRoot = await findAppRunnerProjectRoot(tab?.cwd || options.cwd);
  const config = await readAppRunnerConfig(projectRoot);
  const runners = [];
  for (const runner of config.runners) {
    const unavailableReason = await customAppRunnerUnavailableReason(projectRoot, runner);
    runners.push({
      ...publicCustomRunnerDefinition(runner),
      available: !unavailableReason,
      unavailableReason,
    });
  }
  return {
    projectRoot,
    displayProjectRoot: displayPath(projectRoot),
    configFile: config.configPath,
    displayConfigFile: displayPath(config.configPath),
    relativeConfigFile: APP_RUNNER_CONFIG_FILE,
    runners,
    diagnostics: config.diagnostics,
  };
}

async function saveCustomAppRunner(tab, rawRunner) {
  const projectRoot = await findAppRunnerProjectRoot(tab?.cwd || options.cwd);
  const config = await readAppRunnerConfig(projectRoot, { strictRead: true });
  const normalized = normalizeCustomRunnerDefinition(rawRunner, projectRoot, { strict: true });
  const unavailableReason = await customAppRunnerUnavailableReason(projectRoot, normalized);
  if (unavailableReason) throw makeHttpError(400, unavailableReason);
  const runners = config.runners.filter((runner) => runner.id !== normalized.id);
  if (runners.length >= APP_RUNNER_CUSTOM_LIMIT) throw makeHttpError(400, `Custom runner limit reached (${APP_RUNNER_CUSTOM_LIMIT})`);
  runners.push(normalized);
  await writeAppRunnerConfig(projectRoot, runners);
  return getAppRunnerData(tab);
}

async function deleteCustomAppRunner(tab, runnerId) {
  const id = appRunnerId(String(runnerId || "").replace(/^custom:/, ""));
  if (!id) throw makeHttpError(400, "Custom runner id is required");
  const projectRoot = await findAppRunnerProjectRoot(tab?.cwd || options.cwd);
  const config = await readAppRunnerConfig(projectRoot);
  const runners = config.runners.filter((runner) => runner.id !== id);
  if (runners.length === config.runners.length) throw makeHttpError(404, "Custom runner not found");
  await writeAppRunnerConfig(projectRoot, runners);
  return getAppRunnerData(tab);
}

async function getAppRunnerFileBrowserData(tab, rawPath) {
  const projectRoot = await findAppRunnerProjectRoot(tab?.cwd || options.cwd);
  const relativeDir = normalizeProjectRelativePath(rawPath || "", { allowEmpty: true });
  const absoluteDir = resolveProjectRelativePath(projectRoot, relativeDir || ".");
  const stats = await fileStatsIfExists(absoluteDir);
  if (!stats?.isDirectory()) throw makeHttpError(400, `Not a directory inside project root: ${relativeDir || "."}`);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    throw makeHttpError(error?.code === "EACCES" ? 403 : 400, `Cannot read directory ${relativeDir || "."}: ${sanitizeError(error)}`);
  }
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  const directories = [];
  const files = [];
  for (const entry of sorted) {
    if (entry.name === ".git") continue;
    const entryRelativePath = normalizeSuggestionPath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    if (entry.isDirectory()) directories.push({ name: entry.name, path: entryRelativePath, hidden: entry.name.startsWith(".") });
    else if (entry.isFile()) files.push({ name: entry.name, path: entryRelativePath, hidden: entry.name.startsWith(".") });
    if (directories.length + files.length >= APP_RUNNER_FILE_PICKER_LIMIT) break;
  }
  const parent = relativeDir ? normalizeSuggestionPath(path.posix.dirname(relativeDir)) : "";
  return {
    projectRoot,
    displayProjectRoot: displayPath(projectRoot),
    relativeDir,
    displayRelativeDir: relativeDir || ".",
    parent: relativeDir && parent !== "." ? parent : relativeDir ? "" : null,
    directories,
    files,
    truncated: sorted.length > directories.length + files.length,
  };
}

function packageManagerArgs(manager, script) {
  if (manager === "bun") return ["run", script];
  if (manager === "yarn") return script === "start" ? ["start"] : [script];
  return script === "start" ? ["start"] : ["run", script];
}

async function addPackageManagerRunners(runners, cwd, pkg) {
  const script = preferredPackageScript(pkg);
  if (!script) return;
  const packageManager = String(pkg?.packageManager || "").toLowerCase();
  const [hasBunLock, hasPnpmLock, hasYarnLock, hasPackageLock] = await Promise.all([
    appRunnerFileExists(cwd, "bun.lock").then((exists) => exists || appRunnerFileExists(cwd, "bun.lockb")),
    appRunnerFileExists(cwd, "pnpm-lock.yaml"),
    appRunnerFileExists(cwd, "yarn.lock"),
    appRunnerFileExists(cwd, "package-lock.json"),
  ]);
  const managers = [
    { id: "bun", command: "bun", label: "Bun", hint: hasBunLock || packageManager.startsWith("bun@"), priority: hasBunLock || packageManager.startsWith("bun@") ? 20 : 54 },
    { id: "pnpm", command: "pnpm", label: "pnpm", hint: hasPnpmLock || packageManager.startsWith("pnpm@"), priority: hasPnpmLock || packageManager.startsWith("pnpm@") ? 24 : 58 },
    { id: "npm", command: "npm", label: "npm", hint: hasPackageLock || packageManager.startsWith("npm@") || !packageManager, priority: hasPackageLock || packageManager.startsWith("npm@") || !packageManager ? 28 : 62 },
    { id: "yarn", command: "yarn", label: "Yarn", hint: hasYarnLock || packageManager.startsWith("yarn@"), priority: hasYarnLock || packageManager.startsWith("yarn@") ? 34 : 72 },
  ];

  for (const manager of managers) {
    if (!await appRunnerCommandAvailable(manager.command, cwd)) continue;
    const args = packageManagerArgs(manager.id, script);
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("pkg", manager.id, script),
      label: `${manager.label} ${script}`,
      kind: manager.id === "bun" ? "bun" : "node",
      command: manager.command,
      args,
      projectFile: "package.json",
      description: `${manager.label} package script: ${script}`,
      priority: manager.priority + (manager.hint ? 0 : 12),
    }));
  }
}

async function addNpxFrameworkRunners(runners, cwd, pkg) {
  const dependencyNames = packageDependencyNames(pkg);
  if (!dependencyNames.size || !await appRunnerCommandAvailable("npx", cwd)) return;
  const frameworks = [
    { dep: "vite", label: "npx vite", args: ["--no-install", "vite"], priority: 78 },
    { dep: "next", label: "npx next dev", args: ["--no-install", "next", "dev"], priority: 80 },
    { dep: "astro", label: "npx astro dev", args: ["--no-install", "astro", "dev"], priority: 82 },
    { dep: "@storybook/react", label: "npx storybook dev", args: ["--no-install", "storybook", "dev"], priority: 86 },
    { dep: "storybook", label: "npx storybook dev", args: ["--no-install", "storybook", "dev"], priority: 86 },
  ];
  for (const framework of frameworks) {
    if (!dependencyNames.has(framework.dep)) continue;
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("npx", framework.dep),
      label: framework.label,
      kind: "node",
      command: "npx",
      args: framework.args,
      projectFile: "package.json",
      description: `Detected ${framework.dep} dependency`,
      priority: framework.priority,
    }));
  }
}

async function addNodeEntrypointRunner(runners, cwd, hasPackageJson) {
  if (hasPackageJson) return;
  const entry = await firstExistingRunnerFile(cwd, APP_RUNNER_JS_ENTRIES);
  if (!entry || !await appRunnerCommandAvailable("node", cwd)) return;
  addAppRunner(runners, appRunnerCandidate({
    id: appRunnerId("node", entry),
    label: `node ${entry}`,
    kind: "node",
    command: "node",
    args: [entry],
    projectFile: entry,
    description: "Detected JavaScript entry file",
    priority: 88,
  }));
}

async function addPythonRunners(runners, cwd) {
  const entry = await firstExistingRunnerFile(cwd, APP_RUNNER_PYTHON_ENTRIES);
  if (!entry) return;
  if (await appRunnerCommandAvailable("uv", cwd)) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("python", "uv", entry),
      label: `uv run ${entry}`,
      kind: "python",
      command: "uv",
      args: ["run", entry],
      projectFile: entry,
      description: "Detected Python entry file",
      priority: 36,
    }));
  }
  const pythonCommand = await appRunnerCommandAvailable("python3", cwd) ? "python3" : await appRunnerCommandAvailable("python", cwd) ? "python" : "";
  if (pythonCommand) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("python", pythonCommand, entry),
      label: `${pythonCommand} ${entry}`,
      kind: "python",
      command: pythonCommand,
      args: [entry],
      projectFile: entry,
      description: "Detected Python entry file",
      priority: 68,
    }));
  }
}

async function addRustRunner(runners, cwd) {
  if (!await appRunnerFileExists(cwd, "Cargo.toml") || !await appRunnerCommandAvailable("cargo", cwd)) return;
  addAppRunner(runners, appRunnerCandidate({
    id: "rust:cargo-run",
    label: "cargo run",
    kind: "rust",
    command: "cargo",
    args: ["run"],
    projectFile: "Cargo.toml",
    description: "Detected Rust Cargo project",
    priority: 18,
  }));
}

async function goRunTarget(cwd) {
  if (await appRunnerFileExists(cwd, "main.go")) return ".";
  if (await appRunnerDirectoryExists(cwd, "cmd")) {
    const entries = await readdir(path.join(cwd, "cmd"), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (await appRunnerFileExists(cwd, path.join("cmd", entry.name, "main.go"))) return `./cmd/${entry.name}`;
    }
  }
  return await appRunnerFileExists(cwd, "go.mod") ? "." : "";
}

async function addGoRunner(runners, cwd) {
  const target = await goRunTarget(cwd);
  if (!target || !await appRunnerCommandAvailable("go", cwd)) return;
  addAppRunner(runners, appRunnerCandidate({
    id: appRunnerId("go", target),
    label: `go run ${target}`,
    kind: "go",
    command: "go",
    args: ["run", target],
    projectFile: await appRunnerFileExists(cwd, "go.mod") ? "go.mod" : target,
    description: "Detected Go/Golang app entry",
    priority: 46,
  }));
}

function buildZigHasRunStep(text) {
  return /\.step\(\s*["']run["']/.test(String(text || ""));
}

async function addZigRunner(runners, cwd) {
  if (!await appRunnerCommandAvailable("zig", cwd)) return;
  const buildZig = await appRunnerTextIfExists(cwd, "build.zig");
  if (buildZig && buildZigHasRunStep(buildZig)) {
    addAppRunner(runners, appRunnerCandidate({
      id: "zig:build-run",
      label: "zig build run",
      kind: "zig",
      command: "zig",
      args: ["build", "run"],
      projectFile: "build.zig",
      description: "Detected Zig build.zig run step",
      priority: 44,
    }));
  }
  const entry = await firstExistingRunnerFile(cwd, APP_RUNNER_ZIG_ENTRIES);
  if (entry) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("zig", entry),
      label: `zig run ${entry}`,
      kind: "zig",
      command: "zig",
      args: ["run", entry],
      projectFile: entry,
      description: "Detected Zig app entry file",
      priority: 66,
    }));
  }
}

function firstCmakeExecutableTarget(text) {
  const match = String(text || "").match(/add_executable\s*\(\s*([A-Za-z0-9_.+-]+)/i);
  return match ? match[1] : "";
}

async function addCompiledLanguageRunner(runners, cwd, { language, kind, compiler, entry, outputName, priority }) {
  if (!entry || !await appRunnerCommandAvailable("sh", cwd) || !await appRunnerCommandAvailable(compiler, cwd)) return;
  const output = `.pi-webui-runner/${outputName}`;
  const compileAndRun = `mkdir -p .pi-webui-runner && ${compiler} ${shellQuote(entry)} -o ${shellQuote(output)} && ${shellQuote(`./${output}`)}`;
  addAppRunner(runners, appRunnerCandidate({
    id: appRunnerId(kind, entry),
    label: `${compiler} ${entry}`,
    kind,
    command: "sh",
    args: ["-lc", compileAndRun],
    projectFile: entry,
    description: `Detected ${language} app entry file`,
    priority,
  }));
}

async function addCppRunners(runners, cwd) {
  const cmakeText = await appRunnerTextIfExists(cwd, "CMakeLists.txt");
  const cmakeTarget = firstCmakeExecutableTarget(cmakeText);
  const hasShell = await appRunnerCommandAvailable("sh", cwd);
  if (cmakeTarget && hasShell && await appRunnerCommandAvailable("cmake", cwd)) {
    const configureBuildRun = `cmake -S . -B build && cmake --build build --target ${shellQuote(cmakeTarget)} && ${shellQuote(`./build/${cmakeTarget}`)}`;
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("cmake", cmakeTarget),
      label: `cmake run ${cmakeTarget}`,
      kind: "cpp",
      command: "sh",
      args: ["-lc", configureBuildRun],
      projectFile: "CMakeLists.txt",
      description: "Detected C/C++ CMake executable target",
      priority: 42,
    }));
    return;
  }

  await Promise.all([
    addCompiledLanguageRunner(runners, cwd, {
      language: "C",
      kind: "c",
      compiler: "cc",
      entry: await firstExistingRunnerFile(cwd, APP_RUNNER_C_ENTRIES),
      outputName: "main-c",
      priority: 64,
    }),
    addCompiledLanguageRunner(runners, cwd, {
      language: "C++",
      kind: "cpp",
      compiler: "c++",
      entry: await firstExistingRunnerFile(cwd, APP_RUNNER_CPP_ENTRIES),
      outputName: "main-cpp",
      priority: 65,
    }),
  ]);
}

async function dockerComposePluginAvailable(cwd) {
  const result = await runCommand("docker", ["compose", "version"], {
    cwd,
    timeoutMs: APP_RUNNER_DETECTION_TIMEOUT_MS,
    maxOutputLength: 2_000,
  });
  return !result.error && !result.timedOut && result.exitCode === 0;
}

async function addDockerComposeRunner(runners, cwd) {
  const composeFile = await firstExistingRunnerFile(cwd, APP_RUNNER_DOCKER_COMPOSE_FILES);
  if (!composeFile) return;
  if (await appRunnerCommandAvailable("docker", cwd) && await dockerComposePluginAvailable(cwd)) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("docker-compose", composeFile),
      label: "docker compose up",
      kind: "docker",
      command: "docker",
      args: ["compose", "-f", composeFile, "up"],
      projectFile: composeFile,
      description: "Detected Docker Compose file",
      priority: 82,
    }));
  }
  if (await appRunnerCommandAvailable("docker-compose", cwd)) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("docker-compose-standalone", composeFile),
      label: "docker-compose up",
      kind: "docker",
      command: "docker-compose",
      args: ["-f", composeFile, "up"],
      projectFile: composeFile,
      description: "Detected Docker Compose file",
      priority: 84,
    }));
  }
}

function shellFromShebang(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  if (!firstLine.startsWith("#!")) return "";
  if (/\bfish\b/.test(firstLine)) return "fish";
  if (/\bzsh\b/.test(firstLine)) return "zsh";
  if (/\bbash\b/.test(firstLine)) return "bash";
  if (/\bsh\b/.test(firstLine)) return "bash";
  return "";
}

function shellScriptPriority(relativePath, shell) {
  const base = path.basename(relativePath).replace(/\.(?:sh|bash|zsh|fish)$/i, "").toLowerCase();
  const directory = path.dirname(relativePath).replace(/\\/g, "/");
  const nameRank = ["dev", "start", "run", "serve", "server", "app", "main"].indexOf(base);
  const dirRank = APP_RUNNER_SHELL_SCRIPT_DIRS.indexOf(directory === "." ? "" : directory);
  const shellRank = shell === "bash" ? 0 : shell === "zsh" ? 1 : shell === "fish" ? 2 : 3;
  return 70 + (nameRank === -1 ? 18 : nameRank) + (dirRank === -1 ? 8 : dirRank) + shellRank / 10;
}

async function shellScriptRunnerForFile(cwd, relativePath) {
  const extensionShell = APP_RUNNER_SHELL_EXTENSIONS.get(path.extname(relativePath).toLowerCase()) || "";
  let shell = extensionShell;
  if (!shell) shell = shellFromShebang(await appRunnerTextIfExists(cwd, relativePath, 256));
  if (!shell || !await appRunnerCommandAvailable(shell, cwd)) return null;
  const fileName = path.basename(relativePath);
  const directory = path.dirname(relativePath);
  return appRunnerCandidate({
    id: appRunnerId("shell", shell, relativePath),
    label: fileName,
    kind: "shell",
    command: shell,
    args: [relativePath],
    projectFile: relativePath,
    description: `Detected ${shell} shell script${directory && directory !== "." ? ` in ${directory}` : ""}`,
    priority: shellScriptPriority(relativePath, shell),
  });
}

async function addShellScriptRunners(runners, cwd) {
  const candidates = [];
  for (const directory of APP_RUNNER_SHELL_SCRIPT_DIRS) {
    const absoluteDirectory = path.join(cwd, directory || ".");
    const stats = await fileStatsIfExists(absoluteDirectory);
    if (!stats?.isDirectory()) continue;
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      const extension = path.extname(entry.name).toLowerCase();
      const explicitShellExtension = APP_RUNNER_SHELL_EXTENSIONS.has(extension);
      if (!explicitShellExtension && entry.name.includes(".")) continue;
      candidates.push(relativePath);
    }
  }

  for (const relativePath of candidates.slice(0, APP_RUNNER_SHELL_SCRIPT_LIMIT * 2)) {
    const runner = await shellScriptRunnerForFile(cwd, relativePath);
    if (runner) addAppRunner(runners, runner);
    if (runners.filter((item) => item.kind === "shell").length >= APP_RUNNER_SHELL_SCRIPT_LIMIT) break;
  }
}

function firstTaskFromText(text, names) {
  for (const name of names) {
    const pattern = new RegExp(`^[\\s\"']*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\"']*[:=]`, "m");
    if (pattern.test(text)) return name;
  }
  return "";
}

async function addDenoRunner(runners, cwd) {
  const hasDenoConfig = await appRunnerFileExists(cwd, "deno.json") || await appRunnerFileExists(cwd, "deno.jsonc");
  if (!hasDenoConfig || !await appRunnerCommandAvailable("deno", cwd)) return;
  const configText = (await appRunnerTextIfExists(cwd, "deno.json")) || (await appRunnerTextIfExists(cwd, "deno.jsonc"));
  const task = firstTaskFromText(configText, ["dev", "start", "serve"]);
  if (task) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("deno", task),
      label: `deno task ${task}`,
      kind: "deno",
      command: "deno",
      args: ["task", task],
      projectFile: "deno.json",
      description: "Detected Deno task",
      priority: 52,
    }));
  }
}

async function addTaskFileRunners(runners, cwd) {
  const [justText, makeText] = await Promise.all([
    appRunnerTextIfExists(cwd, "justfile").then((text) => text || appRunnerTextIfExists(cwd, "Justfile")),
    appRunnerTextIfExists(cwd, "Makefile").then((text) => text || appRunnerTextIfExists(cwd, "makefile")),
  ]);
  const justTarget = firstTaskFromText(justText, ["dev", "run", "start"]);
  if (justTarget && await appRunnerCommandAvailable("just", cwd)) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("just", justTarget),
      label: `just ${justTarget}`,
      kind: "task",
      command: "just",
      args: [justTarget],
      projectFile: "Justfile",
      description: "Detected just recipe",
      priority: 74,
    }));
  }
  const makeTarget = firstTaskFromText(makeText, ["dev", "run", "start"]);
  if (makeTarget && await appRunnerCommandAvailable("make", cwd)) {
    addAppRunner(runners, appRunnerCandidate({
      id: appRunnerId("make", makeTarget),
      label: `make ${makeTarget}`,
      kind: "task",
      command: "make",
      args: [makeTarget],
      projectFile: "Makefile",
      description: "Detected Make target",
      priority: 76,
    }));
  }
}

function publicAppRunner(runner) {
  if (!runner) return null;
  const { priority: _priority, ...publicRunner } = runner;
  return publicRunner;
}

async function detectAppRunners(tab) {
  const cwd = tab?.cwd || options.cwd;
  const runners = [];
  const pkg = await readJsonFileIfExists(path.join(cwd, "package.json"));
  await Promise.all([
    addCustomAppRunners(runners, cwd),
    addRustRunner(runners, cwd),
    pkg ? addPackageManagerRunners(runners, cwd, pkg) : Promise.resolve(),
    pkg ? addNpxFrameworkRunners(runners, cwd, pkg) : Promise.resolve(),
    addPythonRunners(runners, cwd),
    addGoRunner(runners, cwd),
    addZigRunner(runners, cwd),
    addCppRunners(runners, cwd),
    addDockerComposeRunner(runners, cwd),
    addShellScriptRunners(runners, cwd),
    addDenoRunner(runners, cwd),
    addTaskFileRunners(runners, cwd),
    addNodeEntrypointRunner(runners, cwd, !!pkg),
  ]);
  return runners
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))
    .map(publicAppRunner);
}

function appRunnerPendingLine(run) {
  if (!run || run.status !== "running") return "";
  return [run.stdoutRemainder, run.stderrRemainder].map((part) => String(part || "")).filter(Boolean).join("");
}

function publicAppRunnerState(run) {
  if (!run) return null;
  return {
    id: run.id,
    runnerId: run.runnerId,
    kind: run.kind,
    label: run.label,
    command: run.command,
    args: run.args,
    displayCommand: run.displayCommand,
    cwd: run.cwd,
    pid: run.pid,
    status: run.status,
    executionMode: run.executionMode || "pipe",
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    signal: run.signal,
    stopping: run.stopping === true,
    truncated: run.truncated === true,
    lineCount: run.lineCount || run.lines?.length || 0,
    lines: Array.isArray(run.lines) ? [...run.lines] : [],
    pendingLine: appRunnerPendingLine(run),
    stdinClosed: run.stdinClosed === true,
    stdinError: run.stdinError || "",
    stdinWrites: run.stdinWrites || 0,
    lastStdinAt: run.lastStdinAt || "",
  };
}

async function getAppRunnerData(tab) {
  const [runners, customRunnerConfig] = await Promise.all([
    detectAppRunners(tab),
    getCustomAppRunnerConfigData(tab),
  ]);
  return {
    cwd: tab.cwd,
    runners,
    customRunnerConfig,
    activeRun: publicAppRunnerState(tab.appRunner),
  };
}

function appendAppRunnerLine(run, line) {
  if (!run) return;
  const text = String(line ?? "");
  run.lines.push(text);
  run.lineCount = (run.lineCount || 0) + 1;
  run.outputChars = (run.outputChars || 0) + text.length + 1;
  while (run.lines.length > APP_RUNNER_OUTPUT_LINE_LIMIT || run.outputChars > APP_RUNNER_OUTPUT_MAX_CHARS) {
    const removed = run.lines.shift();
    run.outputChars -= String(removed || "").length + 1;
    run.truncated = true;
  }
}

function appendAppRunnerChunk(tab, run, chunk, streamName) {
  if (!run || run.status !== "running") return;
  const key = streamName === "stderr" ? "stderrRemainder" : "stdoutRemainder";
  const normalized = `${run[key] || ""}${String(chunk).replace(/\r\n?/g, "\n")}`;
  const lines = normalized.split("\n");
  run[key] = lines.pop() || "";
  for (const line of lines) appendAppRunnerLine(run, line);
  scheduleAppRunnerBroadcast(tab);
}

function flushAppRunnerRemainders(run) {
  for (const key of ["stdoutRemainder", "stderrRemainder"]) {
    if (run?.[key]) {
      appendAppRunnerLine(run, run[key]);
      run[key] = "";
    }
  }
}

function appRunnerStatusLabel(run) {
  if (run?.stopping && run.status === "running") return "stopping";
  if (run?.status === "done") return "exit 0";
  if (run?.status === "failed") return run.signal ? `signal ${run.signal}` : `exit ${run.exitCode ?? "?"}`;
  if (run?.status === "error") return "error";
  return run?.status || "running";
}

function broadcastAppRunnerState(tab) {
  broadcastTabEvent(tab, {
    type: "webui_app_runner_update",
    tabId: tab.id,
    tabTitle: tab.title,
    cwd: tab.cwd,
    command: tab.appRunner?.displayCommand,
    activeRun: publicAppRunnerState(tab.appRunner),
    tabActivity: tabActivitySnapshot(tab),
  });
}

function scheduleAppRunnerBroadcast(tab) {
  if (!tab || tab.appRunnerBroadcastTimer) return;
  tab.appRunnerBroadcastTimer = setTimeout(() => {
    tab.appRunnerBroadcastTimer = null;
    if (tabs.has(tab.id)) broadcastAppRunnerState(tab);
  }, 120);
}

function terminateAppRunnerChild(run, signal = "SIGTERM") {
  if (!run?.child || run.child.killed) return false;
  try {
    if (process.platform !== "win32" && run.pid) process.kill(-run.pid, signal);
    else run.child.kill(signal);
    return true;
  } catch {
    try {
      run.child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

function finishAppRunner(tab, run, patch = {}) {
  if (!run || run.settled) return;
  run.settled = true;
  clearTimeout(run.stopTimer);
  flushAppRunnerRemainders(run);
  run.endedAt = new Date().toISOString();
  run.exitCode = patch.exitCode;
  run.signal = patch.signal;
  run.error = patch.error;
  run.status = patch.error ? "error" : patch.exitCode === 0 ? "done" : "failed";
  run.child = null;
  run.stdinClosed = true;
  run.stopping = false;
  appendAppRunnerLine(run, `# ${appRunnerStatusLabel(run)} after ${Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))}s`);
  if (patch.error) appendAppRunnerLine(run, `# ${patch.error}`);
  recordEvent({ type: "webui_app_runner_exit", tabId: tab.id, tabTitle: tab.title, command: run.displayCommand, code: run.exitCode, signal: run.signal, error: run.error });
  clearTimeout(tab.appRunnerBroadcastTimer);
  tab.appRunnerBroadcastTimer = null;
  broadcastAppRunnerState(tab);
}

function normalizeAppRunnerInputText(value) {
  const text = String(value ?? "");
  if (text.includes("\0")) throw makeHttpError(400, "App runner input cannot contain null bytes");
  if (text.length > APP_RUNNER_INPUT_MAX_CHARS) throw makeHttpError(413, `App runner input is too long; limit is ${APP_RUNNER_INPUT_MAX_CHARS} characters`);
  return text;
}

function sendAppRunnerInput(tab, value, { appendNewline = true, closeStdin = false } = {}) {
  const run = tab?.appRunner;
  if (!run || run.status !== "running") throw makeHttpError(409, "No app runner is running in this tab");
  const stdin = run.child?.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded || run.stdinClosed === true) throw makeHttpError(409, "App runner stdin is closed");
  const text = normalizeAppRunnerInputText(value);
  const chunk = `${text}${appendNewline === false ? "" : "\n"}`;
  if (!chunk && !closeStdin) throw makeHttpError(400, "App runner input is empty");
  let buffered = false;
  try {
    if (closeStdin) {
      if (chunk) stdin.end(chunk, "utf8");
      else stdin.end();
      run.stdinClosed = true;
    } else {
      buffered = stdin.write(chunk, "utf8") === false;
    }
  } catch (error) {
    run.stdinClosed = true;
    run.stdinError = sanitizeError(error);
    throw makeHttpError(409, `App runner stdin write failed: ${run.stdinError}`);
  }
  run.stdinWrites = (run.stdinWrites || 0) + 1;
  run.lastStdinAt = new Date().toISOString();
  const closeSuffix = closeStdin ? " and closed" : "";
  if (chunk) appendAppRunnerLine(run, text ? `# stdin sent (${text.length} char${text.length === 1 ? "" : "s"})${closeSuffix}` : `# stdin sent (Enter)${closeSuffix}`);
  else appendAppRunnerLine(run, "# stdin closed (EOF)");
  recordEvent({ type: "webui_app_runner_stdin", tabId: tab.id, tabTitle: tab.title, command: run.displayCommand, chars: text.length, newline: appendNewline !== false, closed: closeStdin === true });
  scheduleAppRunnerBroadcast(tab);
  return { cwd: tab.cwd, activeRun: publicAppRunnerState(run), inputBuffered: buffered };
}

async function startAppRunner(tab, runnerId) {
  if (tab.appRunner?.status === "running") throw makeHttpError(409, `App runner already running: ${tab.appRunner.displayCommand}`);
  const runners = await detectAppRunners(tab);
  const runner = runners.find((item) => item.id === runnerId) || (runners.length === 1 && !runnerId ? runners[0] : null);
  if (!runner) throw makeHttpError(400, "Selected app runner is unavailable in this tab cwd");

  const run = {
    id: randomUUID(),
    runnerId: runner.id,
    kind: runner.kind,
    label: runner.label,
    command: runner.command,
    args: runner.args || [],
    displayCommand: runner.displayCommand,
    cwd: runner.cwd || tab.cwd,
    status: "running",
    startedAt: new Date().toISOString(),
    lines: [],
    lineCount: 0,
    outputChars: 0,
    stdinClosed: false,
    stdinWrites: 0,
  };
  appendAppRunnerLine(run, `$ ${run.displayCommand}`);
  const child = await spawnAppRunnerChild(run);
  run.child = child;
  run.pid = child.pid;
  tab.appRunner = run;

  child.stdin?.on("error", (error) => {
    run.stdinClosed = true;
    run.stdinError = sanitizeError(error);
    if (run.status === "running") {
      appendAppRunnerLine(run, `# stdin error: ${run.stdinError}`);
      scheduleAppRunnerBroadcast(tab);
    }
  });
  child.stdin?.on("close", () => {
    run.stdinClosed = true;
    if (run.status === "running") scheduleAppRunnerBroadcast(tab);
  });
  child.stdout.on("data", (chunk) => appendAppRunnerChunk(tab, run, chunk, "stdout"));
  child.stderr.on("data", (chunk) => appendAppRunnerChunk(tab, run, chunk, "stderr"));
  child.on("error", (error) => finishAppRunner(tab, run, { error: sanitizeError(error) }));
  child.on("exit", (exitCode, signal) => finishAppRunner(tab, run, { exitCode, signal }));

  recordEvent({ type: "webui_app_runner_start", tabId: tab.id, tabTitle: tab.title, command: run.displayCommand, cwd: run.cwd, pid: run.pid });
  broadcastAppRunnerState(tab);
  return { runners, customRunnerConfig: await getCustomAppRunnerConfigData(tab), activeRun: publicAppRunnerState(run), cwd: tab.cwd };
}

function stopAppRunnerForTab(tab, reason = "stop requested", { force = false } = {}) {
  const run = tab?.appRunner;
  if (!run || run.status !== "running") return false;
  run.stopping = true;
  appendAppRunnerLine(run, `# ${reason}; sending ${force ? "SIGKILL" : "SIGTERM"}`);
  terminateAppRunnerChild(run, force ? "SIGKILL" : "SIGTERM");
  if (!force) {
    clearTimeout(run.stopTimer);
    run.stopTimer = setTimeout(() => {
      if (run.status === "running") {
        appendAppRunnerLine(run, "# app runner did not stop; sending SIGKILL");
        terminateAppRunnerChild(run, "SIGKILL");
        scheduleAppRunnerBroadcast(tab);
      }
    }, APP_RUNNER_STOP_GRACE_MS);
  }
  broadcastAppRunnerState(tab);
  return true;
}

function clearAppRunnerForTab(tab) {
  if (!tab?.appRunner || tab.appRunner.status === "running") return false;
  tab.appRunner = null;
  broadcastAppRunnerState(tab);
  return true;
}

function normalizeAppRunnerContextLineCount(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return APP_RUNNER_CONTEXT_DEFAULT_LINES;
  return Math.max(1, Math.min(APP_RUNNER_CONTEXT_MAX_LINES, number));
}

function appRunnerOutputLinesForContext(run) {
  const lines = Array.isArray(run?.lines) ? [...run.lines] : [];
  const pendingLine = appRunnerPendingLine(run);
  if (pendingLine) lines.push(pendingLine);
  return lines.map((line) => stripAnsi(line).replace(/\r\n?/g, "\n"));
}

function formatAppRunnerContextContent(tab, run, { requestedLineCount, lines, totalAvailableLines }) {
  const status = appRunnerStatusLabel(run);
  const capturedAt = new Date().toISOString();
  const header = [
    "App runner output transferred from Pi Web UI.",
    `Command: ${stripAnsi(run?.displayCommand || run?.command || "app runner")}`,
    `Cwd: ${stripAnsi(run?.cwd || tab?.cwd || "")}`,
    `Status: ${status}`,
    `Captured: last ${lines.length} of ${totalAvailableLines} available line${totalAvailableLines === 1 ? "" : "s"} (requested ${requestedLineCount})`,
    run?.truncated ? "Note: earlier app runner output had already been truncated before this capture." : "",
    `Captured at: ${capturedAt}`,
  ].filter(Boolean);
  return `${header.join("\n")}\n\n\`\`\`\`text\n${lines.join("\n").trimEnd()}\n\`\`\`\``;
}

async function transferAppRunnerContext(tab, body = {}) {
  const run = tab?.appRunner;
  if (!run) throw makeHttpError(409, "No app runner output is available in this tab");
  const requestedLineCount = normalizeAppRunnerContextLineCount(body.lineCount ?? body.lines ?? body.count);
  const allLines = appRunnerOutputLinesForContext(run);
  const lines = allLines.slice(-requestedLineCount);
  if (!lines.some((line) => stripAnsi(line).trim())) throw makeHttpError(400, "App runner output is empty");
  const details = {
    runId: run.id,
    runnerId: run.runnerId,
    command: run.displayCommand || run.command || "",
    cwd: run.cwd || tab.cwd,
    status: run.status || "running",
    requestedLineCount,
    lineCount: lines.length,
    totalAvailableLines: allLines.length,
    truncated: run.truncated === true,
    capturedAt: new Date().toISOString(),
  };
  const content = formatAppRunnerContextContent(tab, run, { requestedLineCount, lines, totalAvailableLines: allLines.length });
  const helperData = await sendWebuiHelperCommand(tab, "app-runner-context", { content, details });
  recordEvent({ type: "webui_app_runner_context", tabId: tab.id, tabTitle: tab.title, command: details.command, lineCount: lines.length, requestedLineCount, delivery: helperData?.delivery || "context" });
  return { ...details, delivery: helperData?.delivery || "context", activeRun: publicAppRunnerState(run) };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numericValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}

function isoTimestamp(value) {
  const number = numericValue(value);
  if (number !== undefined) {
    const milliseconds = number > 1e12 ? number : number * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const padded = `${payload}${"=".repeat((4 - (payload.length % 4)) % 4)}`;
    return JSON.parse(Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function codexAccountIdFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.["https://api.openai.com/auth"];
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId ? accountId : null;
}

function normalizeCodexRateLimitWindow(rawWindow) {
  if (!rawWindow || typeof rawWindow !== "object") return null;
  const windowDurationSeconds = firstDefined(
    numericValue(rawWindow.windowDurationSeconds),
    numericValue(rawWindow.limitWindowSeconds),
    numericValue(rawWindow.limit_window_seconds),
    numericValue(rawWindow.windowDurationMins) !== undefined ? numericValue(rawWindow.windowDurationMins) * 60 : undefined,
  );
  const windowDurationMins = firstDefined(
    numericValue(rawWindow.windowDurationMins),
    windowDurationSeconds !== undefined ? windowDurationSeconds / 60 : undefined,
  );
  const normalized = {
    usedPercent: numericValue(firstDefined(rawWindow.usedPercent, rawWindow.used_percent)),
    windowDurationSeconds,
    windowDurationMins,
    resetAfterSeconds: numericValue(firstDefined(rawWindow.resetAfterSeconds, rawWindow.reset_after_seconds)),
    resetsAt: isoTimestamp(firstDefined(rawWindow.resetsAt, rawWindow.resetAt, rawWindow.reset_at)),
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : null;
}

function normalizeCodexCredits(rawCredits) {
  if (!rawCredits || typeof rawCredits !== "object") return null;
  return {
    hasCredits: booleanValue(firstDefined(rawCredits.hasCredits, rawCredits.has_credits)),
    unlimited: booleanValue(rawCredits.unlimited),
    balance: firstDefined(rawCredits.balance),
    approxLocalMessages: firstDefined(rawCredits.approxLocalMessages, rawCredits.approx_local_messages),
    approxCloudMessages: firstDefined(rawCredits.approxCloudMessages, rawCredits.approx_cloud_messages),
  };
}

function normalizeCodexRateLimitDetails(rawDetails) {
  if (!rawDetails || typeof rawDetails !== "object") return { primary: null, secondary: null };
  return {
    allowed: booleanValue(rawDetails.allowed),
    limitReached: booleanValue(firstDefined(rawDetails.limitReached, rawDetails.limit_reached)),
    primary: normalizeCodexRateLimitWindow(firstDefined(rawDetails.primary, rawDetails.primaryWindow, rawDetails.primary_window)),
    secondary: normalizeCodexRateLimitWindow(firstDefined(rawDetails.secondary, rawDetails.secondaryWindow, rawDetails.secondary_window)),
  };
}

function normalizeCodexRateLimitReachedType(rawType) {
  if (typeof rawType === "string" && rawType) return rawType;
  if (rawType && typeof rawType === "object") {
    const value = firstDefined(rawType.type, rawType.kind);
    return typeof value === "string" && value ? value : null;
  }
  return null;
}

function makeCodexUsageSnapshot({ limitId, limitName, rateLimit, credits, planType, rateLimitReachedType }) {
  const details = normalizeCodexRateLimitDetails(rateLimit);
  return {
    limitId: limitId || null,
    limitName: limitName || null,
    primary: details.primary,
    secondary: details.secondary,
    allowed: details.allowed,
    limitReached: details.limitReached,
    credits: normalizeCodexCredits(credits),
    planType: planType || null,
    rateLimitReachedType: rateLimitReachedType || null,
  };
}

function normalizeCodexUsagePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const planType = firstDefined(payload.planType, payload.plan_type, null);
  const rateLimitReachedType = normalizeCodexRateLimitReachedType(firstDefined(payload.rateLimitReachedType, payload.rate_limit_reached_type));
  const snapshotsByKey = new Map();
  const addSnapshot = (snapshot) => {
    if (!snapshot) return;
    const key = snapshot.limitId || snapshot.limitName || `snapshot-${snapshotsByKey.size + 1}`;
    if (!snapshotsByKey.has(key)) snapshotsByKey.set(key, snapshot);
  };

  const directRateLimits = firstDefined(payload.rateLimits, payload.rate_limits);
  if (directRateLimits && typeof directRateLimits === "object" && (directRateLimits.primary || directRateLimits.primary_window || directRateLimits.primaryWindow)) {
    addSnapshot(makeCodexUsageSnapshot({
      limitId: firstDefined(directRateLimits.limitId, directRateLimits.limit_id, "codex"),
      limitName: firstDefined(directRateLimits.limitName, directRateLimits.limit_name),
      rateLimit: directRateLimits,
      credits: firstDefined(directRateLimits.credits, payload.credits),
      planType: firstDefined(directRateLimits.planType, directRateLimits.plan_type, planType),
      rateLimitReachedType: firstDefined(directRateLimits.rateLimitReachedType, directRateLimits.rate_limit_reached_type, rateLimitReachedType),
    }));
  } else {
    addSnapshot(makeCodexUsageSnapshot({
      limitId: "codex",
      rateLimit: firstDefined(payload.rateLimit, payload.rate_limit),
      credits: payload.credits,
      planType,
      rateLimitReachedType,
    }));
  }

  const byLimitId = firstDefined(payload.rateLimitsByLimitId, payload.rate_limits_by_limit_id);
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    for (const [limitId, rawSnapshot] of Object.entries(byLimitId)) {
      if (!rawSnapshot || typeof rawSnapshot !== "object") continue;
      addSnapshot(makeCodexUsageSnapshot({
        limitId: firstDefined(rawSnapshot.limitId, rawSnapshot.limit_id, limitId),
        limitName: firstDefined(rawSnapshot.limitName, rawSnapshot.limit_name),
        rateLimit: rawSnapshot,
        credits: rawSnapshot.credits,
        planType: firstDefined(rawSnapshot.planType, rawSnapshot.plan_type, planType),
        rateLimitReachedType: firstDefined(rawSnapshot.rateLimitReachedType, rawSnapshot.rate_limit_reached_type),
      }));
    }
  }

  const additionalRateLimits = firstDefined(payload.additionalRateLimits, payload.additional_rate_limits);
  if (Array.isArray(additionalRateLimits)) {
    for (const item of additionalRateLimits) {
      if (!item || typeof item !== "object") continue;
      addSnapshot(makeCodexUsageSnapshot({
        limitId: firstDefined(item.limitId, item.limit_id, item.meteredFeature, item.metered_feature, item.limitName, item.limit_name),
        limitName: firstDefined(item.limitName, item.limit_name),
        rateLimit: firstDefined(item.rateLimit, item.rate_limit),
        credits: item.credits,
        planType,
      }));
    }
  }

  const snapshots = [...snapshotsByKey.values()];
  const selected = snapshots.find((snapshot) => snapshot.limitId === "codex") || snapshots[0] || null;
  const rateLimitsByLimitId = Object.fromEntries(snapshots.filter((snapshot) => snapshot.limitId).map((snapshot) => [snapshot.limitId, snapshot]));
  return {
    planType: planType || selected?.planType || null,
    rateLimitReachedType: rateLimitReachedType || selected?.rateLimitReachedType || null,
    credits: normalizeCodexCredits(payload.credits) || selected?.credits || null,
    selected,
    snapshots,
    rateLimits: selected,
    rateLimitsByLimitId,
  };
}

async function getOpenAICodexUsageCredentials({ forceRefresh = false } = {}) {
  const authStorage = AuthStorage.create();
  const stored = authStorage.get(OPENAI_CODEX_PROVIDER_ID);
  const storedExpires = numericValue(stored?.expires);
  const shouldRefresh = stored?.type === "oauth" && (forceRefresh || storedExpires === undefined || Date.now() + CODEX_TOKEN_REFRESH_SKEW_MS >= storedExpires);
  let accessToken;
  let refreshed = false;

  if (shouldRefresh) {
    try {
      const refreshResult = await authStorage.refreshOAuthTokenWithLock(OPENAI_CODEX_PROVIDER_ID);
      if (refreshResult?.apiKey) {
        accessToken = refreshResult.apiKey;
        refreshed = forceRefresh || refreshResult.newCredentials?.access !== stored?.access;
      }
    } catch (error) {
      if (forceRefresh || !storedExpires || Date.now() >= storedExpires) {
        throw makeHttpError(401, "OpenAI Codex OAuth token refresh failed. Run /login and choose ChatGPT Plus/Pro (Codex Subscription) to re-authenticate.");
      }
      console.warn(`OpenAI Codex token refresh warning: ${sanitizeError(error)}`);
    }
  }

  if (!accessToken) {
    accessToken = await authStorage.getApiKey(OPENAI_CODEX_PROVIDER_ID, { includeFallback: false });
  }
  if (!accessToken) {
    const status = authStorage.getAuthStatus(OPENAI_CODEX_PROVIDER_ID);
    if (status.configured) throw makeHttpError(401, "OpenAI Codex OAuth token is expired or unavailable. Run /login to refresh credentials.");
    throw makeHttpError(401, "OpenAI Codex OAuth is not configured. Run /login and choose ChatGPT Plus/Pro (Codex Subscription).");
  }

  const latest = authStorage.get(OPENAI_CODEX_PROVIDER_ID) || stored || {};
  const accountId = latest.accountId || codexAccountIdFromAccessToken(accessToken);
  if (!accountId) {
    throw makeHttpError(401, "OpenAI Codex account id is unavailable. Run /login and choose ChatGPT Plus/Pro (Codex Subscription) again.");
  }

  return {
    accessToken,
    accountId,
    refreshed,
    source: latest.type === "oauth" ? "stored-oauth" : "api-key",
    expiresAt: numericValue(latest.expires) ? new Date(numericValue(latest.expires)).toISOString() : undefined,
  };
}

async function fetchOpenAICodexUsagePayload(credentials) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CODEX_USAGE_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(OPENAI_CODEX_USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.accessToken}`,
        "chatgpt-account-id": credentials.accountId,
        originator: "pi-webui",
      },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const error = makeHttpError(response.status === 401 ? 401 : 502, `OpenAI Codex usage request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`);
      error.openaiStatus = response.status;
      throw error;
    }
    try {
      return JSON.parse(text || "{}");
    } catch {
      throw makeHttpError(502, "OpenAI Codex usage response was not valid JSON");
    }
  } catch (error) {
    if (error?.name === "AbortError") throw makeHttpError(504, "OpenAI Codex usage request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getOpenAICodexUsageStatus({ forceRefresh = false } = {}) {
  let credentials = await getOpenAICodexUsageCredentials({ forceRefresh });
  let rawPayload;
  try {
    rawPayload = await fetchOpenAICodexUsagePayload(credentials);
  } catch (error) {
    if (error?.openaiStatus === 401 && !credentials.refreshed) {
      credentials = await getOpenAICodexUsageCredentials({ forceRefresh: true });
      rawPayload = await fetchOpenAICodexUsagePayload(credentials);
    } else {
      throw error;
    }
  }

  return {
    available: true,
    providerId: OPENAI_CODEX_PROVIDER_ID,
    source: "chatgpt.com",
    fetchedAt: new Date().toISOString(),
    auth: {
      source: credentials.source,
      expiresAt: credentials.expiresAt,
      refreshed: credentials.refreshed,
    },
    ...normalizeCodexUsagePayload(rawPayload),
  };
}

async function configuredScopedModelPatterns(cwd = options.cwd) {
  const cliPatterns = parseCliScopedModelPatterns();
  if (cliPatterns !== undefined) return { patterns: cliPatterns, source: "cli" };

  const agentDir = process.env.PI_CODING_AGENT_DIR ? path.resolve(expandUserPath(process.env.PI_CODING_AGENT_DIR)) : path.join(homedir(), ".pi", "agent");
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFileIfExists(path.join(agentDir, "settings.json")),
    readJsonFileIfExists(path.join(cwd, ".pi", "settings.json")),
  ]);

  if (Array.isArray(projectSettings?.enabledModels)) return { patterns: projectSettings.enabledModels, source: "project" };
  if (Array.isArray(globalSettings?.enabledModels)) return { patterns: globalSettings.enabledModels, source: "global" };
  return { patterns: [], source: "none" };
}

function stripThinkingSuffix(pattern) {
  const text = String(pattern || "").trim();
  const slashIndex = text.indexOf("/");
  const colonIndex = text.lastIndexOf(":");
  if (colonIndex > (slashIndex === -1 ? -1 : slashIndex)) return text.slice(0, colonIndex);
  return text;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function modelMatchesPattern(model, pattern) {
  const clean = stripThinkingSuffix(pattern).toLowerCase();
  if (!clean) return false;
  const full = `${model.provider}/${model.id}`.toLowerCase();
  const id = String(model.id || "").toLowerCase();
  if (/[?*\[]/.test(clean)) return globToRegExp(clean).test(full) || globToRegExp(clean).test(id);
  return full === clean || id === clean || full.includes(clean) || id.includes(clean);
}

function resolveScopedModelsFromPatterns(patterns, models) {
  const scoped = [];
  const seen = new Set();
  for (const pattern of patterns || []) {
    for (const model of models || []) {
      const key = `${model.provider}/${model.id}`;
      if (seen.has(key) || !modelMatchesPattern(model, pattern)) continue;
      seen.add(key);
      scoped.push(model);
    }
  }
  return scoped;
}

async function getScopedModelData(tab) {
  const { patterns, source } = await configuredScopedModelPatterns(tab.cwd);
  if (!patterns.length) return { models: [], patterns, source };
  const response = await safeRpcResponse(tab, { type: "get_available_models" });
  if (response.success === false) throw makeHttpError(400, response.error || "failed to load available models");
  return { models: resolveScopedModelsFromPatterns(patterns, response.data?.models || []), patterns, source, rpcRunning: response.rpcRunning !== false };
}

function modelKey(model) {
  return model?.provider && model?.id ? `${model.provider}/${model.id}` : "";
}

async function cycleTabModel(tab, direction = "forward") {
  const availableResponse = await tab.rpc.send({ type: "get_available_models" });
  if (availableResponse.success === false) return availableResponse;
  const allModels = Array.isArray(availableResponse.data?.models) ? availableResponse.data.models : [];
  const { patterns, source } = await configuredScopedModelPatterns(tab.cwd);
  const scopedModels = patterns.length ? resolveScopedModelsFromPatterns(patterns, allModels) : [];
  const candidates = scopedModels.length ? scopedModels : allModels;
  if (!candidates.length) throw makeHttpError(400, "No models are available to cycle.");

  const state = await currentSessionState(tab).catch(() => tab.lastState || {});
  const currentKey = modelKey(state.model);
  const currentIndex = candidates.findIndex((model) => modelKey(model) === currentKey);
  const backwards = direction === "backward" || direction === "previous" || direction === "prev";
  let nextIndex;
  if (backwards) nextIndex = currentIndex > 0 ? currentIndex - 1 : candidates.length - 1;
  else nextIndex = currentIndex >= 0 && currentIndex < candidates.length - 1 ? currentIndex + 1 : 0;
  const nextModel = candidates[nextIndex];
  const response = await tab.rpc.send({ type: "set_model", provider: nextModel.provider, modelId: nextModel.id });
  if (response.success === false) return response;
  return rpcSuccess("cycle_model", {
    model: response.data || nextModel,
    direction: backwards ? "backward" : "forward",
    scoped: scopedModels.length > 0,
    scopeSource: scopedModels.length > 0 ? source : "all",
    index: nextIndex,
    count: candidates.length,
    tab: tabMeta(tab),
  });
}

function pathPickerRoots(activeCwd, viewedCwd) {
  const home = process.env.HOME || process.env.USERPROFILE;
  return uniquePathItems([
    { label: "Tab", cwd: activeCwd, displayCwd: displayPath(activeCwd) },
    { label: "Default", cwd: options.cwd, displayCwd: displayPath(options.cwd) },
    home ? { label: "Home", cwd: home, displayCwd: displayPath(home) } : undefined,
    { label: "Root", cwd: path.parse(viewedCwd || activeCwd || options.cwd).root, displayCwd: path.parse(viewedCwd || activeCwd || options.cwd).root },
  ]);
}

async function getDirectoryPickerData(viewPath, activeCwd) {
  const cwd = await resolveCwd(viewPath || activeCwd, activeCwd);
  let entries;
  try {
    entries = await readdir(cwd, { withFileTypes: true });
  } catch (error) {
    throw makeHttpError(error?.code === "EACCES" ? 403 : 400, `Cannot read directory ${cwd}: ${sanitizeError(error)}`);
  }

  const directoryEntries = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const directories = directoryEntries.slice(0, 500).map((entry) => {
    const entryPath = path.join(cwd, entry.name);
    return { name: entry.name, cwd: entryPath, displayCwd: displayPath(entryPath), hidden: entry.name.startsWith(".") };
  });
  const parent = path.dirname(cwd);

  return {
    cwd,
    displayCwd: displayPath(cwd),
    parent: parent === cwd ? null : parent,
    roots: pathPickerRoots(activeCwd, cwd),
    directories,
    truncated: directoryEntries.length > directories.length,
  };
}

function cleanDirectoryCreateName(value) {
  const name = String(value || "").trim();
  if (!name) throw makeHttpError(400, "Directory name is required");
  if (name === "." || name === "..") throw makeHttpError(400, "Directory name cannot be . or ..");
  if (name.includes("\u0000")) throw makeHttpError(400, "Directory name cannot contain null bytes");
  if (name.includes("/") || name.includes("\\")) throw makeHttpError(400, "Create one directory at a time; path separators are not allowed");
  if (name.length > 255) throw makeHttpError(400, "Directory name is too long");
  return name;
}

async function createDirectoryPickerDirectory(parentPath, nameValue, activeCwd) {
  const parent = await resolveCwd(parentPath || activeCwd, activeCwd);
  const name = cleanDirectoryCreateName(nameValue);
  const target = path.resolve(parent, name);
  if (path.dirname(target) !== parent) throw makeHttpError(400, "Directory must be created directly under the current path");

  try {
    await mkdir(target);
  } catch (error) {
    if (error?.code === "EEXIST") throw makeHttpError(409, `Directory already exists: ${target}`);
    if (["EACCES", "EPERM"].includes(error?.code)) throw makeHttpError(403, `Cannot create directory ${target}: ${sanitizeError(error)}`);
    throw makeHttpError(400, `Cannot create directory ${target}: ${sanitizeError(error)}`);
  }

  return getDirectoryPickerData(target, activeCwd);
}

function normalizeSuggestionPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function cleanPathSuggestionQuery(value) {
  return normalizeSuggestionPath(value).replace(/\0/g, "").slice(0, PATH_SUGGESTION_QUERY_LIMIT);
}

function splitSuggestionPathQuery(query) {
  const normalized = normalizeSuggestionPath(query);
  if (normalized === "~") return { displayBase: "~", prefix: "" };
  if (!normalized || normalized.endsWith("/")) return { displayBase: normalized, prefix: "" };
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) return { displayBase: "", prefix: normalized };
  return { displayBase: normalized.slice(0, slashIndex + 1), prefix: normalized.slice(slashIndex + 1) };
}

function resolveSuggestionBase(displayBase, cwd) {
  const base = displayBase || ".";
  if (base === "~" || base.startsWith("~/")) return path.resolve(expandUserPath(base));
  if (base.startsWith("/")) return path.resolve(base);
  return path.resolve(cwd, base);
}

function joinSuggestionDisplayPath(displayBase, name) {
  const base = normalizeSuggestionPath(displayBase);
  if (!base || base === ".") return name;
  if (base === "/") return `/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function pathSuggestionLabel(pathText) {
  const normalized = normalizeSuggestionPath(pathText).replace(/\/+$/, "");
  const name = normalized ? path.posix.basename(normalized) : pathText;
  return `${name || pathText}${pathText.endsWith("/") ? "/" : ""}`;
}

function sortPathSuggestions(items) {
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" });
  });
}

async function getDirectPathSuggestions(query, cwd) {
  const { displayBase, prefix } = splitSuggestionPathQuery(query);
  const searchDir = resolveSuggestionBase(displayBase, cwd);
  let entries;
  try {
    entries = await readdir(searchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const normalizedPrefix = prefix.toLowerCase();
  const suggestions = [];
  for (const entry of entries) {
    if (entry.name === ".git" || (!normalizedPrefix && PATH_SUGGESTION_EXCLUDED_DIRS.has(entry.name))) continue;
    if (normalizedPrefix && !entry.name.toLowerCase().startsWith(normalizedPrefix)) continue;
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(path.join(searchDir, entry.name))).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    const pathText = normalizeSuggestionPath(`${joinSuggestionDisplayPath(displayBase, entry.name)}${isDirectory ? "/" : ""}`);
    suggestions.push({
      path: pathText,
      label: `${entry.name}${isDirectory ? "/" : ""}`,
      type: isDirectory ? "directory" : "file",
      description: pathText,
    });
  }
  return sortPathSuggestions(suggestions).slice(0, PATH_SUGGESTION_LIMIT);
}

function addSuggestionEntry(entries, pathText, isDirectory) {
  const normalized = normalizeSuggestionPath(pathText).replace(/^\.\//, "");
  if (!normalized || normalized === ".git" || normalized.startsWith(".git/")) return;
  const value = isDirectory && !normalized.endsWith("/") ? `${normalized}/` : normalized;
  if (!entries.has(value)) entries.set(value, { path: value, isDirectory });
}

function addSuggestionPathWithParents(entries, pathText) {
  const normalized = normalizeSuggestionPath(pathText).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith(".git/")) return;
  const parts = normalized.split("/").filter(Boolean);
  let parent = "";
  for (let index = 0; index < parts.length - 1; index++) {
    parent = parent ? `${parent}/${parts[index]}` : parts[index];
    addSuggestionEntry(entries, `${parent}/`, true);
  }
  addSuggestionEntry(entries, normalized, false);
}

async function getGitPathSuggestionEntries(cwd) {
  const result = await runCommand("git", ["-C", cwd, "ls-files", "-co", "--exclude-standard"], {
    timeoutMs: 1200,
    maxOutputLength: PATH_SUGGESTION_MAX_OUTPUT_LENGTH,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  const entries = new Map();
  for (const line of result.stdout.split("\n")) addSuggestionPathWithParents(entries, line.trim());
  return [...entries.values()];
}

async function getFilesystemPathSuggestionEntries(cwd) {
  const entries = new Map();
  async function walk(dir, relativeDir = "", depth = 0) {
    if (entries.size >= PATH_SUGGESTION_SCAN_LIMIT || depth > 6) return;
    let dirEntries;
    try {
      dirEntries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of dirEntries) {
      if (entries.size >= PATH_SUGGESTION_SCAN_LIMIT) return;
      const relativePath = normalizeSuggestionPath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = (await stat(path.join(dir, entry.name))).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (isDirectory) {
        addSuggestionEntry(entries, `${relativePath}/`, true);
        if (!PATH_SUGGESTION_EXCLUDED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), relativePath, depth + 1);
      } else {
        addSuggestionEntry(entries, relativePath, false);
      }
    }
  }
  await walk(cwd);
  return [...entries.values()];
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index++;
    if (index >= needle.length) return true;
  }
  return needle.length === 0;
}

function scorePathSuggestion(entry, query) {
  const q = normalizeSuggestionPath(query).replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
  if (!q) return entry.isDirectory ? 2 : 1;
  const entryPath = entry.path.replace(/\/+$/, "").toLowerCase();
  const name = path.posix.basename(entryPath);
  let score = 0;
  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 90;
  else if (entryPath.startsWith(q)) score = 80;
  else if (name.includes(q)) score = 70;
  else if (entryPath.includes(q)) score = 55;
  else if (isSubsequence(q, name)) score = 40;
  else if (isSubsequence(q, entryPath)) score = 25;
  if (entry.isDirectory && score > 0) score += 5;
  return score;
}

function formatRankedPathSuggestions(entries, query) {
  return entries
    .map((entry) => ({ ...entry, score: scorePathSuggestion(entry, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, PATH_SUGGESTION_LIMIT)
    .map((entry) => ({
      path: entry.path,
      label: pathSuggestionLabel(entry.path),
      type: entry.isDirectory ? "directory" : "file",
      description: entry.path,
    }));
}

async function getPathSuggestionData(tab, rawQuery) {
  const query = cleanPathSuggestionQuery(rawQuery);
  const shouldUseDirect = !query || query.includes("/") || query.startsWith(".") || query.startsWith("~");
  let suggestions = shouldUseDirect ? await getDirectPathSuggestions(query, tab.cwd) : [];
  if (suggestions.length === 0 && query) {
    const entries = (await getGitPathSuggestionEntries(tab.cwd)) ?? (await getFilesystemPathSuggestionEntries(tab.cwd));
    suggestions = formatRankedPathSuggestions(entries, query);
  }
  return { cwd: tab.cwd, displayCwd: displayPath(tab.cwd), query, suggestions };
}

async function getWorkspaceInfo(cwd, startedAt) {
  return {
    cwd,
    displayCwd: displayPath(cwd),
    uptimeMs: Math.max(0, Date.now() - Date.parse(startedAt)),
  };
}

let activeGitWorkflowProcess = null;
const GIT_CHANGES_COMMAND_TIMEOUT_MS = 5000;
const GIT_CHANGES_DIFF_MAX_OUTPUT = 500_000;
const GIT_PULL_TIMEOUT_MS = 15 * 60 * 1000;

async function getGitRoot(cwd) {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 2000 });
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || "Not inside a git repository").trim());
  }
  return path.resolve(result.stdout.trim());
}

async function runGitReadCommand(root, args, { timeoutMs = GIT_CHANGES_COMMAND_TIMEOUT_MS, maxOutputLength = GIT_CHANGES_DIFF_MAX_OUTPUT } = {}) {
  const result = await runCommand("git", args, { cwd: root, timeoutMs, maxOutputLength });
  if (result.exitCode === 0 && !result.timedOut && !result.error) return result.stdout;
  const command = formatGitCommand(args);
  const message = result.timedOut
    ? `${command} timed out`
    : (result.stderr || result.stdout || result.error || `${command} failed with exit code ${result.exitCode ?? "unknown"}`);
  throw new Error(String(message).trim());
}

function gitBranchFromPorcelainStatus(statusText) {
  for (const line of String(statusText || "").split(/\r?\n/)) {
    if (!line.startsWith("# branch.head ")) continue;
    const branch = line.slice("# branch.head ".length).trim();
    return branch && branch !== "(detached)" ? branch : "detached";
  }
  return "detached";
}

function addGitPorcelainTrackedSummary(summary, xy) {
  const x = xy?.[0] || ".";
  const y = xy?.[1] || ".";
  if (x !== ".") summary.staged += 1;
  if (y !== ".") summary.unstaged += 1;
}

function summarizeGitPorcelainStatus(statusText) {
  const summary = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ahead: 0, behind: 0 };
  for (const line of String(statusText || "").split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        summary.ahead = Number.parseInt(match[1] || "0", 10) || 0;
        summary.behind = Number.parseInt(match[2] || "0", 10) || 0;
      }
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      addGitPorcelainTrackedSummary(summary, line.split(" ")[1] || "..");
      continue;
    }
    if (line.startsWith("u ")) {
      summary.conflicted += 1;
      continue;
    }
    if (line.startsWith("? ")) summary.untracked += 1;
  }
  return summary;
}

function resolveGitRelativePath(root, relativePath) {
  const normalized = String(relativePath || "").trim();
  if (!normalized || normalized.includes("\0")) throw new Error("Invalid git path");
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Git path escapes repository: ${normalized}`);
  return resolved;
}

function isLikelyBinaryBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.includes(0);
}

function normalizeGitRelativePath(root, relativePath) {
  const resolved = resolveGitRelativePath(root, relativePath);
  return path.relative(root, resolved).split(path.sep).join("/");
}

async function readGitUntrackedEntry(root, file) {
  const normalized = normalizeGitRelativePath(root, file);
  const filePath = resolveGitRelativePath(root, normalized);
  const info = await stat(filePath);
  if (!info.isFile()) return { path: normalized, size: info.size, binary: false, content: "", error: "Not a regular file" };
  const buffer = await readFile(filePath);
  const binary = isLikelyBinaryBuffer(buffer);
  return {
    path: normalized,
    size: info.size,
    binary,
    content: binary ? "" : buffer.toString("utf8"),
  };
}

async function readGitUntrackedEntries(root, files) {
  const entries = [];
  for (const file of files) {
    try {
      entries.push(await readGitUntrackedEntry(root, file));
    } catch (error) {
      entries.push({ path: file, size: 0, binary: false, content: "", error: sanitizeError(error) });
    }
  }
  return entries;
}

async function readGitUntrackedFile(cwd, requestedPath) {
  const root = await getGitRoot(cwd);
  const normalized = normalizeGitRelativePath(root, requestedPath);
  const listed = await runGitReadCommand(root, ["ls-files", "--others", "--exclude-standard", "--", normalized], { maxOutputLength: 120_000 });
  const files = listed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!files.includes(normalized)) throw new Error(`Not an untracked file: ${normalized}`);
  return readGitUntrackedEntry(root, normalized);
}

async function gitUpstreamRef(root) {
  try {
    const upstream = await runGitReadCommand(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { timeoutMs: 5000, maxOutputLength: 10_000 });
    return upstream.trim();
  } catch {
    return "";
  }
}

async function readGitIncomingChanges(root, summary) {
  const upstream = await gitUpstreamRef(root);
  const remote = {
    upstream,
    behind: Number(summary?.behind || 0) || 0,
    canPull: !!upstream && (Number(summary?.behind || 0) || 0) > 0,
  };
  if (!remote.canPull) return { remote, section: null };

  const diffArgs = ["diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=0", "--src-prefix=a/", "--dst-prefix=b/", "HEAD..@{upstream}"];
  try {
    const diff = await runGitReadCommand(root, diffArgs);
    return {
      remote,
      section: {
        key: "incoming",
        label: `Incoming from ${upstream}`,
        command: `git diff --unified=0 HEAD..${upstream}`,
        diff: diff.trimEnd(),
      },
    };
  } catch (error) {
    return { remote: { ...remote, error: sanitizeError(error) }, section: null };
  }
}

async function pullGitChanges(cwd) {
  const root = await getGitRoot(cwd);
  const payload = gitWorkflowCommandPayload(await runGitWorkflowCommand(["pull", "--ff-only"], { cwd: root, timeoutMs: GIT_PULL_TIMEOUT_MS }));
  if (payload.data) payload.data.root = root;
  if (payload.ok) payload.data.changes = await readGitChanges(root);
  else payload.error = (payload.data?.stderr || payload.data?.stdout || payload.error || "git pull --ff-only failed").trim();
  return payload;
}

async function readGitChanges(cwd) {
  const root = await getGitRoot(cwd);
  const diffArgs = ["diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=0", "--src-prefix=a/", "--dst-prefix=b/"];
  const [statusText, porcelainStatusText, unstagedDiff, stagedDiff, untrackedText] = await Promise.all([
    runGitReadCommand(root, ["status", "--short", "--branch", "--untracked-files=all"], { maxOutputLength: 120_000 }),
    runGitReadCommand(root, ["status", "--porcelain=2", "--branch", "--untracked-files=all"], { maxOutputLength: 120_000 }),
    runGitReadCommand(root, diffArgs),
    runGitReadCommand(root, ["diff", "--cached", "--no-ext-diff", "--no-color", "--find-renames", "--unified=0", "--src-prefix=a/", "--dst-prefix=b/"]),
    runGitReadCommand(root, ["ls-files", "--others", "--exclude-standard"], { maxOutputLength: 120_000 }),
  ]);
  const summary = summarizeGitPorcelainStatus(porcelainStatusText);
  const incoming = await readGitIncomingChanges(root, summary);
  const untrackedFiles = untrackedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const untracked = await readGitUntrackedEntries(root, untrackedFiles);
  return {
    cwd,
    root,
    branch: gitBranchFromPorcelainStatus(porcelainStatusText),
    generatedAt: new Date().toISOString(),
    summary,
    remote: incoming.remote,
    status: statusText.trimEnd(),
    sections: [
      incoming.section,
      { key: "staged", label: "Staged", command: "git diff --cached --unified=0", diff: stagedDiff.trimEnd() },
      { key: "unstaged", label: "Unstaged", command: "git diff --unified=0", diff: unstagedDiff.trimEnd() },
    ].filter(Boolean),
    untracked,
  };
}

function gitWorkflowMessageCwd(root, cwd) {
  const messageCwd = path.resolve(String(cwd || root));
  if (!pathInside(root, messageCwd)) throw new Error(`Git workflow cwd must stay inside repository root: ${messageCwd}`);
  return messageCwd;
}

function gitWorkflowMessageFileMeta(root, messageCwd, filePath) {
  return {
    path: filePath,
    relativePath: path.relative(messageCwd, filePath).split(path.sep).join("/"),
    repoRelativePath: path.relative(root, filePath).split(path.sep).join("/"),
  };
}

function commitMessagePaths(baseDir) {
  return {
    shortPath: path.join(baseDir, "dev", "COMMIT", "staged-commit-short.txt"),
    longPath: path.join(baseDir, "dev", "COMMIT", "staged-commit-long.txt"),
    branchPath: path.join(baseDir, "dev", "COMMIT", "staged-branch-name.txt"),
  };
}

async function readGitWorkflowBranchName(cwd) {
  const root = await getGitRoot(cwd);
  const messageCwd = gitWorkflowMessageCwd(root, cwd);
  const { branchPath } = commitMessagePaths(messageCwd);
  try {
    const [branchText, branchStat] = await Promise.all([readFile(branchPath, "utf8"), stat(branchPath)]);
    const branch = branchText.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
    if (!branch) throw new Error(`${branchPath} is empty`);
    const branchFile = gitWorkflowMessageFileMeta(root, messageCwd, branchPath);
    return { root, cwd: messageCwd, branchPath, branchRelativePath: branchFile.relativePath, branchRepoRelativePath: branchFile.repoRelativePath, branch, mtimeMs: branchStat.mtimeMs };
  } catch (error) {
    throw new Error(`Missing generated branch name file ${branchPath}. Run /git-branch-name first. ${sanitizeError(error)}`);
  }
}

async function readGitWorkflowMessages(cwd) {
  const root = await getGitRoot(cwd);
  const messageCwd = gitWorkflowMessageCwd(root, cwd);
  const { shortPath, longPath } = commitMessagePaths(messageCwd);
  try {
    const [shortText, longText, shortStat, longStat] = await Promise.all([
      readFile(shortPath, "utf8"),
      readFile(longPath, "utf8"),
      stat(shortPath),
      stat(longPath),
    ]);
    const shortFile = gitWorkflowMessageFileMeta(root, messageCwd, shortPath);
    const longFile = gitWorkflowMessageFileMeta(root, messageCwd, longPath);
    return {
      root,
      cwd: messageCwd,
      shortPath,
      longPath,
      shortRelativePath: shortFile.relativePath,
      longRelativePath: longFile.relativePath,
      shortRepoRelativePath: shortFile.repoRelativePath,
      longRepoRelativePath: longFile.repoRelativePath,
      short: shortText.trimEnd(),
      long: longText.trimEnd(),
      shortMtimeMs: shortStat.mtimeMs,
      longMtimeMs: longStat.mtimeMs,
    };
  } catch (error) {
    throw new Error(`Missing generated commit message files in ${path.join(messageCwd, "dev", "COMMIT")}. Run /git-staged-msg first. ${sanitizeError(error)}`);
  }
}

function cleanGitBranchName(value) {
  const branch = String(value || "").trim();
  if (!branch) throw new Error("branch is required");
  if (branch.includes("\0") || branch.includes("@{") || branch.startsWith("-") || branch.startsWith("/")) throw new Error("invalid branch name");
  return branch;
}

function cleanGitCommitMessageInput(value) {
  const message = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!message) throw new Error("commit message is required");
  if (message.includes("\0")) throw new Error("commit message contains a NUL byte");
  if (message.length > 10000) throw new Error("commit message is too long");
  return message;
}

function parseGitPorcelainZEntries(text) {
  const fields = String(text || "").split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field.length < 4) {
      entries.push({ x: "", y: "", path: field, unsupported: true });
      continue;
    }
    const x = field[0] || " ";
    const y = field[1] || " ";
    const filePath = field.slice(3);
    const entry = { x, y, path: filePath };
    if ((x === "R" || x === "C") && index + 1 < fields.length) entry.oldPath = fields[++index];
    entries.push(entry);
  }
  return entries;
}

function gitWorkflowDefaultCommitAction(entry) {
  if (!entry || entry.y !== " ") return "";
  if (entry.x === "A") return "created";
  if (entry.x === "M" || entry.x === "T") return "updated";
  if (entry.x === "D") return "deleted";
  return "";
}

function formatGitWorkflowDefaultCommitPath(filePath) {
  return String(filePath || "").replace(/[\0\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

async function readGitWorkflowDefaultCommitMessage(cwd) {
  const root = await getGitRoot(cwd);
  const statusText = await runGitReadCommand(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { maxOutputLength: 120_000 });
  const entries = parseGitPorcelainZEntries(statusText);
  const empty = (reason, extra = {}) => ({ root, message: "", reason, ...extra });
  if (entries.length === 0) return empty("No changed files are ready for a default commit message.");
  if (entries.length !== 1) return empty(`Expected exactly one changed file for a default commit message; found ${entries.length}.`);
  const [entry] = entries;
  const action = gitWorkflowDefaultCommitAction(entry);
  const displayPath = formatGitWorkflowDefaultCommitPath(entry.path);
  if (!action || !displayPath) {
    return empty("The only changed file is not a staged created, updated, or deleted file.", { path: entry.path || "" });
  }
  return {
    root,
    message: `${action} ${displayPath}`,
    action,
    path: entry.path,
  };
}

function cleanGitHubUsername(value) {
  const username = String(value || "").trim().replace(/^@+/, "");
  if (!username) throw new Error("GitHub username is required");
  if (username.length > 39 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(username) || username.includes("--")) {
    throw new Error("Invalid GitHub username");
  }
  return username;
}

function cleanGitHubRepoName(value) {
  let repoName = String(value || "").trim();
  const githubUrlMatch = repoName.match(/github\.com[:/][^/\s]+\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (githubUrlMatch) repoName = githubUrlMatch[1];
  if (repoName.includes("/")) repoName = repoName.split("/").filter(Boolean).pop() || "";
  repoName = repoName.replace(/\.git$/i, "");
  if (!repoName) throw new Error("GitHub repository name is required");
  if (repoName.length > 100 || repoName === "." || repoName === ".." || !/^[A-Za-z0-9._-]+$/.test(repoName)) {
    throw new Error("Invalid GitHub repository name");
  }
  return repoName;
}

function gitHubOriginUrl(username, repoName) {
  return `https://github.com/${cleanGitHubUsername(username)}/${cleanGitHubRepoName(repoName)}.git`;
}

function defaultGitRepoNameFromRoot(root) {
  try {
    return cleanGitHubRepoName(path.basename(root));
  } catch {
    return "new-repo";
  }
}

async function ensureOutsideGitRepository(cwd) {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 2000 });
  if (result.exitCode === 0 && result.stdout.trim()) throw new Error(`Already inside a git repository: ${path.resolve(result.stdout.trim())}`);
}

async function regularFileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function detectRepositoryStack(root) {
  let names = new Set();
  try {
    names = new Set(await readdir(root));
  } catch {
    return "";
  }
  const detected = [];
  if (names.has("package.json")) {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
      const deps = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
      if (deps.next) detected.push("Next.js");
      else if (deps.react || deps.vite) detected.push("React / Vite");
      else detected.push("Node.js / TypeScript");
      if (deps.typescript || names.has("tsconfig.json")) detected.push("TypeScript");
    } catch {
      detected.push("Node.js");
    }
  }
  if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("setup.py")) detected.push("Python");
  if (names.has("manage.py")) detected.push("Django");
  if (names.has("Cargo.toml")) detected.push("Rust");
  if (names.has("go.mod")) detected.push("Go");
  if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) detected.push("Java / Gradle");
  if (names.has("Dockerfile") || names.has("docker-compose.yml") || names.has("compose.yml")) detected.push("Docker");
  return [...new Set(detected)].join(", ");
}

async function initialRepositoryFilesStatus(cwd) {
  const root = await getGitRoot(cwd);
  const readmePath = path.join(root, "README.md");
  const gitignorePath = path.join(root, ".gitignore");
  const [readmeExists, gitignoreExists, detectedStack] = await Promise.all([
    regularFileExists(readmePath),
    regularFileExists(gitignorePath),
    detectRepositoryStack(root),
  ]);
  return { root, readmePath, gitignorePath, readmeExists, gitignoreExists, detectedStack };
}

function gitignoreLinesForStack(stackInput, detectedStack = "") {
  const stack = `${stackInput || ""} ${detectedStack || ""}`.toLowerCase();
  const sections = [
    ["# OS / editors", ".DS_Store", "Thumbs.db", ".idea/", ".vscode/", "*.swp", "*.swo"],
    ["# Local env / secrets", ".env", ".env.*", "!.env.example", "*.local"],
    ["# Logs / temp", "*.log", "logs/", "tmp/", "temp/", ".cache/"],
  ];
  if (/node|npm|pnpm|yarn|bun|typescript|javascript|react|vite|next/.test(stack)) {
    sections.push(["# Node / frontend", "node_modules/", "dist/", "build/", ".next/", "out/", "coverage/", ".turbo/", ".vite/", "*.tsbuildinfo"]);
  }
  if (/python|django|fastapi|flask/.test(stack)) {
    sections.push(["# Python", "__pycache__/", "*.py[cod]", ".pytest_cache/", ".ruff_cache/", ".mypy_cache/", ".venv/", "venv/", "htmlcov/", "*.egg-info/"]);
  }
  if (/rust|cargo/.test(stack)) sections.push(["# Rust", "target/"]);
  if (/\bgo\b|golang/.test(stack)) sections.push(["# Go", "bin/", "*.test", "coverage.out"]);
  if (/java|gradle|maven|kotlin/.test(stack)) sections.push(["# Java / JVM", "target/", "build/", ".gradle/", "*.class"]);
  if (/docker|container/.test(stack)) sections.push(["# Docker", ".docker/", "docker-compose.override.yml"]);
  if (sections.length === 3) {
    sections.push(["# Common dependency / build outputs", "node_modules/", ".venv/", "venv/", "target/", "dist/", "build/", "coverage/", "vendor/", "*.tmp"]);
  }
  const seen = new Set();
  const lines = [];
  for (const section of sections) {
    lines.push(section[0]);
    for (const pattern of section.slice(1)) {
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      lines.push(pattern);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function prepareInitialRepositoryFiles(cwd, { repoName: repoNameInput, stack = "" } = {}) {
  const before = await initialRepositoryFilesStatus(cwd);
  const repoName = repoNameInput ? cleanGitHubRepoName(repoNameInput) : defaultGitRepoNameFromRoot(before.root);
  if (await regularFileExists(before.readmePath)) {
    // Explicit pre-add check: keep existing README.md unchanged.
  } else {
    await writeFile(before.readmePath, `# ${repoName}\n\nInitialized by Pi Web UI.\n`, "utf8");
  }
  let gitignoreCreated = false;
  let gitignoreSource = before.gitignoreExists ? "existing" : "fallback";
  if (!(await regularFileExists(before.gitignorePath))) {
    await writeFile(before.gitignorePath, gitignoreLinesForStack(stack, before.detectedStack), "utf8");
    gitignoreCreated = true;
  }
  const payload = gitWorkflowCommandPayload(await runGitWorkflowCommand(["add", "--", "README.md", ".gitignore"], { cwd: before.root, label: "git add README.md .gitignore" }));
  if (payload.data) {
    payload.data.root = before.root;
    payload.data.readme = { path: before.readmePath, exists: true, created: !before.readmeExists };
    payload.data.gitignore = { path: before.gitignorePath, exists: true, created: gitignoreCreated, source: gitignoreSource };
    payload.data.detectedStack = before.detectedStack;
    payload.data.stack = stack;
    payload.data.stdout = [
      before.readmeExists ? `Using existing ${before.readmePath}` : `Created ${before.readmePath}`,
      before.gitignoreExists ? `Using existing ${before.gitignorePath}` : `Created ${before.gitignorePath} (${gitignoreSource})`,
      payload.data.stdout?.trimEnd(),
    ].filter(Boolean).join("\n");
  }
  return payload;
}

async function validateGitBranchName(root, branch) {
  const result = await runGitWorkflowCommand(["check-ref-format", "--branch", branch], { cwd: root, timeoutMs: 5000 });
  if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.error) {
    throw new Error((result.stderr || result.stdout || result.error || `Invalid branch name: ${branch}`).trim());
  }
}

async function currentGitBranch(root) {
  const result = await runGitWorkflowCommand(["branch", "--show-current"], { cwd: root, timeoutMs: 5000 });
  const branch = result.stdout.trim();
  if (result.exitCode !== 0 || !branch) throw new Error((result.stderr || result.stdout || "Cannot determine current git branch").trim());
  return branch;
}

async function currentGitBranchForPicker(root) {
  try {
    return (await runGitReadCommand(root, ["branch", "--show-current"], { timeoutMs: 5000, maxOutputLength: 10_000 })).trim();
  } catch {
    return "";
  }
}

function normalizeGitBranchList(branchText, current = "") {
  const seen = new Set();
  const branches = [];
  for (const line of String(branchText || "").split(/\r?\n/)) {
    const name = line.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    branches.push({ name, current: !!current && name === current });
  }
  return branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

async function readGitBranches(cwd) {
  const root = await getGitRoot(cwd);
  const [current, branchText, worktreeData] = await Promise.all([
    currentGitBranchForPicker(root),
    runGitReadCommand(root, ["branch", "--format=%(refname:short)"], { timeoutMs: 5000, maxOutputLength: 120_000 }),
    listGitWorktrees(cwd).catch(() => null),
  ]);
  const occupiedByBranch = new Map();
  for (const item of worktreeData?.occupiedBranches || []) {
    if (!item?.branch || occupiedByBranch.has(item.branch)) continue;
    occupiedByBranch.set(item.branch, item);
  }
  return {
    cwd,
    root,
    repoRoot: worktreeData?.repoRoot || root,
    commonGitDir: worktreeData?.commonGitDir || "",
    currentWorktreePath: worktreeData?.currentWorktreePath || root,
    defaultWorktreesRoot: worktreeData?.defaultWorktreesRoot || "",
    current,
    generatedAt: new Date().toISOString(),
    branches: normalizeGitBranchList(branchText, current).map((branch) => {
      const occupied = occupiedByBranch.get(branch.name);
      return occupied ? { ...branch, occupied: true, worktreePath: occupied.path, worktreeCurrent: occupied.current === true, mainWorktree: occupied.isMainWorktree === true } : branch;
    }),
    worktrees: worktreeData?.worktrees || [],
    occupiedBranches: worktreeData?.occupiedBranches || [],
  };
}

async function switchGitBranch(cwd, branch, { create = false } = {}) {
  const root = await getGitRoot(cwd);
  const targetBranch = cleanGitBranchName(branch);
  await validateGitBranchName(root, targetBranch);
  const branches = await readGitBranches(cwd);
  const branchExists = branches.branches.some((item) => item.name === targetBranch);
  if (create && branchExists) throw new Error(`Local git branch already exists: ${targetBranch}`);
  if (!create && !branchExists) throw new Error(`Unknown local git branch: ${targetBranch}`);
  const occupied = branches.branches.find((item) => item.name === targetBranch && item.occupied && !item.worktreeCurrent);
  if (!create && occupied?.worktreePath) {
    return {
      ok: false,
      code: WORKTREE_ERROR_CODES.BRANCH_CHECKED_OUT_ELSEWHERE,
      error: `Branch ${targetBranch} is already checked out at ${occupied.worktreePath}. Open that worktree instead of switching this checkout.`,
      data: { branch: targetBranch, root, worktreePath: occupied.worktreePath },
    };
  }
  if (!create && branches.current === targetBranch) {
    return { ok: true, data: { command: `git switch ${targetBranch}`, stdout: "", stderr: "", exitCode: 0, branch: targetBranch, root, switched: false, created: false } };
  }
  const args = create ? ["switch", "-c", targetBranch] : ["switch", targetBranch];
  const payload = gitWorkflowCommandPayload(await runGitWorkflowCommand(args, { cwd: root, timeoutMs: 10 * 60 * 1000 }));
  if (payload.ok) {
    payload.data.branch = targetBranch;
    payload.data.root = root;
    payload.data.switched = true;
    payload.data.created = create;
  } else {
    payload.error = (payload.data?.stderr || payload.data?.stdout || payload.error || `Failed to ${create ? "create and switch to" : "switch to"} ${targetBranch}`).trim();
  }
  return payload;
}

function normalizeWorktreeSessionMode(value) {
  const mode = String(value || "fork-current").trim().toLowerCase();
  if (!mode || mode === "fork" || mode === "fork-current") return "fork-current";
  if (mode === "empty" || mode === "new") return "empty";
  if (mode === "clone-current" || mode === "parent-only") {
    throw makeHttpError(400, `sessionMode ${mode} is not supported yet; use fork-current or empty.`);
  }
  throw makeHttpError(400, "sessionMode must be fork-current or empty");
}

async function createEmptySessionFileForCwd(cwd) {
  const manager = SessionManager.create(cwd, configuredSessionDir());
  const sessionFile = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionFile || !header) return undefined;
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, { encoding: "utf8", flag: "wx" });
  return sessionFile;
}

async function prepareWorktreeSessionFile(sourceTab, targetCwd, requestedMode = "fork-current") {
  if (options.noSession) return { mode: "none", requestedMode: "none", sessionFile: undefined, warning: "Web UI was started with --no-session." };
  const mode = normalizeWorktreeSessionMode(requestedMode);
  if (mode === "empty") {
    return { mode, requestedMode: mode, sessionFile: await createEmptySessionFileForCwd(targetCwd) };
  }

  const state = await currentSessionState(sourceTab).catch(() => sourceTab?.lastState || {});
  const sourceSessionFile = state.sessionFile || tabRestorableSessionFile(sourceTab);
  if (sourceSessionFile) {
    requireAllowedSessionPath(sourceSessionFile);
    const sourceInfo = await stat(sourceSessionFile).catch(() => null);
    if (sourceInfo?.isFile()) {
      const manager = SessionManager.forkFrom(sourceSessionFile, targetCwd, configuredSessionDir());
      return { mode, requestedMode: mode, sessionFile: manager.getSessionFile(), parentSession: sourceSessionFile };
    }
  }

  return {
    mode: "empty",
    requestedMode: mode,
    sessionFile: await createEmptySessionFileForCwd(targetCwd),
    warning: "Current session is not persisted yet; opened an empty session rooted at the worktree.",
  };
}

function gitWorkspaceFromWorktreeResult(result, worktree = result?.worktree) {
  if (!worktree?.path) return null;
  return {
    repoRoot: result.repoRoot || worktree.repoRoot || "",
    commonGitDir: result.commonGitDir || worktree.commonGitDir || "",
    worktreePath: worktree.path,
    branch: worktree.branch || result.branch || null,
    worktreeCount: Array.isArray(result.worktrees) ? result.worktrees.length : undefined,
    isMainWorktree: worktree.isMainWorktree === true,
  };
}

async function openWorktreeResultForTab(sourceTab, result, body = {}) {
  const worktree = result?.worktree;
  const worktreePath = worktree?.path || result?.path;
  if (!worktreePath) throw makeHttpError(500, "Git worktree operation did not return a path");
  if (body.openTab === false) return { ...result, session: null, tab: null, tabs: listTabs(), openedTab: false };

  if (sameResolvedPath(worktreePath, sourceTab.cwd)) {
    sourceTab.gitWorkspace = gitWorkspaceFromWorktreeResult(result, worktree);
    return { ...result, session: null, tab: tabMeta(sourceTab), tabs: listTabs(), openedTab: false, openedCurrent: true };
  }

  const existingTab = [...tabs.values()].find((item) => sameResolvedPath(item.cwd, worktreePath));
  if (existingTab) {
    existingTab.gitWorkspace = gitWorkspaceFromWorktreeResult(result, worktree);
    return { ...result, session: null, tab: tabMeta(existingTab), tabs: listTabs(), openedTab: false, openedExistingTab: true };
  }

  const session = await prepareWorktreeSessionFile(sourceTab, worktreePath, body.sessionMode || "fork-current");
  const tab = await createTab({
    title: body.title,
    titleSource: body.title ? "explicit" : undefined,
    cwd: worktreePath,
    sessionFile: session.sessionFile,
    gitWorkspace: gitWorkspaceFromWorktreeResult(result, worktree),
  });
  recordEvent({ type: "webui_worktree_opened", tabId: tab.id, tabTitle: tab.title, cwd: tab.cwd, branch: worktree.branch || result.branch || "", sessionMode: session.mode });
  return {
    ...result,
    session,
    tab: tabMeta(tab),
    tabs: listTabs(),
    openedTab: true,
    dependencyHint: "Git worktrees do not share ignored dependency directories such as node_modules or .venv; install/bootstrap dependencies manually if needed.",
  };
}

async function cleanupCreatedWorktreeAfterFailure(sourceCwd, worktreePath) {
  try {
    return await removeGitWorktree(sourceCwd, worktreePath, { force: true });
  } catch (error) {
    return { ok: false, error: sanitizeError(error), code: error?.code || WORKTREE_ERROR_CODES.GIT_COMMAND_FAILED };
  }
}

async function readGitWorkflowMessageFilesForTransfer(root, messageCwd = root) {
  const { shortPath, longPath } = commitMessagePaths(messageCwd);
  const files = [];
  for (const sourcePath of [shortPath, longPath]) {
    try {
      const content = await readFile(sourcePath, "utf8");
      files.push({ relativePath: path.relative(root, sourcePath).split(path.sep).join("/"), content });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return files;
}

async function snapshotGitWorkflowBranchState(root, cwd = root) {
  const messageCwd = gitWorkflowMessageCwd(root, cwd);
  const diffResult = await runGitWorkflowCommand(["diff", "--cached", "--binary", "--full-index"], {
    cwd: root,
    label: "git diff --cached --binary --full-index",
    timeoutMs: 60 * 1000,
  });
  if (diffResult.exitCode !== 0 || diffResult.timedOut || diffResult.cancelled || diffResult.error) {
    throw new Error((diffResult.stderr || diffResult.stdout || diffResult.error || "Unable to read staged changes for the PR worktree").trim());
  }
  return {
    stagedPatch: diffResult.stdout || "",
    messageFiles: await readGitWorkflowMessageFilesForTransfer(root, messageCwd),
  };
}

async function applyGitWorkflowBranchStateToWorktree(snapshot, worktreePath) {
  const copiedMessageFiles = [];
  let appliedStagedPatch = false;
  const patchText = String(snapshot?.stagedPatch || "");
  if (patchText.trim()) {
    const patchPath = path.join(tmpdir(), `pi-webui-staged-worktree-${process.pid}-${Date.now()}-${randomUUID()}.patch`);
    await writeFile(patchPath, patchText, "utf8");
    try {
      const applyResult = await runGitWorkflowCommand(["apply", "--index", "--whitespace=nowarn", patchPath], {
        cwd: worktreePath,
        label: "git apply --index <staged diff>",
        timeoutMs: 5 * 60 * 1000,
      });
      if (applyResult.exitCode !== 0 || applyResult.timedOut || applyResult.cancelled || applyResult.error) {
        throw new Error((applyResult.stderr || applyResult.stdout || applyResult.error || "Unable to apply staged changes in the PR worktree").trim());
      }
      appliedStagedPatch = true;
    } finally {
      await rm(patchPath, { force: true }).catch(() => {});
    }
  }

  for (const file of snapshot?.messageFiles || []) {
    const relativePath = String(file.relativePath || "").replace(/\\/g, "/");
    const targetPath = path.resolve(worktreePath, relativePath);
    if (!relativePath || !pathInside(worktreePath, targetPath)) throw new Error(`Refusing to copy Git workflow file outside the worktree: ${relativePath}`);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
    copiedMessageFiles.push(relativePath);
  }

  return { appliedStagedPatch, copiedMessageFiles };
}

function gitWorkflowBranchWorktreeStdout({ branch, worktreePath, createdResult, opened, transfer }) {
  const lines = [];
  if (createdResult?.created) lines.push(`Created branch worktree ${branch} at ${worktreePath}.`);
  else if (createdResult?.openedExisting) lines.push(`Opened existing branch worktree ${branch} at ${worktreePath}.`);
  else lines.push(`Opened branch worktree ${branch} at ${worktreePath}.`);
  if (transfer?.appliedStagedPatch) lines.push("Copied the source checkout's staged changes into the worktree index.");
  else if (createdResult?.openedExisting) lines.push("Existing worktree was reused; source staged changes were not copied automatically.");
  else lines.push("No staged changes were copied because the source index was clean.");
  if (transfer?.copiedMessageFiles?.length) lines.push(`Copied ${transfer.copiedMessageFiles.join(", ")} for commit message selection.`);
  if (opened?.tab?.id) lines.push(`Continue the guided Git workflow in Web UI tab ${opened.tab.title || opened.tab.id}.`);
  lines.push("The source checkout was left on its current branch.");
  return lines.join("\n");
}

async function createGitWorkflowBranchWorktree(tab, body = {}) {
  const root = await getGitRoot(tab.cwd);
  const branch = cleanGitBranchName(body.branch || body.branchName);
  await validateGitBranchName(root, branch);
  const snapshot = await snapshotGitWorkflowBranchState(root, tab.cwd);
  let createdResult = null;
  try {
    createdResult = await createGitWorktree(tab.cwd, { ...body, branchName: branch });
    const worktreePath = createdResult.worktree?.path || createdResult.path;
    if (!worktreePath) throw makeHttpError(500, "Git workflow worktree creation did not return a path");
    const transfer = createdResult.created
      ? await applyGitWorkflowBranchStateToWorktree(snapshot, worktreePath)
      : { appliedStagedPatch: false, copiedMessageFiles: [] };
    const opened = await openWorktreeResultForTab(tab, createdResult, { openTab: body.openTab !== false, sessionMode: body.sessionMode || "fork-current", ...body });
    if (createdResult.created) {
      recordEvent({ type: "webui_worktree_created", tabId: opened.tab?.id || tab.id, cwd: opened.worktree?.path || opened.path, branch });
    }
    recordEvent({ type: "webui_git_workflow_worktree", tabId: opened.tab?.id || tab.id, cwd: worktreePath, branch, transferredStagedChanges: transfer.appliedStagedPatch });
    return {
      ...opened,
      command: createdResult.created ? formatGitCommand(["worktree", "add", "-b", branch, worktreePath]) : formatGitCommand(["worktree", "list", "--porcelain"]),
      stdout: gitWorkflowBranchWorktreeStdout({ branch, worktreePath, createdResult, opened, transfer }),
      stderr: "",
      exitCode: 0,
      branch: opened.branch || branch,
      carriedStagedChanges: transfer.appliedStagedPatch,
      copiedMessageFiles: transfer.copiedMessageFiles,
    };
  } catch (error) {
    let cleanup = null;
    const createdPath = createdResult?.created && !createdResult?.openedExisting ? createdResult.worktree?.path || createdResult.path : "";
    if (createdPath) cleanup = await cleanupCreatedWorktreeAfterFailure(tab.cwd, createdPath);
    recordEvent({ type: "webui_git_workflow_worktree_failed", tabId: tab.id, cwd: createdPath || tab.cwd, branch, error: sanitizeError(error), cleanup });
    throw error;
  }
}

async function createGitWorktreeTab(tab, body = {}) {
  let createdResult = null;
  try {
    createdResult = await createGitWorktree(tab.cwd, body);
    const opened = await openWorktreeResultForTab(tab, createdResult, { openTab: body.openTab !== false, ...body });
    if (createdResult.created) {
      recordEvent({ type: "webui_worktree_created", tabId: opened.tab?.id || tab.id, cwd: opened.worktree?.path || opened.path, branch: opened.branch || body.branchName || "" });
    }
    return opened;
  } catch (error) {
    let cleanup = null;
    const createdPath = createdResult?.created && !createdResult?.openedExisting ? createdResult.worktree?.path || createdResult.path : "";
    if (createdPath) cleanup = await cleanupCreatedWorktreeAfterFailure(tab.cwd, createdPath);
    recordEvent({ type: "webui_worktree_create_failed", tabId: tab.id, cwd: createdPath || tab.cwd, branch: body.branchName || body.branch || "", error: sanitizeError(error), cleanup });
    throw error;
  }
}

async function openExistingGitWorktreeTab(tab, body = {}) {
  const requestedPath = String(body.path || body.worktreePath || "").trim();
  if (!requestedPath) throw makeHttpError(400, "worktree path is required");
  const result = await openGitWorktree(tab.cwd, requestedPath);
  return openWorktreeResultForTab(tab, result, { openTab: body.openTab !== false, ...body });
}

function openTabsInsideWorktree(worktreePath) {
  return [...tabs.values()].filter((tab) => pathInside(worktreePath, tab.cwd));
}

async function removeGitWorktreeForTab(tab, body = {}) {
  if (body.confirmed !== true) throw makeHttpError(409, "Removing a worktree requires confirmed: true because it deletes files under the worktree path.");
  const requestedPath = String(body.path || body.worktreePath || "").trim();
  if (!requestedPath) throw makeHttpError(400, "worktree path is required");
  const activeTabs = openTabsInsideWorktree(requestedPath);
  if (activeTabs.length) {
    const error = makeHttpError(409, `Refusing to remove a worktree that is open in ${activeTabs.length} Web UI tab${activeTabs.length === 1 ? "" : "s"}.`);
    error.code = WORKTREE_ERROR_CODES.WORKTREE_BUSY;
    error.details = { path: requestedPath, tabIds: activeTabs.map((item) => item.id) };
    throw error;
  }
  const result = await removeGitWorktree(tab.cwd, requestedPath, { force: body.force === true });
  recordEvent({ type: "webui_worktree_removed", tabId: tab.id, cwd: result.path || requestedPath, branch: result.branch || "" });
  return { ...result, tabs: listTabs() };
}

function sendGitWorktreeFailure(res, error) {
  sendJson(res, 200, gitWorktreeErrorPayload(error));
}

async function defaultGitRemote(root) {
  const result = await runGitWorkflowCommand(["remote"], { cwd: root, timeoutMs: 5000 });
  if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || "Cannot list git remotes").trim());
  const remotes = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!remotes.length) throw new Error("No git remote is configured for this repository");
  return remotes.includes("origin") ? "origin" : remotes[0];
}

function prDescriptionPath(root, branch) {
  const base = path.resolve(root, "dev", "PR");
  const target = path.resolve(base, `${branch}.md`);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Resolved PR description path escapes dev/PR");
  return { base, prPath: target };
}

async function readGitWorkflowPrDescription(cwd) {
  const root = await getGitRoot(cwd);
  const branch = await currentGitBranch(root);
  const { prPath } = prDescriptionPath(root, branch);
  try {
    const [body, info] = await Promise.all([readFile(prPath, "utf8"), stat(prPath)]);
    return { root, branch, path: prPath, body: body.trimEnd(), mtimeMs: info.mtimeMs };
  } catch (error) {
    throw new Error(`Missing generated PR description ${prPath}. Run /pr first. ${sanitizeError(error)}`);
  }
}

function cleanPrTitle(value) {
  const title = String(value || "").replace(/\r?\n/g, " ").trim();
  if (!title) throw new Error("PR title is required");
  return title.slice(0, 300);
}

function formatWorkflowCommand(command, args) {
  return [command, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}

function formatGitCommand(args) {
  return formatWorkflowCommand("git", args);
}

function runWorkflowCommand(command, args, { cwd, label = formatWorkflowCommand(command, args), timeoutMs = 10 * 60 * 1000 } = {}) {
  if (activeGitWorkflowProcess) {
    return Promise.reject(new Error(`A git workflow command is already running: ${activeGitWorkflowProcess.label}`));
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || "0", GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED || "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeGitWorkflowProcess?.child === child) activeGitWorkflowProcess = null;
      resolve({ command: label, stdout, stderr, timedOut, cancelled, ...result });
    };

    const terminate = (reason) => {
      if (reason === "cancelled") cancelled = true;
      if (child.exitCode === null) child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2000).unref();
    };

    activeGitWorkflowProcess = { child, label, cancel: () => terminate("cancelled") };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("timeout");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 100000) stdout = stdout.slice(-100000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 100000) stderr = stderr.slice(-100000);
    });
    child.on("error", (error) => finish({ exitCode: undefined, stderr: stderr || sanitizeError(error), error: sanitizeError(error) }));
    child.on("exit", (exitCode, signal) => finish({ exitCode, signal }));
  });
}

function runGitWorkflowCommand(args, options = {}) {
  return runWorkflowCommand("git", args, { ...options, label: options.label || formatGitCommand(args) });
}

function runGitHubWorkflowCommand(args, options = {}) {
  return runWorkflowCommand("gh", args, { ...options, label: options.label || formatWorkflowCommand("gh", args) });
}

function gitWorkflowCommandPayload(result) {
  const ok = result.exitCode === 0 && !result.timedOut && !result.cancelled && !result.error;
  return {
    ok,
    error: ok ? undefined : result.error || (result.cancelled ? "Cancelled" : result.timedOut ? "Command timed out" : `Command failed with exit code ${result.exitCode ?? result.signal ?? "unknown"}`),
    data: result,
  };
}

async function handleGitWorkflowRequest(pathname, body = {}, tabOrCwd = options.cwd) {
  const tab = tabOrCwd && typeof tabOrCwd === "object" ? tabOrCwd : null;
  const cwd = tab?.cwd || tabOrCwd || options.cwd;
  try {
    switch (pathname) {
      case "/api/git-workflow/message":
        return { ok: true, data: await readGitWorkflowMessages(cwd) };
      case "/api/git-workflow/default-commit-message":
        return { ok: true, data: await readGitWorkflowDefaultCommitMessage(cwd) };
      case "/api/git-workflow/branch-name":
        return { ok: true, data: await readGitWorkflowBranchName(cwd) };
      case "/api/git-workflow/pr-description":
        return { ok: true, data: await readGitWorkflowPrDescription(cwd) };
      case "/api/git-workflow/init":
        await ensureOutsideGitRepository(cwd);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["init"], { cwd }));
      case "/api/git-workflow/init-files-status":
        return { ok: true, data: await initialRepositoryFilesStatus(cwd) };
      case "/api/git-workflow/readme":
        return prepareInitialRepositoryFiles(cwd, { repoName: body.repoName, stack: body.stack });
      case "/api/git-workflow/initial-commit": {
        const root = await getGitRoot(cwd);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["commit", "-m", "Initial commit"], { cwd: root, label: "git commit -m \"Initial commit\"" }));
      }
      case "/api/git-workflow/main-branch": {
        const root = await getGitRoot(cwd);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["branch", "-M", "main"], { cwd: root }));
      }
      case "/api/git-workflow/remote": {
        const root = await getGitRoot(cwd);
        const username = cleanGitHubUsername(body.username);
        const repoName = cleanGitHubRepoName(body.repoName);
        const remoteUrl = gitHubOriginUrl(username, repoName);
        const payload = gitWorkflowCommandPayload(await runGitWorkflowCommand(["remote", "add", "origin", remoteUrl], { cwd: root }));
        if (payload.data) {
          payload.data.root = root;
          payload.data.remote = "origin";
          payload.data.remoteUrl = remoteUrl;
          payload.data.repoName = repoName;
          payload.data.username = username;
        }
        return payload;
      }
      case "/api/git-workflow/init-push": {
        const root = await getGitRoot(cwd);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["push", "-u", "origin", "main"], { cwd: root, timeoutMs: 15 * 60 * 1000 }));
      }
      case "/api/git-workflow/add":
        await getGitRoot(cwd);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["add", "."], { cwd }));
      case "/api/git-workflow/branch": {
        if (!tab) throw new Error("Git workflow branch worktree requires a Web UI tab");
        return { ok: true, data: await createGitWorkflowBranchWorktree(tab, body) };
      }
      case "/api/git-workflow/commit": {
        const variant = String(body.variant || "").trim();
        if (!["short", "long", "input"].includes(variant)) throw new Error("variant must be 'short', 'long', or 'input'");
        if (variant === "input") {
          const root = await getGitRoot(cwd);
          const message = cleanGitCommitMessageInput(body.message);
          return gitWorkflowCommandPayload(await runGitWorkflowCommand(["commit", "-m", message], { cwd: root, label: "git commit -m <input message>" }));
        }
        const messages = await readGitWorkflowMessages(cwd);
        if (variant === "short") {
          const message = messages.short.trim();
          if (!message) throw new Error(`${messages.shortPath} is empty`);
          return gitWorkflowCommandPayload(await runGitWorkflowCommand(["commit", "-m", message], { cwd: messages.root, label: "git commit -m <dev/COMMIT/staged-commit-short.txt>" }));
        }
        if (!messages.long.trim()) throw new Error(`${messages.longPath} is empty`);
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["commit", "-F", messages.longPath], { cwd: messages.root, label: "git commit -F dev/COMMIT/staged-commit-long.txt" }));
      }
      case "/api/git-workflow/push": {
        const root = await getGitRoot(cwd);
        if (body.setUpstream) {
          const currentBranch = await currentGitBranch(root);
          const requestedBranch = body.branch ? cleanGitBranchName(body.branch) : currentBranch;
          if (requestedBranch !== currentBranch) throw new Error(`Current branch is ${currentBranch}, not ${requestedBranch}`);
          const remote = await defaultGitRemote(root);
          const payload = gitWorkflowCommandPayload(await runGitWorkflowCommand(["push", "-u", remote, currentBranch], { cwd: root, label: `git push -u ${remote} ${currentBranch}`, timeoutMs: 15 * 60 * 1000 }));
          if (payload.ok) {
            payload.data.branch = currentBranch;
            payload.data.remote = remote;
          }
          return payload;
        }
        return gitWorkflowCommandPayload(await runGitWorkflowCommand(["push"], { cwd: root, timeoutMs: 15 * 60 * 1000 }));
      }
      case "/api/git-workflow/create-pr": {
        const root = await getGitRoot(cwd);
        const branch = await currentGitBranch(root);
        const title = cleanPrTitle(body.title);
        const description = String(body.body || "").trimEnd();
        if (!description.trim()) throw new Error("PR description is required");
        const { base, prPath } = prDescriptionPath(root, branch);
        await mkdir(path.dirname(prPath), { recursive: true });
        await writeFile(prPath, `${description}\n`, "utf8");
        const payload = gitWorkflowCommandPayload(await runGitHubWorkflowCommand(["pr", "create", "--title", title, "--body-file", prPath, "--head", branch], { cwd: root, label: "gh pr create --title <title> --body-file <dev/PR/current-branch.md> --head <current-branch>", timeoutMs: 15 * 60 * 1000 }));
        if (payload.ok) {
          payload.data.branch = branch;
          payload.data.path = prPath;
          payload.data.prDirectory = base;
        }
        return payload;
      }
      case "/api/git-workflow/cancel": {
        const cancelled = !!activeGitWorkflowProcess;
        if (activeGitWorkflowProcess) activeGitWorkflowProcess.cancel();
        return { ok: true, data: { cancelled } };
      }
      default:
        return undefined;
    }
  } catch (error) {
    return { ok: false, error: sanitizeError(error) };
  }
}

function themeLabel(name) {
  return String(name || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") record[key] = String(item);
  }
  return record;
}

async function directoryExists(dir) {
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function resolveBundledThemesDir() {
  const candidates = [];
  try {
    const manifestPath = require.resolve("@firstpick/pi-themes-bundle/package.json");
    const root = path.dirname(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const declaredThemes = Array.isArray(manifest.pi?.themes) ? manifest.pi.themes : ["./themes"];
    for (const entry of declaredThemes) {
      if (typeof entry === "string" && entry.trim()) candidates.push(path.resolve(root, entry));
    }
  } catch {
    // In repo development the bundle may be a sibling package rather than an installed dependency.
  }
  candidates.push(path.resolve(packageRoot, "..", "pi-package-themes-bundle", "themes"));

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return candidate;
  }
  return null;
}

function sanitizeBundledTheme(theme, fileName) {
  const name = typeof theme?.name === "string" && theme.name.trim() ? theme.name.trim() : path.basename(fileName, ".json");
  return {
    name,
    label: themeLabel(name),
    vars: stringRecord(theme?.vars),
    colors: stringRecord(theme?.colors),
    export: stringRecord(theme?.export),
  };
}

async function readBundledThemes() {
  const dir = await resolveBundledThemesDir();
  if (!dir) return { source: "@firstpick/pi-themes-bundle", themes: [] };

  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  const themes = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(dir, file), "utf8");
      themes.push(sanitizeBundledTheme(JSON.parse(raw), file));
    } catch (error) {
      console.error(`Skipping invalid theme ${file}: ${sanitizeError(error)}`);
    }
  }
  themes.sort((a, b) => a.label.localeCompare(b.label));
  return { source: "@firstpick/pi-themes-bundle", themes };
}

function normalizeStaticPath(urlPath) {
  if (urlPath === "/") return "index.html";
  const name = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  if (!["index.html", "app.js", "styles.css", "favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "catppuccin-mocha-background.png", "matrix-background.webp", "manifest.webmanifest", "service-worker.js"].includes(name)) return undefined;
  return name;
}

function mermaidStaticPath(urlPath) {
  const prefix = "/vendor/mermaid/";
  if (!String(urlPath || "").startsWith(prefix)) return undefined;
  const relative = urlPath.slice(prefix.length);
  if (relative === "mermaid.esm.min.mjs") return path.join(packageRoot, "node_modules", "mermaid", "dist", relative);
  if (/^chunks\/mermaid\.esm\.min\/[A-Za-z0-9._-]+\.mjs$/.test(relative)) return path.join(packageRoot, "node_modules", "mermaid", "dist", relative);
  return undefined;
}

const compressWithBrotli = promisify(brotliCompress);
const compressWithGzip = promisify(gzip);
const STATIC_COMPRESSIBLE_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".svg", ".json", ".webmanifest"]);
const STATIC_COMPRESSION_MIN_BYTES = 1024;
// filePath -> { mtimeMs, size, etag, raw, br, gz }; invalidated by mtime/size change.
const staticAssetCache = new Map();

async function loadStaticAsset(filePath) {
  const stats = await stat(filePath);
  const cached = staticAssetCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached;
  const raw = await readFile(filePath);
  const entry = {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    etag: `"${createHash("sha1").update(raw).digest("base64url")}"`,
    raw,
    br: null,
    gz: null,
  };
  staticAssetCache.set(filePath, entry);
  return entry;
}

function acceptedStaticEncoding(req) {
  const header = String(req.headers["accept-encoding"] || "");
  if (/\bbr\b/i.test(header)) return "br";
  if (/\bgzip\b/i.test(header)) return "gzip";
  return "";
}

function requestEtagMatches(req, etag) {
  const header = String(req.headers["if-none-match"] || "");
  if (!header) return false;
  return header.split(",").some((candidate) => candidate.trim() === etag);
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET") return false;
  const staticName = normalizeStaticPath(url.pathname);
  const filePath = staticName ? path.join(publicDir, staticName) : mermaidStaticPath(url.pathname);
  if (!filePath) return false;
  const ext = path.extname(filePath);
  const asset = await loadStaticAsset(filePath);
  const headers = {
    "content-type": MIME_TYPES.get(ext) || "application/octet-stream",
    // no-cache (unlike no-store) allows conditional revalidation via ETag/304
    // while still guaranteeing fresh content after deploys.
    "cache-control": "no-cache",
    etag: asset.etag,
    vary: "Accept-Encoding",
    "x-content-type-options": "nosniff",
  };
  if (requestEtagMatches(req, asset.etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  let body = asset.raw;
  if (STATIC_COMPRESSIBLE_EXTENSIONS.has(ext) && asset.raw.length >= STATIC_COMPRESSION_MIN_BYTES) {
    const encoding = acceptedStaticEncoding(req);
    if (encoding === "br") {
      asset.br ||= await compressWithBrotli(asset.raw, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: asset.raw.length,
        },
      });
      body = asset.br;
      headers["content-encoding"] = "br";
    } else if (encoding === "gzip") {
      asset.gz ||= await compressWithGzip(asset.raw, { level: 7 });
      body = asset.gz;
      headers["content-encoding"] = "gzip";
    }
  }
  headers["content-length"] = body.length;
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

function requestBodyLimitForPath(pathname) {
  if (pathname === "/api/attachments") return UPLOAD_BODY_LIMIT_BYTES;
  if (["/api/prompt", "/api/steer", "/api/follow-up"].includes(pathname)) return PROMPT_BODY_LIMIT_BYTES;
  return BODY_LIMIT_BYTES;
}

function sanitizeUploadFileName(name) {
  const base = path.basename(String(name || "attachment").replace(/\0/g, ""));
  const safe = base.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
  return safe && safe !== "." && safe !== ".." ? safe : "attachment";
}

function normalizeMimeType(value) {
  const mimeType = String(value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  return mimeType || "application/octet-stream";
}

function stripDataUrlPrefix(data) {
  const text = String(data || "").trim();
  if (!text.toLowerCase().startsWith("data:")) return text;
  const comma = text.indexOf(",");
  return comma === -1 ? text : text.slice(comma + 1);
}

function decodeAttachmentData(data) {
  const base64 = stripDataUrlPrefix(data).replace(/\s+/g, "");
  if (!base64) throw new Error("attachment data is required");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("attachment data must be base64 encoded");
  return Buffer.from(base64, "base64");
}

async function saveUploadedAttachments(body) {
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (rawFiles.length === 0) throw new Error("files are required");
  if (rawFiles.length > ATTACHMENT_UPLOAD_MAX_FILES) throw new Error(`attachments are limited to ${ATTACHMENT_UPLOAD_MAX_FILES} files`);

  const decoded = [];
  let totalBytes = 0;
  for (const [index, file] of rawFiles.entries()) {
    const buffer = decodeAttachmentData(file?.data);
    if (buffer.length === 0) throw new Error(`attachment ${index + 1} is empty`);
    if (buffer.length > ATTACHMENT_UPLOAD_MAX_FILE_BYTES) throw new Error(`attachment ${index + 1} exceeds ${formatBytes(ATTACHMENT_UPLOAD_MAX_FILE_BYTES)}`);
    totalBytes += buffer.length;
    if (totalBytes > ATTACHMENT_UPLOAD_MAX_TOTAL_BYTES) throw new Error(`attachments exceed ${formatBytes(ATTACHMENT_UPLOAD_MAX_TOTAL_BYTES)} total`);
    decoded.push({
      id: String(file?.id || `attachment-${index + 1}`).slice(0, 120),
      name: sanitizeUploadFileName(file?.name),
      mimeType: normalizeMimeType(file?.mimeType || file?.type),
      size: buffer.length,
      buffer,
    });
  }

  const uploadDir = path.join(UPLOAD_TEMP_ROOT, randomUUID());
  await mkdir(uploadDir, { recursive: true });
  const saved = [];
  for (const [index, file] of decoded.entries()) {
    const fileName = `${String(index + 1).padStart(2, "0")}-${file.name}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, file.buffer);
    saved.push({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, path: filePath });
  }
  return { files: saved, uploadDir };
}

function normalizeRpcImages(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > ATTACHMENT_UPLOAD_MAX_FILES) throw new Error(`images are limited to ${ATTACHMENT_UPLOAD_MAX_FILES} files`);
  const images = [];
  let totalBytes = 0;
  for (const [index, image] of value.entries()) {
    const mimeType = normalizeMimeType(image?.mimeType);
    if (!RPC_IMAGE_MIME_TYPES.has(mimeType)) throw new Error(`image ${index + 1} has unsupported MIME type ${mimeType}`);
    const data = stripDataUrlPrefix(image?.data).replace(/\s+/g, "");
    if (!data) throw new Error(`image ${index + 1} data is required`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(`image ${index + 1} data must be base64 encoded`);
    const approxBytes = Math.floor((data.length * 3) / 4);
    if (approxBytes > INLINE_IMAGE_MAX_BYTES) throw new Error(`image ${index + 1} exceeds ${formatBytes(INLINE_IMAGE_MAX_BYTES)} inline limit`);
    totalBytes += approxBytes;
    if (totalBytes > INLINE_IMAGE_TOTAL_MAX_BYTES) throw new Error(`inline images exceed ${formatBytes(INLINE_IMAGE_TOTAL_MAX_BYTES)} total`);
    images.push({ type: "image", data, mimeType });
  }
  return images.length ? images : undefined;
}

function attachImages(command, body) {
  const images = normalizeRpcImages(body?.images);
  if (images) command.images = images;
  return command;
}

function commandFromPost(pathname, body) {
  switch (pathname) {
    case "/api/prompt": {
      const message = String(body.message || "").trim();
      if (!message) throw new Error("message is required");
      const command = { type: "prompt", message };
      if (body.streamingBehavior === "steer" || body.streamingBehavior === "followUp") {
        command.streamingBehavior = body.streamingBehavior;
      }
      return attachImages(command, body);
    }
    case "/api/steer": {
      const message = String(body.message || "").trim();
      if (!message) throw new Error("message is required");
      return attachImages({ type: "steer", message }, body);
    }
    case "/api/follow-up": {
      const message = String(body.message || "").trim();
      if (!message) throw new Error("message is required");
      return attachImages({ type: "follow_up", message }, body);
    }
    case "/api/abort":
      return { type: "abort" };
    case "/api/bash": {
      const command = String(body.command || "").trim();
      if (!command) throw new Error("command is required");
      return { type: "bash", command, excludeFromContext: body.excludeFromContext === true };
    }
    case "/api/abort-bash":
      return { type: "abort_bash" };
    case "/api/new-session":
      return body.parentSession ? { type: "new_session", parentSession: String(body.parentSession) } : { type: "new_session" };
    case "/api/model": {
      const provider = String(body.provider || "").trim();
      const modelId = String(body.modelId || "").trim();
      if (!provider || !modelId) throw new Error("provider and modelId are required");
      return { type: "set_model", provider, modelId };
    }
    case "/api/thinking": {
      const level = String(body.level || "").trim();
      if (!THINKING_LEVELS.includes(level)) {
        throw new Error("Invalid thinking level");
      }
      return { type: "set_thinking_level", level };
    }
    case "/api/thinking-cycle":
      return { type: "cycle_thinking_level" };
    case "/api/steering-mode": {
      const mode = String(body.mode || "").trim();
      if (!["all", "one-at-a-time"].includes(mode)) throw new Error("Invalid steering mode");
      return { type: "set_steering_mode", mode };
    }
    case "/api/follow-up-mode": {
      const mode = String(body.mode || "").trim();
      if (!["all", "one-at-a-time"].includes(mode)) throw new Error("Invalid follow-up mode");
      return { type: "set_follow_up_mode", mode };
    }
    case "/api/auto-compaction":
      return { type: "set_auto_compaction", enabled: body.enabled === true };
    case "/api/compact":
      return body.customInstructions ? { type: "compact", customInstructions: String(body.customInstructions) } : { type: "compact" };
    default:
      return undefined;
  }
}

/**
 * Delta transcript support (P1-1): /api/messages?since=N serializes only the
 * tail starting at message index N plus { totalCount, since } so clients can
 * merge appended messages instead of re-downloading the whole transcript on
 * every agent event. Without ?since= the legacy full payload is returned.
 */
function applyMessagesSinceParam(response, url) {
  const sinceRaw = url.searchParams.get("since");
  if (sinceRaw === null) return;
  const messages = response?.data?.messages;
  if (!Array.isArray(messages)) return;
  const parsed = Number.parseInt(sinceRaw, 10);
  const total = messages.length;
  const since = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), total) : 0;
  response.data = { ...response.data, messages: messages.slice(since), totalCount: total, since };
}

function commandFromGet(pathname) {
  switch (pathname) {
    case "/api/state":
      return { type: "get_state" };
    case "/api/messages":
      return { type: "get_messages" };
    case "/api/models":
      return { type: "get_available_models" };
    case "/api/commands":
      return { type: "get_commands" };
    case "/api/stats":
      return { type: "get_session_stats" };
    case "/api/last-assistant-text":
      return { type: "get_last_assistant_text" };
    default:
      return undefined;
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${formatCliError(error)}\n`);
  usage();
  process.exit(2);
}

if (options.help) {
  usage();
  process.exit(0);
}
if (options.version) {
  console.log(packageJson.version);
  process.exit(0);
}

try {
  options.cwd = await validateStartupCwd(options.cwd);
} catch (error) {
  console.error(`Error: ${formatCliError(error)}\n`);
  usage();
  process.exit(2);
}

process.env.PI_WEBUI_HOST = options.host;
process.env.PI_WEBUI_PORT = String(options.port);

const startupDelayMs = Number.parseInt(process.env.PI_WEBUI_START_DELAY_MS || "", 10);
delete process.env.PI_WEBUI_START_DELAY_MS;
if (Number.isFinite(startupDelayMs) && startupDelayMs > 0) {
  await delay(Math.min(startupDelayMs, 10_000));
}

const restoreTabs = readRestoreTabsFromEnv();

function normalizedRestoreString(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : undefined;
}

function normalizeRestoreTabDescriptor(item, seenIds) {
  if (!item || typeof item !== "object") return null;
  const state = item.state && typeof item.state === "object" ? item.state : {};
  const rawId = normalizedRestoreString(item.id, 128);
  const id = rawId && /^[A-Za-z0-9._:-]+$/.test(rawId) && !seenIds.has(rawId) ? rawId : undefined;
  if (id) seenIds.add(id);

  const descriptor = {
    id,
    title: normalizedRestoreString(item.title, 160),
    titleSource: ["explicit", "auto", "default"].includes(item.titleSource) ? item.titleSource : undefined,
    cwd: normalizedRestoreString(item.cwd || item.workspace?.cwd, 4096),
    conversationStarted: item.conversationStarted === true,
    sessionFile: normalizedRestoreString(item.sessionFile || state.sessionFile, 4096),
  };

  if (Number.isInteger(item.index) && item.index > 0) descriptor.index = item.index;
  return descriptor;
}

function readRestoreTabsFromEnv() {
  const raw = process.env.PI_WEBUI_RESTORE_TABS;
  delete process.env.PI_WEBUI_RESTORE_TABS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    const seenIds = new Set();
    return items.map((item) => normalizeRestoreTabDescriptor(item, seenIds)).filter(Boolean).slice(0, RESTORE_TAB_LIMIT);
  } catch (error) {
    console.warn(`failed to parse PI_WEBUI_RESTORE_TABS: ${sanitizeError(error)}`);
    return [];
  }
}

async function packageNameForResourcePath(resourcePath) {
  let current = path.dirname(resourcePath);
  while (current && current !== path.dirname(current)) {
    if (PACKAGE_NAME_CACHE.has(current)) return PACKAGE_NAME_CACHE.get(current) || undefined;
    try {
      const pkg = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
      const name = typeof pkg.name === "string" ? pkg.name : "";
      PACKAGE_NAME_CACHE.set(current, name);
      return name || undefined;
    } catch {
      current = path.dirname(current);
    }
  }
  return undefined;
}

async function packageRootRealpath() {
  try {
    return await realpath(packageRoot);
  } catch {
    return packageRoot;
  }
}

async function devWorkspaceRoot() {
  if (!webuiDevServer) return null;
  const envRoot = process.env.PI_NPM_PACKAGES_ROOT ? path.resolve(expandUserPath(process.env.PI_NPM_PACKAGES_ROOT)) : "";
  const candidates = [envRoot, path.dirname(packageRoot), path.dirname(await packageRootRealpath())].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate, { withFileTypes: true });
      if (entries.some((entry) => entry.isDirectory() && entry.name === "pi-package-webui")) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function workspacePackageRootForName(packageName) {
  const root = await devWorkspaceRoot();
  if (!root) return null;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("pi-")) continue;
    const candidate = path.join(root, entry.name);
    if ((await packageNameForResourcePath(path.join(candidate, "index.ts"))) === packageName) return candidate;
  }
  return null;
}

function parseNodeModulesPackageRef(manifestEntry) {
  const normalized = String(manifestEntry || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith("node_modules/")) return null;
  const parts = normalized.slice("node_modules/".length).split("/").filter(Boolean);
  if (!parts.length) return null;
  const scoped = parts[0].startsWith("@");
  const packageName = scoped ? `${parts[0]}/${parts[1] || ""}` : parts[0];
  if (!packageName || packageName.endsWith("/")) return null;
  const subpath = parts.slice(scoped ? 2 : 1).join("/");
  return { packageName, subpath };
}

async function resolveStartedWebuiManifestResource(manifestEntry) {
  const nodeModulesRef = parseNodeModulesPackageRef(manifestEntry);
  if (nodeModulesRef && WEBUI_CONTROLLED_PACKAGES.has(nodeModulesRef.packageName)) {
    const installedCandidate = await resolveInstalledPackageSubpath(nodeModulesRef.packageName, nodeModulesRef.subpath);
    if (installedCandidate) return installedCandidate;
  }

  const candidate = path.resolve(packageRoot, manifestEntry);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function startedWebuiResourcePaths(resourceType) {
  const entries = Array.isArray(packageJson.pi?.[resourceType]) ? packageJson.pi[resourceType] : [];
  const resolved = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const resourcePath = await resolveStartedWebuiManifestResource(entry);
    if (resourcePath) resolved.push(resourcePath);
  }
  return resolved;
}

function piArgsDisableResourceDiscovery(resourceType) {
  const flags = {
    extensions: new Set(["--no-extensions", "-ne"]),
    skills: new Set(["--no-skills", "-ns"]),
    prompts: new Set(["--no-prompt-templates", "-np"]),
    themes: new Set(["--no-themes"]),
  }[resourceType];
  return !!flags && options.piArgs.some((arg) => flags.has(arg));
}

async function resolvedNormalPiResourcesForTab(cwd) {
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    return await packageManager.resolve(async () => "skip");
  } catch (error) {
    console.warn(`failed to resolve configured Pi resources for Web UI tab: ${sanitizeError(error)}`);
    return { extensions: [], skills: [], prompts: [], themes: [] };
  }
}

async function normalPiResourcePathsForTab(resolved, resourceType) {
  if (piArgsDisableResourceDiscovery(resourceType)) return [];
  const resourcePaths = [];
  for (const resource of resolved[resourceType] || []) {
    if (!resource.enabled) continue;
    const packageName = await packageNameForResourcePath(resource.path);
    if (packageName && WEBUI_CONTROLLED_PACKAGES.has(packageName)) continue;
    resourcePaths.push(resource.path);
  }
  return resourcePaths;
}

function appendResourceArgs(args, flag, resourcePaths) {
  for (const resourcePath of resourcePaths) args.push(flag, resourcePath);
}

async function appendCuratedResourceArgs(args, normalResources, resourceType, flag) {
  appendResourceArgs(args, flag, await normalPiResourcePathsForTab(normalResources, resourceType));
  appendResourceArgs(args, flag, await startedWebuiResourcePaths(resourceType));
}

async function buildPiArgsForTab(tabIndex, title, tabCwd = options.cwd) {
  const args = ["--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"];
  if (options.noSession) args.push("--no-session");

  const normalResources = await resolvedNormalPiResourcesForTab(tabCwd);
  await appendCuratedResourceArgs(args, normalResources, "extensions", "--extension");
  await appendCuratedResourceArgs(args, normalResources, "skills", "--skill");
  await appendCuratedResourceArgs(args, normalResources, "prompts", "--prompt-template");
  await appendCuratedResourceArgs(args, normalResources, "themes", "--theme");

  // Load a browser-safe RPC helper into every Web UI tab. It exposes hidden
  // extension commands for Web UI-native /tools and /skills selectors without
  // depending on TUI-only extension UIs.
  args.push("--extension", webuiHelperExtensionPath);

  // Keep tab naming inside Web UI metadata. Some bundled Pi CLI versions do not
  // support --name, and passing Web UI-generated tab titles through to child
  // RPC processes makes every tab after the first exit immediately.
  args.push(...options.piArgs);
  return args;
}

function isNodeScriptCommand(command) {
  return [".cjs", ".js", ".mjs"].includes(path.extname(String(command || "")).toLowerCase());
}

async function resolvedPiCliScript() {
  const packagePathParts = PI_CODING_AGENT_PACKAGE.split("/").filter(Boolean);
  const searchRoots = require.resolve.paths(PI_CODING_AGENT_PACKAGE) || [];
  for (const nodeModulesRoot of searchRoots) {
    const cliPath = path.join(nodeModulesRoot, ...packagePathParts, "dist", "cli.js");
    try {
      await access(cliPath);
      return cliPath;
    } catch {
      // Continue through Node's resolution roots; global npm installs can hoist
      // pi-coding-agent beside pi-package-webui instead of nesting it.
    }
  }
  return "";
}

async function resolvePiCommand(piArgs) {
  if (options.piBinExplicit) {
    if (isNodeScriptCommand(options.piBin)) {
      return {
        command: process.execPath,
        args: [options.piBin, ...piArgs],
        displayCommand: `${process.execPath} ${options.piBin} ${piArgs.join(" ")}`,
      };
    }
    return { command: options.piBin, args: piArgs, displayCommand: `${options.piBin} ${piArgs.join(" ")}` };
  }

  const bundledCli = await resolvedPiCliScript();
  if (bundledCli) {
    return {
      command: process.execPath,
      args: [bundledCli, ...piArgs],
      displayCommand: `${process.execPath} ${bundledCli} ${piArgs.join(" ")}`,
    };
  }

  return { command: options.piBin, args: piArgs, displayCommand: `${options.piBin} ${piArgs.join(" ")}` };
}

const tabs = new Map();
const closedRestorableTabs = [];
let nextTabIndex = 1;
const TAB_ACTIVITY_IDLE_RECONCILE_GRACE_MS = 1200;
const TAB_ACTIVITY_STATE_RECONCILE_INTERVAL_MS = 2500;
const TAB_ACTIVITY_STATE_RECONCILE_TIMEOUT_MS = 1200;

function sessionFileFromState(state) {
  return state && typeof state === "object" ? normalizedRestoreString(state.sessionFile, 4096) : undefined;
}

function rememberTabState(tab, state) {
  if (!tab || !state || typeof state !== "object") return;
  tab.lastState = state;
  if (!options.noSession && Object.prototype.hasOwnProperty.call(state, "sessionFile")) tab.sessionFile = sessionFileFromState(state);
}

function stateWithPendingThinking(tab, state) {
  if (!state || typeof state !== "object" || !tab?.pendingThinkingLevel) return state;
  return { ...state, pendingThinkingLevel: tab.pendingThinkingLevel };
}

function responseWithPendingThinking(tab, response) {
  if (!response || typeof response !== "object" || response.success === false || response.command !== "get_state") return response;
  return { ...response, data: stateWithPendingThinking(tab, response.data) };
}

function eventForTabClients(tab, event) {
  return {
    ...responseWithPendingThinking(tab, event),
    tabId: tab.id,
    tabTitle: tab.title,
    tabActivity: tabActivitySnapshot(tab),
  };
}

function broadcastPendingThinkingState(tab, state) {
  broadcastTabEvent(tab, {
    ...eventForTabClients(tab, { type: "response", command: "get_state", success: true, data: stateWithPendingThinking(tab, state) }),
    pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
  });
}

function forgetTabState(tab) {
  if (!tab) return;
  tab.lastState = null;
  tab.sessionFile = undefined;
  tab.pendingThinkingLevel = undefined;
}

function tabRestorableSessionFile(tab) {
  if (options.noSession) return undefined;
  return normalizedRestoreString(tab?.sessionFile || tab?.lastState?.sessionFile, 4096);
}

function createTabActivity(now = new Date().toISOString()) {
  return {
    status: "idle",
    isWorking: false,
    completionSerial: 0,
    lastChangedAt: now,
    lastStartedAt: null,
    lastCompletedAt: null,
  };
}

function resetTabActivity(tab) {
  tab.activity = createTabActivity();
}

function tabActivitySnapshot(tab) {
  return { ...(tab.activity || createTabActivity(tab.createdAt)) };
}

function pendingExtensionUiMap(tab) {
  if (!tab.pendingExtensionUiRequests) tab.pendingExtensionUiRequests = new Map();
  return tab.pendingExtensionUiRequests;
}

function extensionStatusMap(tab) {
  if (!tab.extensionStatuses) tab.extensionStatuses = new Map();
  return tab.extensionStatuses;
}

function extensionWidgetMap(tab) {
  if (!tab.extensionWidgets) tab.extensionWidgets = new Map();
  return tab.extensionWidgets;
}

function rememberExtensionStatusEvent(tab, event) {
  if (event?.type !== "extension_ui_request" || event.method !== "setStatus" || !event.statusKey) return;
  const statuses = extensionStatusMap(tab);
  if (event.statusText) statuses.set(String(event.statusKey), String(event.statusText));
  else statuses.delete(String(event.statusKey));
}

function rememberExtensionWidgetEvent(tab, event) {
  if (event?.type !== "extension_ui_request" || event.method !== "setWidget") return;
  const widgetKey = event.widgetKey || event.id;
  if (!widgetKey) return;
  const widgets = extensionWidgetMap(tab);
  if (Array.isArray(event.widgetLines)) widgets.set(String(widgetKey), { ...event, widgetKey: String(widgetKey), widgetLines: event.widgetLines.map((line) => String(line)) });
  else widgets.delete(String(widgetKey));
}

function clearExtensionStatuses(tab) {
  tab?.extensionStatuses?.clear();
}

function clearExtensionWidgets(tab) {
  tab?.extensionWidgets?.clear();
}

function replayExtensionStatuses(tab, res) {
  for (const [statusKey, statusText] of extensionStatusMap(tab)) {
    sendSse(res, {
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setStatus",
      statusKey,
      statusText,
      tabId: tab.id,
      tabTitle: tab.title,
      replayed: true,
      tabActivity: tabActivitySnapshot(tab),
      pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
    });
  }
}

function replayExtensionWidgets(tab, res) {
  const pendingExtensionUiRequestCount = pendingExtensionUiRequests(tab).length;
  for (const [widgetKey, request] of extensionWidgetMap(tab)) {
    sendSse(res, {
      ...request,
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey,
      tabId: tab.id,
      tabTitle: tab.title,
      replayed: true,
      tabActivity: tabActivitySnapshot(tab),
      pendingExtensionUiRequestCount,
    });
  }
}

function bashQueueForTab(tab) {
  if (!tab.bashQueue) tab.bashQueue = [];
  return tab.bashQueue;
}

function settleBashQueueItem(item, kind, value) {
  if (!item || item.settled) return;
  item.settled = true;
  if (kind === "resolve") item.resolve(value);
  else item.reject(value);
}

function bashQueueEvent(tab) {
  const queue = bashQueueForTab(tab);
  const activeItem = tab.bashQueueDraining ? queue[0] : null;
  return {
    type: "webui_bash_queue_update",
    tabId: tab.id,
    tabTitle: tab.title,
    activeCommand: activeItem?.command?.command,
    queueLength: Math.max(0, queue.length - (activeItem ? 1 : 0)),
    tabActivity: tabActivitySnapshot(tab),
  };
}

function broadcastBashQueueUpdate(tab) {
  if (tab?.sseClients) broadcastTabEvent(tab, bashQueueEvent(tab));
}

function rejectTabBashQueue(tab, error) {
  const queue = tab?.bashQueue;
  if (!queue?.length) return;
  for (const item of queue.splice(0)) settleBashQueueItem(item, "reject", error);
  tab.bashQueueDraining = false;
  broadcastBashQueueUpdate(tab);
}

async function drainTabBashQueue(tab) {
  if (tab.bashQueueDraining) return;
  const queue = bashQueueForTab(tab);
  tab.bashQueueDraining = true;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      broadcastBashQueueUpdate(tab);
      try {
        const response = await tab.rpc.send(item.command);
        settleBashQueueItem(item, "resolve", response);
      } catch (error) {
        settleBashQueueItem(item, "reject", error);
      } finally {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        broadcastBashQueueUpdate(tab);
      }
    }
  } finally {
    tab.bashQueueDraining = false;
    broadcastBashQueueUpdate(tab);
  }
}

function sendQueuedBashCommand(tab, command) {
  return new Promise((resolve, reject) => {
    const queue = bashQueueForTab(tab);
    queue.push({ id: randomUUID(), command, resolve, reject, settled: false, queuedAt: new Date().toISOString() });
    broadcastBashQueueUpdate(tab);
    void drainTabBashQueue(tab);
  });
}

function isPendingExtensionUiRequest(event) {
  return event?.type === "extension_ui_request" && EXTENSION_UI_BLOCKING_METHODS.has(event.method) && event.id;
}

function pruneExpiredPendingExtensionUiRequests(tab, nowMs = Date.now()) {
  const pending = tab?.pendingExtensionUiRequests;
  if (!pending) return;
  for (const [id, request] of pending) {
    const expiresAtMs = Date.parse(request.expiresAt || "");
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) pending.delete(id);
  }
}

function pendingExtensionUiRequests(tab) {
  pruneExpiredPendingExtensionUiRequests(tab);
  return [...(tab?.pendingExtensionUiRequests?.values() || [])];
}

function pendingExtensionUiRequestSummaries(tab) {
  return pendingExtensionUiRequests(tab).map((request) => ({
    id: request.id,
    method: request.method,
    title: truncateStatusText(request.title || request.placeholder || "", 120),
    message: request.message ? truncateStatusText(request.message, 180) : undefined,
    receivedAt: request.receivedAt,
    expiresAt: request.expiresAt,
  }));
}

function trackPendingExtensionUiRequest(tab, event) {
  if (!isPendingExtensionUiRequest(event)) return;
  const receivedAt = new Date().toISOString();
  const timeoutMs = Number(event.timeout);
  const expiresAt = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new Date(Date.parse(receivedAt) + timeoutMs + 1000).toISOString() : undefined;
  pendingExtensionUiMap(tab).set(String(event.id), { ...event, receivedAt, expiresAt });
  if (!tab.activity?.isWorking) markTabWorking(tab, receivedAt);
}

function resolvePendingExtensionUiRequest(tab, id) {
  if (!id) return false;
  return !!tab?.pendingExtensionUiRequests?.delete(String(id));
}

function clearPendingExtensionUiRequests(tab) {
  tab?.pendingExtensionUiRequests?.clear();
}

function replayPendingExtensionUiRequests(tab, res) {
  const pending = pendingExtensionUiRequests(tab);
  for (const request of pending) {
    sendSse(res, {
      ...request,
      type: "extension_ui_request",
      replayed: true,
      tabId: tab.id,
      tabTitle: tab.title,
      pendingExtensionUiRequestCount: pending.length,
      tabActivity: tabActivitySnapshot(tab),
    });
  }
}

async function cancelPendingExtensionUiRequests(tab) {
  const pending = pendingExtensionUiRequests(tab);
  if (!pending.length) return 0;
  const ids = [];
  for (const request of pending) {
    ids.push(String(request.id));
    try {
      await tab.rpc.writeRaw({ type: "extension_ui_response", id: request.id, cancelled: true });
    } catch {
      // Abort should remain best-effort even if the RPC process already exited.
    }
    resolvePendingExtensionUiRequest(tab, request.id);
  }
  broadcastTabEvent(tab, {
    type: "webui_extension_ui_cancelled",
    tabId: tab.id,
    tabTitle: tab.title,
    ids,
    pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
    tabActivity: tabActivitySnapshot(tab),
  });
  return ids.length;
}

function markTabWorking(tab, timestamp = new Date().toISOString()) {
  const activity = tab.activity || createTabActivity(timestamp);
  activity.status = "working";
  activity.isWorking = true;
  activity.lastStartedAt = timestamp;
  activity.lastChangedAt = timestamp;
  tab.activity = activity;
}

function markTabDone(tab, timestamp = new Date().toISOString()) {
  const activity = tab.activity || createTabActivity(timestamp);
  activity.status = "done";
  activity.isWorking = false;
  activity.completionSerial = (Number(activity.completionSerial) || 0) + 1;
  activity.lastCompletedAt = timestamp;
  activity.lastChangedAt = timestamp;
  tab.activity = activity;
}

function markTabIdle(tab, timestamp = new Date().toISOString()) {
  const activity = tab.activity || createTabActivity(timestamp);
  activity.status = "idle";
  activity.isWorking = false;
  activity.lastChangedAt = timestamp;
  tab.activity = activity;
}

function commandStartsVisibleWork(command) {
  return command?.type === "compact" || (command?.type === "prompt" && !command.streamingBehavior);
}

function commandStartsConversation(command) {
  return command?.type === "prompt" && !command.streamingBehavior;
}

function stateHasVisibleWork(state) {
  return !!state?.isStreaming || !!state?.isCompacting || Number(state?.pendingMessageCount || 0) > 0;
}

function activityRecentlyStarted(activity, nowMs = Date.now()) {
  const startedMs = Date.parse(activity?.lastStartedAt || activity?.lastChangedAt || "");
  return Number.isFinite(startedMs) && nowMs - startedMs < TAB_ACTIVITY_IDLE_RECONCILE_GRACE_MS;
}

function reconcileTabActivityFromState(tab, state, timestamp = new Date().toISOString()) {
  if (!tab) return createTabActivity(timestamp);
  if (!state || typeof state !== "object") return tabActivitySnapshot(tab);
  if (pendingExtensionUiRequests(tab).length > 0) {
    if (!tab.activity?.isWorking) markTabWorking(tab, timestamp);
    return tabActivitySnapshot(tab);
  }
  if (stateHasVisibleWork(state)) {
    if (!tab.activity?.isWorking) markTabWorking(tab, timestamp);
    return tabActivitySnapshot(tab);
  }
  if (tab.activity?.isWorking && !activityRecentlyStarted(tab.activity)) {
    markTabDone(tab, timestamp);
  }
  return tabActivitySnapshot(tab);
}

async function reconcileWorkingTabActivity(tab) {
  if (!tab?.activity?.isWorking) return;
  if (activityRecentlyStarted(tab.activity)) return;
  const now = Date.now();
  if (now - (tab.activityStateReconcileAt || 0) < TAB_ACTIVITY_STATE_RECONCILE_INTERVAL_MS) return;
  tab.activityStateReconcileAt = now;
  try {
    const response = await tab.rpc.send({ type: "get_state" }, TAB_ACTIVITY_STATE_RECONCILE_TIMEOUT_MS);
    if (response?.success !== false) {
      rememberTabState(tab, response.data);
      reconcileTabActivityFromState(tab, response.data);
    }
  } catch {
    // Ignore reconciliation failures; normal RPC events will still update activity.
  }
}

async function listTabsWithReconciledActivity() {
  await Promise.all([...tabs.values()].map(reconcileWorkingTabActivity));
  return listTabs();
}

function updateTabActivityFromEvent(tab, event) {
  const timestamp = new Date().toISOString();
  switch (event?.type) {
    case "agent_start":
    case "compaction_start":
      markTabWorking(tab, timestamp);
      break;
    case "agent_end":
    case "compaction_end":
      markTabDone(tab, timestamp);
      break;
    case "pi_process_exit":
    case "pi_process_error":
      if (tab.activity?.isWorking) markTabDone(tab, timestamp);
      else markTabIdle(tab, timestamp);
      break;
    case "response":
      if (event.command === "get_state" && event.success !== false) {
        rememberTabState(tab, event.data);
        reconcileTabActivityFromState(tab, event.data, timestamp);
      } else if (!tab.activity) tab.activity = createTabActivity(timestamp);
      break;
    default:
      if (!tab.activity) tab.activity = createTabActivity(timestamp);
      break;
  }
  return tabActivitySnapshot(tab);
}

function defaultTabTitle(tabIndex) {
  if (options.name) return tabIndex === 1 ? options.name : `${options.name} ${tabIndex}`;
  return `Terminal ${tabIndex}`;
}

async function primeTabRpc(tab) {
  try {
    const response = await tab.rpc.send({ type: "get_state" }, 1500);
    if (response.success !== false) {
      rememberTabState(tab, response.data);
      reconcileTabActivityFromState(tab, response.data);
    }
  } catch (error) {
    if (!/Timed out waiting for RPC response/i.test(sanitizeError(error))) throw error;
  }
}

function attachRpcToTab(tab, rpc) {
  tab.rpcUnsubscribe?.();
  tab.rpc = rpc;
  tab.rpcUnsubscribe = rpc.onEvent((event) => {
    if (resolveWebuiHelperResponse(tab, event) || resolveWebuiHelperRpcResponse(tab, event)) return;
    updateTabActivityFromEvent(tab, event);
    let scopedEvent = eventForTabClients(tab, event);
    if (event?.type === "pi_process_exit" || event?.type === "pi_process_error") {
      clearPendingExtensionUiRequests(tab);
      clearExtensionStatuses(tab);
      clearExtensionWidgets(tab);
    } else {
      rememberExtensionStatusEvent(tab, scopedEvent);
      rememberExtensionWidgetEvent(tab, scopedEvent);
      trackPendingExtensionUiRequest(tab, scopedEvent);
    }
    scopedEvent = { ...scopedEvent, tabActivity: tabActivitySnapshot(tab), pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length };
    recordEvent(scopedEvent);
    for (const client of tab.sseClients) sendSse(client, scopedEvent);
  });
}

async function createTab({ id: requestedId, index, title, titleSource, conversationStarted, cwd, sessionFile, gitWorkspace } = {}) {
  const tabIndex = Number.isInteger(index) && index > 0 ? index : nextTabIndex;
  nextTabIndex = Math.max(nextTabIndex, tabIndex + 1);
  const explicitTitle = String(title || "").trim();
  const tabTitle = explicitTitle || defaultTabTitle(tabIndex);
  const titleIsExplicit = Boolean(explicitTitle || (options.name && tabIndex === 1));
  const resolvedTitleSource = ["explicit", "auto", "default"].includes(titleSource) ? titleSource : titleIsExplicit ? "explicit" : "default";
  const tabCwd = cwd ? await resolveCwd(cwd, options.cwd) : options.cwd;
  const id = requestedId && !tabs.has(requestedId) ? requestedId : randomUUID();
  const piArgs = await buildPiArgsForTab(tabIndex, tabTitle, tabCwd);
  if (sessionFile && !options.noSession) piArgs.push("--session", sessionFile);
  const piCommand = await resolvePiCommand(piArgs);
  const rpc = new PiRpcProcess({ ...piCommand, cwd: tabCwd });
  const createdAt = new Date().toISOString();
  const tab = {
    id,
    index: tabIndex,
    title: tabTitle,
    titleSource: resolvedTitleSource,
    conversationStarted: conversationStarted === true,
    cwd: tabCwd,
    createdAt,
    sessionFile: options.noSession ? undefined : normalizedRestoreString(sessionFile, 4096),
    gitWorkspace: gitWorkspace || null,
    lastState: null,
    pendingThinkingLevel: undefined,
    activity: createTabActivity(createdAt),
    pendingExtensionUiRequests: new Map(),
    extensionStatuses: new Map(),
    extensionWidgets: new Map(),
    webuiHelperRequests: new Map(),
    webuiHelperResponseIds: new Set(),
    bashQueue: [],
    bashQueueDraining: false,
    rpc: undefined,
    rpcUnsubscribe: undefined,
    sseClients: new Set(),
  };

  attachRpcToTab(tab, rpc);
  tabs.set(id, tab);
  rpc.start();
  try {
    await primeTabRpc(tab);
  } catch (error) {
    if (!tab.rpc.isRunning()) {
      tab.rpcUnsubscribe?.();
      tabs.delete(id);
      throw new Error(`Pi RPC process failed while starting ${tabTitle}: ${sanitizeError(error)}`);
    }
  }
  if (sessionFile && !options.noSession) {
    recordEvent({ type: "webui_tab_restored", tabId: tab.id, tabTitle: tab.title, cwd: tab.cwd });
  }
  return tab;
}

function firstTab() {
  return tabs.values().next().value;
}

function tabMeta(tab) {
  return {
    id: tab.id,
    index: tab.index,
    title: tab.title,
    titleSource: tab.titleSource || "default",
    conversationStarted: !!tab.conversationStarted,
    cwd: tab.cwd,
    sessionFile: tabRestorableSessionFile(tab),
    gitWorkspace: tab.gitWorkspace || null,
    pendingThinkingLevel: tab.pendingThinkingLevel || null,
    createdAt: tab.createdAt,
    startedAt: tab.rpc.startedAt,
    pid: tab.rpc.child?.pid,
    running: tab.rpc.isRunning(),
    command: tab.rpc.displayCommand,
    clientCount: tab.sseClients.size,
    pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
    activity: tabActivitySnapshot(tab),
    appRunner: publicAppRunnerState(tab.appRunner),
  };
}

function listTabs() {
  return [...tabs.values()].map(tabMeta);
}

function restorableTabDescriptor(tab, state = null) {
  return normalizeRestoreTabDescriptor({
    id: tab.id,
    index: tab.index,
    title: tab.title,
    titleSource: tab.titleSource,
    conversationStarted: tab.conversationStarted,
    cwd: tab.cwd,
    sessionFile: sessionFileFromState(state) || tabRestorableSessionFile(tab),
  }, new Set());
}

function restorableTabKey(tab) {
  if (tab.id) return `id:${tab.id}`;
  if (tab.sessionFile) return `session:${tab.sessionFile}`;
  return `tab:${tab.index || "?"}:${tab.title || ""}:${tab.cwd || ""}`;
}

function restorableTabSortIndex(tab) {
  return Number.isInteger(tab.index) && tab.index > 0 ? tab.index : Number.MAX_SAFE_INTEGER;
}

function mergeRestorableTabDescriptors(...sources) {
  const merged = [];
  const seen = new Set();
  for (const source of sources) {
    for (const item of Array.isArray(source) ? source : []) {
      const descriptor = normalizeRestoreTabDescriptor(item, new Set());
      if (!descriptor) continue;
      const key = restorableTabKey(descriptor);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(descriptor);
    }
  }
  return merged
    .sort((a, b) => restorableTabSortIndex(a) - restorableTabSortIndex(b) || String(a.title || "").localeCompare(String(b.title || "")))
    .slice(0, RESTORE_TAB_LIMIT);
}

async function restorableTabsForRestart() {
  const liveDescriptors = await Promise.all([...tabs.values()].map(async (tab) => {
    const state = await currentSessionState(tab).catch(() => tab.lastState || null);
    return restorableTabDescriptor(tab, state);
  }));
  return mergeRestorableTabDescriptors(liveDescriptors);
}

function spawnRestartServer(restorableTabs) {
  const env = {
    ...process.env,
    PI_WEBUI_RESTORE_TABS: JSON.stringify(restorableTabs || []),
    PI_WEBUI_START_DELAY_MS: "1200",
  };
  if (webuiDevServer) env.PI_WEBUI_DEV = "1";
  else delete env.PI_WEBUI_DEV;
  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

let updateStatusCache = null;
let updateStatusCacheAt = 0;
let piUpdateInProgress = false;

function updateChecksSkippedReason() {
  if (process.env.PI_OFFLINE) return "PI_OFFLINE is set";
  if (process.env.PI_SKIP_VERSION_CHECK) return "PI_SKIP_VERSION_CHECK is set";
  return "";
}

function basePackageUpdateStatus(packageName, currentVersion) {
  return {
    packageName,
    currentVersion: String(currentVersion || ""),
    latestVersion: null,
    updateAvailable: false,
    checked: false,
    skipped: false,
    skippedReason: "",
    error: "",
  };
}

async function checkLatestPiReleaseStatus() {
  const status = basePackageUpdateStatus(PI_CODING_AGENT_PACKAGE, piPackageJson.version);
  const skippedReason = updateChecksSkippedReason();
  if (skippedReason) {
    status.skipped = true;
    status.skippedReason = skippedReason;
    return status;
  }
  try {
    const data = await fetchJsonWithTimeout(PI_LATEST_VERSION_URL, {
      headers: {
        "User-Agent": `pi-webui/${packageJson.version} pi/${piPackageJson.version || "unknown"}`,
        accept: "application/json",
      },
    });
    const latestVersion = typeof data.version === "string" ? data.version.trim() : "";
    if (!latestVersion) throw new Error("latest-version response did not include a version");
    status.latestVersion = latestVersion;
    status.packageName = typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : PI_CODING_AGENT_PACKAGE;
    status.note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : "";
    status.updateAvailable = status.currentVersion ? isNewerPackageVersion(latestVersion, status.currentVersion) : false;
    status.checked = true;
  } catch (error) {
    status.error = sanitizeError(error);
  }
  return status;
}

function npmLatestPackageUrl(packageName) {
  return `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`;
}

async function checkLatestNpmPackageStatus(packageName, currentVersion) {
  const status = basePackageUpdateStatus(packageName, currentVersion);
  const skippedReason = updateChecksSkippedReason();
  if (skippedReason) {
    status.skipped = true;
    status.skippedReason = skippedReason;
    return status;
  }
  try {
    const data = await fetchJsonWithTimeout(npmLatestPackageUrl(packageName), {
      headers: {
        "User-Agent": `pi-webui/${packageJson.version}`,
        accept: "application/json",
      },
    });
    const latestVersion = typeof data.version === "string" ? data.version.trim() : "";
    if (!latestVersion) throw new Error(`${packageName} latest metadata did not include a version`);
    status.latestVersion = latestVersion;
    status.updateAvailable = status.currentVersion ? isNewerPackageVersion(latestVersion, status.currentVersion) : false;
    status.checked = true;
  } catch (error) {
    status.error = sanitizeError(error);
  }
  return status;
}

function updateStatusForRequest(status, req) {
  return {
    ...status,
    canRunUpdate: isLocalRequest(req),
    updateInProgress: piUpdateInProgress,
  };
}

async function getUpdateStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && updateStatusCache && now - updateStatusCacheAt < UPDATE_STATUS_CACHE_MS) return updateStatusCache;
  const [piStatus, webuiStatus] = await Promise.all([
    checkLatestPiReleaseStatus(),
    checkLatestNpmPackageStatus(WEBUI_PACKAGE, packageJson.version),
  ]);
  const updateAvailable = !!(piStatus.updateAvailable || webuiStatus.updateAvailable);
  updateStatusCache = {
    checkedAt: new Date(now).toISOString(),
    updateAvailable,
    restartRequired: true,
    command: "pi update",
    allCommand: "pi update --all",
    webuiDev: webuiDevServer,
    pi: piStatus,
    webui: webuiStatus,
    packages: {
      checked: false,
      note: "Default update runs pi update for Pi only. Use update all to run pi update --all for Pi and configured packages."
    },
  };
  updateStatusCacheAt = now;
  return updateStatusCache;
}

async function resolvePiUpdateCommand({ all = false } = {}) {
  const updateArgs = all ? ["update", "--all"] : ["update"];
  const label = all ? "Pi CLI and configured packages" : "Pi CLI";
  if (options.piBinExplicit) {
    const command = await resolvePiCommand(updateArgs);
    return { ...command, label, timeoutMs: PI_UPDATE_TIMEOUT_MS, maxOutputLength: PI_UPDATE_OUTPUT_MAX_CHARS };
  }

  const pathPi = await runCommand(options.piBin, ["--version"], { timeoutMs: 3000, maxOutputLength: 4000 });
  if (pathPi.exitCode === 0 && !pathPi.timedOut && !pathPi.error) {
    return { label, command: options.piBin, args: updateArgs, displayCommand: formatCommandForDisplay(options.piBin, updateArgs), timeoutMs: PI_UPDATE_TIMEOUT_MS, maxOutputLength: PI_UPDATE_OUTPUT_MAX_CHARS };
  }

  const fallback = await resolvePiCommand(updateArgs);
  return { ...fallback, label: `bundled ${label}`, timeoutMs: PI_UPDATE_TIMEOUT_MS, maxOutputLength: PI_UPDATE_OUTPUT_MAX_CHARS };
}

function packageNodeModulesPath(nodeModulesRoot, packageName) {
  return path.join(nodeModulesRoot, ...String(packageName || "").split("/").filter(Boolean));
}

function isWebuiOrPiPackageName(packageName) {
  const name = String(packageName || "").trim();
  return UPDATE_PACKAGE_NAMES.includes(name)
    || /^@firstpick\/pi(?:-|$)/.test(name)
    || /^@earendil-works\/pi(?:-|$)/.test(name)
    || /^@firstpick\/.*webui/i.test(name);
}

function declaredWebuiPiPackageNames(manifest) {
  const names = new Set();
  for (const section of [manifest?.dependencies, manifest?.optionalDependencies, manifest?.devDependencies]) {
    for (const packageName of Object.keys(section || {})) {
      if (isWebuiOrPiPackageName(packageName)) names.add(packageName);
    }
  }
  return [...names].sort();
}

async function packagesPresentInNodeModulesRoot(nodeModulesRoot, packageNames = UPDATE_PACKAGE_NAMES) {
  const found = new Set();
  if (!nodeModulesRoot || !await directoryExists(nodeModulesRoot)) return [];
  for (const packageName of packageNames) {
    if (await directoryExists(packageNodeModulesPath(nodeModulesRoot, packageName))) found.add(packageName);
  }

  let entries = [];
  try {
    entries = await readdir(nodeModulesRoot, { withFileTypes: true });
  } catch {
    return [...found].sort();
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      let scopedEntries = [];
      try {
        scopedEntries = await readdir(path.join(nodeModulesRoot, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
        if (!scopedEntry.isDirectory()) continue;
        const packageName = `${entry.name}/${scopedEntry.name}`;
        if (isWebuiOrPiPackageName(packageName)) found.add(packageName);
      }
      continue;
    }
    if (isWebuiOrPiPackageName(entry.name)) found.add(entry.name);
  }
  return [...found].sort();
}

async function packagesPresentInInstallPrefix(installRoot, packageNames = UPDATE_PACKAGE_NAMES) {
  const found = new Set();
  if (!installRoot || !await directoryExists(installRoot)) return [];
  const manifest = await readJsonFileIfExists(path.join(installRoot, "package.json"));
  for (const packageName of packageNames) {
    if (declaredDependencySpec(manifest, packageName) !== undefined) found.add(packageName);
  }
  for (const packageName of declaredWebuiPiPackageNames(manifest)) found.add(packageName);
  for (const packageName of await packagesPresentInNodeModulesRoot(path.join(installRoot, "node_modules"), packageNames)) {
    found.add(packageName);
  }
  return [...found].sort();
}

function packageInstallSpecs(packageNames) {
  return packageNames.map((packageName) => `${packageName}@latest`);
}

function npmCommandName() {
  return process.env.PI_WEBUI_NPM_BIN || "npm";
}

function npmPrefixUpdateTask(label, installRoot, packageNames) {
  if (!packageNames.length) return null;
  const npmCommand = npmCommandName();
  return {
    label,
    command: npmCommand,
    args: ["install", "--prefix", installRoot, "--ignore-scripts", "--min-release-age=0", ...packageInstallSpecs(packageNames)],
    cwd: installRoot,
  };
}

async function currentWebuiPackageUpdateTask() {
  const sourceCheckout = webuiDevServer || !String(packageRoot).split(path.sep).includes("node_modules");
  if (sourceCheckout) {
    const manifest = await readJsonFileIfExists(path.join(packageRoot, "package.json"));
    const packages = Object.keys(manifest?.dependencies || {}).filter(isWebuiOrPiPackageName).sort();
    return npmPrefixUpdateTask("current Web UI checkout package dependencies", packageRoot, packages);
  }

  const installRoot = nodeModulesParentForPackageRoot(packageRoot);
  const packages = await packagesPresentInInstallPrefix(installRoot);
  return npmPrefixUpdateTask("current Web UI install root", installRoot, packages);
}

async function agentPackageRootUpdateTask() {
  const installRoot = configuredAgentNpmRoot();
  const packages = await packagesPresentInInstallPrefix(installRoot);
  return npmPrefixUpdateTask("Pi agent npm package root", installRoot, packages);
}

async function npmGlobalNodeModulesRoot() {
  const npmCommand = npmCommandName();
  const result = await runCommand(npmCommand, ["root", "-g"], { timeoutMs: 5000, maxOutputLength: 8000 });
  if (result.exitCode !== 0 || result.timedOut || result.error) return null;
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || null;
}

async function npmGlobalPackageRootUpdateTask() {
  const nodeModulesRoot = await npmGlobalNodeModulesRoot();
  const packages = await packagesPresentInNodeModulesRoot(nodeModulesRoot);
  if (!packages.length) return null;
  const npmCommand = npmCommandName();
  return {
    label: "global npm package root",
    command: npmCommand,
    args: ["install", "-g", "--ignore-scripts", "--min-release-age=0", ...packageInstallSpecs(packages)],
    cwd: nodeModulesRoot ? path.dirname(nodeModulesRoot) : process.cwd(),
  };
}

async function bunGlobalNodeModulesRoots() {
  const available = await runCommand("bun", ["--version"], { timeoutMs: 3000, maxOutputLength: 2000 });
  if (available.exitCode !== 0 || available.timedOut || available.error) return [];

  const roots = new Set([path.join(homedir(), ".bun", "install", "global", "node_modules")]);
  const binResult = await runCommand("bun", ["pm", "bin", "-g"], { timeoutMs: 3000, maxOutputLength: 8000 });
  if (binResult.exitCode === 0 && !binResult.timedOut && !binResult.error) {
    const binDir = binResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (binDir) roots.add(path.join(path.dirname(binDir), "install", "global", "node_modules"));
  }
  return [...roots];
}

async function bunGlobalPackageRootUpdateTask() {
  const packages = new Set();
  for (const nodeModulesRoot of await bunGlobalNodeModulesRoots()) {
    for (const packageName of await packagesPresentInNodeModulesRoot(nodeModulesRoot)) packages.add(packageName);
  }
  if (!packages.size) return null;
  return {
    label: "global Bun package root",
    command: "bun",
    args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", ...packageInstallSpecs([...packages])],
    cwd: homedir(),
  };
}

function updateTaskDisplay(task) {
  return task.displayCommand || formatCommandForDisplay(task.command, task.args || []);
}

function uniqueUpdateTasks(tasks) {
  const unique = [];
  const seen = new Set();
  for (const task of tasks.filter(Boolean)) {
    const key = [task.command, JSON.stringify(task.args || []), task.cwd || ""].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(task);
  }
  return unique;
}

async function resolveUpdateTasks({ all = false } = {}) {
  return uniqueUpdateTasks([
    await resolvePiUpdateCommand({ all }),
  ]);
}

function updateFailureDetails(result) {
  return [result.error, result.timedOut ? "timed out" : undefined, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n");
}

async function runUpdateTask(task) {
  const command = updateTaskDisplay(task);
  recordEvent({ type: "webui_update_step_started", command });
  const result = await runCommand(task.command, task.args || [], {
    cwd: task.cwd || process.cwd(),
    timeoutMs: task.timeoutMs || PACKAGE_UPDATE_TIMEOUT_MS,
    maxOutputLength: task.maxOutputLength || PACKAGE_UPDATE_OUTPUT_MAX_CHARS,
  });
  const ok = result.exitCode === 0 && !result.timedOut && !result.error;
  if (!ok) {
    const details = updateFailureDetails(result);
    recordEvent({ type: "webui_update_step_failed", command, error: truncateStatusText(details || `exit code ${result.exitCode ?? "unknown"}`) });
    throw makeHttpError(500, truncateLongText(`Update step failed (${task.label || "package update"}): ${command}${details ? `\n${details}` : ""}`));
  }
  recordEvent({ type: "webui_update_step_completed", command });
  return {
    label: task.label || "package update",
    command,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function combinedUpdateOutput(results, field) {
  return results
    .map((result) => {
      const output = String(result?.[field] || "").trim();
      return output ? `# ${result.label}\n${output}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function runPiUpdateAndPrepareRestart({ all = false } = {}) {
  if (piUpdateInProgress) throw makeHttpError(409, "A Pi update is already running.");
  piUpdateInProgress = true;
  let restartPrepared = false;
  try {
    const restorableTabs = await restorableTabsForRestart();
    const updateTasks = await resolveUpdateTasks({ all });
    if (!updateTasks.length) throw makeHttpError(500, "No Pi update command could be resolved.");
    const command = updateTasks.map(updateTaskDisplay).join(" && ");
    const updateLabel = all ? "Pi and package updates" : "Pi update";
    recordEvent({ type: "webui_update_started", command, updateAll: all, restorableTabCount: restorableTabs.length });
    const results = [];
    for (const task of updateTasks) results.push(await runUpdateTask(task));

    updateStatusCache = null;
    updateStatusCacheAt = 0;
    const child = spawnRestartServer(restorableTabs);
    restartPrepared = true;
    recordEvent({ type: "webui_update_restarting", command, updateAll: all, nextWebuiPid: child.pid, restorableTabCount: restorableTabs.length });
    return {
      message: `${updateLabel} completed. Pi Web UI is restarting.`,
      command,
      commands: results.map((result) => ({ label: result.label, command: result.command })),
      stdout: combinedUpdateOutput(results, "stdout"),
      stderr: combinedUpdateOutput(results, "stderr"),
      webuiPid: process.pid,
      nextWebuiPid: child.pid,
      restorableTabCount: restorableTabs.length,
    };
  } finally {
    if (!restartPrepared) piUpdateInProgress = false;
  }
}

function rememberClosedRestorableTab(tab, state = null) {
  const descriptor = restorableTabDescriptor(tab, state);
  if (!descriptor) return;
  const key = restorableTabKey(descriptor);
  const existingIndex = closedRestorableTabs.findIndex((item) => restorableTabKey(item) === key);
  if (existingIndex !== -1) closedRestorableTabs.splice(existingIndex, 1);
  closedRestorableTabs.push(descriptor);
  while (closedRestorableTabs.length > RESTORE_TAB_LIMIT) closedRestorableTabs.shift();
}

function broadcastTabEvent(tab, event) {
  recordEvent(event);
  for (const client of tab.sseClients) sendSse(client, event);
}

function renameTab(tab, title, { source = "explicit", maxLength, unique = source === "auto" } = {}) {
  if (!tab) return false;
  const rawTitle = maxLength ? truncateTabTitle(title, maxLength) : String(title || "").replace(/\s+/g, " ").trim();
  const nextTitle = unique ? uniqueTabTitle(rawTitle, tab, maxLength || AUTO_TAB_TITLE_MAX_LENGTH) : rawTitle;
  if (!nextTitle) return false;

  const previousTitle = tab.title;
  tab.title = nextTitle;
  tab.titleSource = source;
  if (previousTitle === nextTitle) return false;

  broadcastTabEvent(tab, {
    type: "webui_tab_renamed",
    tabId: tab.id,
    tabTitle: tab.title,
    previousTabTitle: previousTitle,
    titleSource: source,
    tab: tabMeta(tab),
    tabActivity: tabActivitySnapshot(tab),
  });
  return true;
}

function maybeNameTabForConversation(tab, command) {
  if (!tab || !commandStartsConversation(command)) return false;
  const shouldRename = !tab.conversationStarted && tab.titleSource !== "explicit";
  tab.conversationStarted = true;
  if (!shouldRename) return false;
  const title = generatedTabTitleFromPrompt(command.message) || `Conversation ${tab.index}`;
  return renameTab(tab, title, { source: "auto", maxLength: AUTO_TAB_TITLE_MAX_LENGTH });
}

function responseWithTab(response, tab) {
  if (!response || typeof response !== "object") return response;
  return { ...response, tab: tabMeta(tab) };
}

async function updateTabCwd(id, cwd) {
  const tab = tabs.get(id);
  if (!tab) throw makeHttpError(404, `Unknown Pi tab: ${id}`);

  const nextCwd = await resolveCwd(cwd, tab.cwd);
  if (nextCwd === tab.cwd) return { tab, changed: false };

  // Capture the live session before stopping the old RPC so the conversation
  // survives the cwd restart, mirroring restartTabRpc. Best-effort: a dead RPC
  // falls back to the last remembered session file.
  if (tab.rpc?.isRunning()) await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  const sessionFile = tabRestorableSessionFile(tab);

  const piArgs = await buildPiArgsForTab(tab.index, tab.title, nextCwd);
  if (sessionFile && !options.noSession) piArgs.push("--session", sessionFile);
  const piCommand = await resolvePiCommand(piArgs);
  const restartingEvent = { type: "webui_tab_restarting", tabId: tab.id, tabTitle: tab.title, cwd: nextCwd, sessionFile };
  recordEvent(restartingEvent);
  for (const client of tab.sseClients) {
    sendSse(client, restartingEvent);
  }

  const oldRpc = tab.rpc;
  tab.rpcUnsubscribe?.();
  tab.rpcUnsubscribe = undefined;
  rejectTabBashQueue(tab, new Error("Pi tab is restarting; queued bash commands were cancelled"));
  stopAppRunnerForTab(tab, "cwd changed", { force: true });
  oldRpc.stop();

  tab.cwd = nextCwd;
  resetTabActivity(tab);
  clearPendingExtensionUiRequests(tab);
  clearExtensionStatuses(tab);
  clearExtensionWidgets(tab);
  const rpc = new PiRpcProcess({ ...piCommand, cwd: tab.cwd });
  attachRpcToTab(tab, rpc);
  rpc.start();
  // Non-fatal: a failed start surfaces through pi_process_error/exit events.
  await primeTabRpc(tab).catch(() => {});

  const changedEvent = { type: "webui_cwd_changed", tabId: tab.id, tabTitle: tab.title, cwd: tab.cwd, pid: tab.rpc.child?.pid, sessionFile, tabActivity: tabActivitySnapshot(tab) };
  recordEvent(changedEvent);
  for (const client of tab.sseClients) {
    sendSse(client, changedEvent);
  }
  return { tab, changed: true };
}

async function restartTabRpc(tab, reason = "reload") {
  const state = await tab.rpc.send({ type: "get_state" });
  if (state.success === false) throw makeHttpError(400, state.error || "Unable to read Pi state before reload");
  rememberTabState(tab, state.data);
  if (state.data?.isStreaming) throw makeHttpError(409, "Wait for the current response to finish before reloading.");
  if (state.data?.isCompacting) throw makeHttpError(409, "Wait for compaction to finish before reloading.");

  const piArgs = await buildPiArgsForTab(tab.index, tab.title, tab.cwd);
  if (state.data?.sessionFile && !options.noSession) piArgs.push("--session", state.data.sessionFile);
  const piCommand = await resolvePiCommand(piArgs);
  const reloadingEvent = { type: "webui_tab_reloading", tabId: tab.id, tabTitle: tab.title, cwd: tab.cwd, reason, sessionFile: state.data?.sessionFile };
  recordEvent(reloadingEvent);
  for (const client of tab.sseClients) sendSse(client, reloadingEvent);

  const oldRpc = tab.rpc;
  tab.rpcUnsubscribe?.();
  tab.rpcUnsubscribe = undefined;
  rejectTabBashQueue(tab, new Error("Pi tab is reloading; queued bash commands were cancelled"));
  oldRpc.stop();

  resetTabActivity(tab);
  clearPendingExtensionUiRequests(tab);
  clearExtensionStatuses(tab);
  clearExtensionWidgets(tab);
  const rpc = new PiRpcProcess({ ...piCommand, cwd: tab.cwd });
  attachRpcToTab(tab, rpc);
  rpc.start();

  const reloadedEvent = { type: "webui_tab_reloaded", tabId: tab.id, tabTitle: tab.title, cwd: tab.cwd, pid: tab.rpc.child?.pid, reason, sessionFile: state.data?.sessionFile, tabActivity: tabActivitySnapshot(tab) };
  recordEvent(reloadedEvent);
  for (const client of tab.sseClients) sendSse(client, reloadedEvent);
  return tab;
}

function rpcUnavailableMessage(tab) {
  return `Pi RPC process for ${tab?.title || "terminal"} is not running`;
}

function fallbackRpcResponse(tab, command, error) {
  const message = sanitizeError(error) || rpcUnavailableMessage(tab);
  const base = { type: "response", command: command.type, success: true, rpcRunning: false, error: message };
  switch (command.type) {
    case "get_state":
      return {
        ...base,
        data: {
          model: null,
          thinkingLevel: "off",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
          sessionFile: tab?.sessionFile,
          sessionId: tab?.id,
          sessionName: tab?.title,
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
          rpcRunning: false,
          rpcError: message,
        },
      };
    case "get_messages":
      return { ...base, data: { messages: [] } };
    case "get_available_models":
      return { ...base, data: { models: [] } };
    case "get_session_stats":
      return { ...base, data: null };
    case "get_last_assistant_text":
      return { ...base, data: { text: "" } };
    default:
      return { ...base, success: false, error: message };
  }
}

async function safeRpcResponse(tab, command, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    return responseWithPendingThinking(tab, await tab.rpc.send(command, timeoutMs));
  } catch (error) {
    const message = sanitizeError(error);
    if (/Pi RPC process is not running/i.test(message)) return responseWithPendingThinking(tab, fallbackRpcResponse(tab, command, error));
    throw error;
  }
}

function parseWebuiHelperResponseEvent(event) {
  if (event?.type !== "extension_ui_request" || event.method !== "notify") return undefined;
  const message = String(event.message || "");
  if (!message.startsWith(WEBUI_HELPER_RESPONSE_PREFIX)) return undefined;
  try {
    return JSON.parse(message.slice(WEBUI_HELPER_RESPONSE_PREFIX.length));
  } catch (error) {
    return { ok: false, error: `Invalid Web UI helper response: ${sanitizeError(error)}` };
  }
}

function resolveWebuiHelperResponse(tab, event) {
  const payload = parseWebuiHelperResponseEvent(event);
  if (!payload) return false;
  const requestId = String(payload.requestId || "");
  const pending = tab?.webuiHelperRequests?.get(requestId);
  if (pending) {
    tab.webuiHelperRequests.delete(requestId);
    clearTimeout(pending.timeout);
    if (payload.ok === false) pending.reject(makeHttpError(400, payload.error || "Web UI helper command failed"));
    else pending.resolve(payload.data || {});
  }
  return true;
}

function resolveWebuiHelperRpcResponse(tab, event) {
  if (event?.type !== "response" || event.command !== "prompt" || !event.id) return false;
  return tab?.webuiHelperResponseIds?.delete(String(event.id)) === true;
}

function webuiHelperRequestMap(tab) {
  if (!tab.webuiHelperRequests) tab.webuiHelperRequests = new Map();
  return tab.webuiHelperRequests;
}

async function sendWebuiHelperCommand(tab, action, payload = {}, timeoutMs = WEBUI_HELPER_TIMEOUT_MS) {
  const requestId = randomUUID();
  const pending = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      webuiHelperRequestMap(tab).delete(requestId);
      tab.webuiHelperResponseIds?.delete(requestId);
      reject(makeHttpError(504, `Timed out waiting for Web UI helper action: ${action}. Try /reload in this tab, then retry.`));
    }, timeoutMs);
    webuiHelperRequestMap(tab).set(requestId, { resolve, reject, timeout });
  });
  pending.catch(() => {});

  try {
    tab.webuiHelperResponseIds?.add(requestId);
    const response = await tab.rpc.send({
      id: requestId,
      type: "prompt",
      message: `/${WEBUI_HELPER_COMMAND} ${JSON.stringify({ requestId, action, payload })}`,
    }, timeoutMs);
    if (response.success === false) throw makeHttpError(400, response.error || `Web UI helper action failed: ${action}`);
    return await pending;
  } catch (error) {
    tab.webuiHelperResponseIds?.delete(requestId);
    const request = webuiHelperRequestMap(tab).get(requestId);
    if (request) {
      clearTimeout(request.timeout);
      webuiHelperRequestMap(tab).delete(requestId);
    }
    throw error;
  }
}

async function getToolConfigData(tab) {
  return sendWebuiHelperCommand(tab, "tools-state");
}

let packageManagerModulePromise;
async function loadPackageManagerModule() {
  if (!packageManagerModulePromise) {
    const packageMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const codingAgentRoot = path.dirname(path.dirname(packageMain));
    packageManagerModulePromise = import(pathToFileURL(path.join(codingAgentRoot, "dist", "core", "package-manager.js")).href);
  }
  return packageManagerModulePromise;
}

function parseSkillFrontmatter(text, filePath) {
  const frontmatter = String(text || "").match(/^---\s*\n([\s\S]*?)\n---/);
  const fields = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (match) fields[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
    }
  }
  const parent = path.basename(path.dirname(filePath));
  const base = path.basename(filePath, path.extname(filePath));
  return {
    name: fields.name || (path.basename(filePath) === "SKILL.md" ? parent : base),
    description: fields.description || "",
  };
}

function sourceInfoFromResolvedResource(resource) {
  const metadata = resource?.metadata || {};
  return {
    path: resource?.path,
    source: metadata.source,
    scope: metadata.scope,
    origin: metadata.origin,
    baseDir: metadata.baseDir,
  };
}

async function resolveSkillResources(tab) {
  const { DefaultPackageManager } = await loadPackageManagerModule();
  const settingsManager = SettingsManager.create(tab?.cwd || options.cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd: tab?.cwd || options.cwd, agentDir, settingsManager });
  const resolved = await packageManager.resolve();
  const skills = [];
  for (const resource of resolved.skills || []) {
    try {
      const metadata = parseSkillFrontmatter(await readFile(resource.path, "utf8"), resource.path);
      skills.push({
        ...metadata,
        filePath: resource.path,
        enabled: resource.enabled === true,
        configEnabled: resource.enabled === true,
        configManaged: true,
        sourceInfo: sourceInfoFromResolvedResource(resource),
      });
    } catch {
      // Ignore unreadable skill candidates; Pi will also skip invalid resources.
    }
  }
  return { skills, settingsManager };
}

function skillResourceKey(skill) {
  return skill.filePath || skill.name;
}

function mergeRuntimeAndResolvedSkills(runtimeSkills, resolvedSkills) {
  const byName = new Map();
  for (const skill of resolvedSkills) byName.set(skill.name, { ...skill });
  for (const skill of runtimeSkills || []) {
    const existing = byName.get(skill.name);
    byName.set(skill.name, existing ? { ...existing, ...skill, configManaged: existing.configManaged, configEnabled: existing.configEnabled, filePath: existing.filePath || skill.filePath, sourceInfo: existing.sourceInfo || skill.sourceInfo } : { ...skill, configManaged: false, configEnabled: true });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function getMergedSkillConfigData(tab) {
  const [runtime, resolved] = await Promise.all([
    getSkillConfigDataFromRuntime(tab).catch(() => ({ skills: [] })),
    resolveSkillResources(tab).catch((error) => {
      console.warn(`failed to resolve configured skills: ${sanitizeError(error)}`);
      return { skills: [] };
    }),
  ]);
  return { skills: mergeRuntimeAndResolvedSkills(runtime.skills || [], resolved.skills || []) };
}

function normalizeSkillRequestName(value) {
  return String(value || "").trim().replace(/^skill:/i, "").toLowerCase();
}

function skillFileRequestParts(source = {}) {
  return {
    name: normalizeSkillRequestName(source.name || source.skillName),
    filePath: String(source.path || source.filePath || "").trim(),
  };
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function skillFilePathInside(root, target) {
  if (!root || !target) return false;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function skillNameFromSkillFilePath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const match = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
  return normalizeSkillRequestName(match?.[1] || "");
}

async function resolveExplicitSkillFilePath(tab, filePath, requestedName = "") {
  const resolvedPath = path.resolve(filePath || "");
  const pathSkillName = skillNameFromSkillFilePath(resolvedPath);
  if (!pathSkillName) throw makeHttpError(400, "Skill path must point to /skills/<name>/SKILL.md");
  if (requestedName && requestedName !== pathSkillName) throw makeHttpError(400, "Skill name does not match the requested SKILL.md path");
  const allowedRoots = [agentDir, path.join(tab?.cwd || options.cwd, ".pi")];
  if (!allowedRoots.some((root) => skillFilePathInside(root, resolvedPath))) {
    throw makeHttpError(403, "Skill path is outside allowed Pi skill locations");
  }
  const info = await stat(resolvedPath).catch(() => null);
  if (!info?.isFile()) throw makeHttpError(404, `Skill file not found: ${resolvedPath}`);
  return {
    name: pathSkillName,
    description: "",
    filePath: resolvedPath,
    enabled: true,
    fileStats: info,
  };
}

async function resolveEditableSkillFile(tab, request = {}) {
  const { name, filePath } = skillFileRequestParts(request);
  if (!name && !filePath) throw makeHttpError(400, "Skill name or path is required");
  const { skills } = await resolveSkillResources(tab);
  const skill = skills.find((item) => (
    filePath ? sameResolvedPath(item.filePath, filePath) : name && normalizeSkillRequestName(item.name) === name
  ));
  if (skill?.filePath) {
    if (path.basename(skill.filePath) !== "SKILL.md") throw makeHttpError(400, "Only SKILL.md files can be edited from skill tags");
    const info = await stat(skill.filePath).catch(() => null);
    if (!info?.isFile()) throw makeHttpError(404, `Skill file not found: ${skill.filePath}`);
    return { ...skill, filePath: path.resolve(skill.filePath), fileStats: info };
  }
  if (filePath) return resolveExplicitSkillFilePath(tab, filePath, name);
  throw makeHttpError(404, "Skill is not configured in this Pi tab");
}

async function getSkillFileData(tab, request = {}) {
  const skill = await resolveEditableSkillFile(tab, request);
  const content = await readFile(skill.filePath, "utf8");
  return {
    name: parseSkillFrontmatter(content, skill.filePath).name || skill.name,
    description: skill.description || "",
    path: skill.filePath,
    content,
    mtimeMs: skill.fileStats.mtimeMs,
    size: skill.fileStats.size,
    enabled: skill.enabled === true,
  };
}

async function saveSkillFileData(tab, body = {}) {
  if (typeof body.content !== "string") throw makeHttpError(400, "Skill content must be a string");
  if (body.content.includes("\0")) throw makeHttpError(400, "Skill content cannot contain null bytes");
  if (Buffer.byteLength(body.content, "utf8") > SKILL_FILE_BODY_LIMIT_BYTES) throw makeHttpError(413, `Skill file is too large (limit ${formatBytes(SKILL_FILE_BODY_LIMIT_BYTES)})`);
  const skill = await resolveEditableSkillFile(tab, body);
  const expectedMtimeMs = Number(body.mtimeMs);
  if (Number.isFinite(expectedMtimeMs) && Math.abs(skill.fileStats.mtimeMs - expectedMtimeMs) > 5) {
    throw makeHttpError(409, "Skill file changed on disk after it was opened. Reopen it before saving.");
  }
  const tmpFile = `${skill.filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, body.content, { encoding: "utf8", mode: skill.fileStats.mode & 0o777 });
  await rename(tmpFile, skill.filePath);
  const nextStats = await stat(skill.filePath);
  const metadata = parseSkillFrontmatter(body.content, skill.filePath);
  return {
    name: metadata.name || skill.name,
    description: metadata.description || skill.description || "",
    path: skill.filePath,
    mtimeMs: nextStats.mtimeMs,
    size: nextStats.size,
    enabled: skill.enabled === true,
  };
}

function getResourcePatternForSkill(tab, skill) {
  const info = skill.sourceInfo || {};
  const baseDir = info.baseDir || (info.scope === "project" ? path.join(tab?.cwd || options.cwd, ".pi") : agentDir);
  return path.relative(baseDir, skill.filePath);
}

async function setToolConfigData(tab, body) {
  return sendWebuiHelperCommand(tab, "tools-set", {
    enabledTools: Array.isArray(body.enabledTools) ? body.enabledTools : undefined,
    disabledTools: Array.isArray(body.disabledTools) ? body.disabledTools : undefined,
  });
}

async function getSkillConfigDataFromRuntime(tab) {
  return sendWebuiHelperCommand(tab, "skills-state");
}

function desiredSkillEnabledFromBody(skillName, body) {
  if (Array.isArray(body.enabledSkills)) return body.enabledSkills.map(String).includes(skillName);
  if (Array.isArray(body.disabledSkills)) return !body.disabledSkills.map(String).includes(skillName);
  throw makeHttpError(400, "Skill update requires enabledSkills or disabledSkills");
}

function updatePatternListForResource(current, pattern, enabled) {
  const updated = (current || []).filter((item) => {
    const text = String(item || "");
    const stripped = text.startsWith("!") || text.startsWith("+") || text.startsWith("-") ? text.slice(1) : text;
    return stripped !== pattern;
  });
  updated.push(`${enabled ? "+" : "-"}${pattern}`);
  return updated;
}

function setSkillPathsForScope(settingsManager, scope, updated) {
  if (scope === "project") settingsManager.setProjectSkillPaths(updated);
  else settingsManager.setSkillPaths(updated);
}

function toggleConfiguredSkill(tab, settingsManager, skill, enabled) {
  const info = skill.sourceInfo || {};
  const scope = info.scope === "project" ? "project" : "user";
  if (info.origin === "package") {
    const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
    const packages = [...(settings.packages || [])];
    const packageIndex = packages.findIndex((item) => (typeof item === "string" ? item : item?.source) === info.source);
    if (packageIndex < 0) return false;
    let packageEntry = packages[packageIndex];
    if (typeof packageEntry === "string") {
      packageEntry = { source: packageEntry };
      packages[packageIndex] = packageEntry;
    }
    const pattern = path.relative(info.baseDir || path.dirname(skill.filePath), skill.filePath);
    packageEntry.skills = updatePatternListForResource(packageEntry.skills || [], pattern, enabled);
    if (scope === "project") settingsManager.setProjectPackages(packages);
    else settingsManager.setPackages(packages);
    return true;
  }

  const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
  const pattern = getResourcePatternForSkill(tab, skill);
  setSkillPathsForScope(settingsManager, scope, updatePatternListForResource(settings.skills || [], pattern, enabled));
  return true;
}

async function setSkillConfigData(tab, body) {
  const { skills, settingsManager } = await resolveSkillResources(tab);
  let configChanged = false;
  for (const skill of skills) {
    const desiredEnabled = desiredSkillEnabledFromBody(skill.name, body);
    if (skill.configEnabled !== desiredEnabled && toggleConfiguredSkill(tab, settingsManager, skill, desiredEnabled)) configChanged = true;
  }

  const runtimeOnly = skills.length === 0;
  if (runtimeOnly) {
    await sendWebuiHelperCommand(tab, "skills-set", {
      enabledSkills: Array.isArray(body.enabledSkills) ? body.enabledSkills : undefined,
      disabledSkills: Array.isArray(body.disabledSkills) ? body.disabledSkills : undefined,
    });
  }

  const activeTab = configChanged ? await restartTabRpc(tab, "skills-config") : tab;
  return getMergedSkillConfigData(activeTab);
}

function settingsManagerForTab(tab) {
  return SettingsManager.create(tab?.cwd || options.cwd, agentDir);
}

function nativeSettingsPayload(settingsManager = settingsManagerForTab()) {
  const settings = {
    transport: settingsManager.getTransport(),
    httpIdleTimeoutMs: settingsManager.getHttpIdleTimeoutMs(),
    autoResizeImages: settingsManager.getImageAutoResize(),
    blockImages: settingsManager.getBlockImages(),
    enableSkillCommands: settingsManager.getEnableSkillCommands(),
    hideThinkingBlock: settingsManager.getHideThinkingBlock(),
    showImages: settingsManager.getShowImages(),
    imageWidthCells: settingsManager.getImageWidthCells(),
    collapseChangelog: settingsManager.getCollapseChangelog(),
    quietStartup: settingsManager.getQuietStartup(),
    enableInstallTelemetry: settingsManager.getEnableInstallTelemetry(),
    doubleEscapeAction: settingsManager.getDoubleEscapeAction(),
    treeFilterMode: settingsManager.getTreeFilterMode(),
    showHardwareCursor: settingsManager.getShowHardwareCursor(),
    editorPaddingX: settingsManager.getEditorPaddingX(),
    autocompleteMaxVisible: settingsManager.getAutocompleteMaxVisible(),
    clearOnShrink: settingsManager.getClearOnShrink(),
    showTerminalProgress: settingsManager.getShowTerminalProgress(),
    warnings: settingsManager.getWarnings(),
  };
  return {
    settings,
    options: {
      thinkingLevels: THINKING_LEVELS,
      transports: SETTINGS_TRANSPORT_CHOICES,
      httpIdleTimeouts: SETTINGS_HTTP_IDLE_TIMEOUT_CHOICES,
      doubleEscapeActions: SETTINGS_DOUBLE_ESCAPE_ACTIONS,
      treeFilterModes: SETTINGS_TREE_FILTER_MODES,
      imageWidthCells: SETTINGS_IMAGE_WIDTH_CELLS,
      editorPaddingX: SETTINGS_EDITOR_PADDING_X,
      autocompleteMaxVisible: SETTINGS_AUTOCOMPLETE_MAX_VISIBLE,
    },
    scope: "global",
    paths: {
      global: settingsManager.storage?.globalSettingsPath || path.join(agentDir, "settings.json"),
      project: settingsManager.storage?.projectSettingsPath || path.join(options.cwd, ".pi", "settings.json"),
    },
  };
}

function hasOwnSetting(body, key) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

function requireBooleanSetting(value, key) {
  if (typeof value !== "boolean") throw makeHttpError(400, `${key} must be a boolean`);
  return value;
}

function requireStringChoiceSetting(value, key, choices) {
  const text = String(value ?? "").trim();
  if (!choices.includes(text)) throw makeHttpError(400, `${key} must be one of: ${choices.join(", ")}`);
  return text;
}

function requireNumberChoiceSetting(value, key, choices) {
  const number = Number(value);
  if (!Number.isFinite(number) || !choices.includes(number)) throw makeHttpError(400, `${key} must be one of: ${choices.join(", ")}`);
  return number;
}

function rememberSettingChange(changed, reloadRecommended, key, before, after) {
  if (before === after) return;
  changed.push(key);
  if (SETTINGS_RELOAD_RECOMMENDED_KEYS.has(key)) reloadRecommended.push(SETTINGS_RELOAD_LABELS.get(key) || key);
}

function applyBooleanSetting(body, key, settingsManager, getter, setter, changed, reloadRecommended) {
  if (!hasOwnSetting(body, key)) return;
  const next = requireBooleanSetting(body[key], key);
  const before = getter.call(settingsManager);
  if (before !== next) setter.call(settingsManager, next);
  rememberSettingChange(changed, reloadRecommended, key, before, next);
}

function applyStringChoiceSetting(body, key, choices, settingsManager, getter, setter, changed, reloadRecommended) {
  if (!hasOwnSetting(body, key)) return;
  const next = requireStringChoiceSetting(body[key], key, choices);
  const before = getter.call(settingsManager);
  if (before !== next) setter.call(settingsManager, next);
  rememberSettingChange(changed, reloadRecommended, key, before, next);
}

function applyNumberChoiceSetting(body, key, choices, settingsManager, getter, setter, changed, reloadRecommended) {
  if (!hasOwnSetting(body, key)) return;
  const next = requireNumberChoiceSetting(body[key], key, choices);
  const before = getter.call(settingsManager);
  if (before !== next) setter.call(settingsManager, next);
  rememberSettingChange(changed, reloadRecommended, key, before, next);
}

function applyHttpIdleTimeoutSetting(body, settingsManager, changed, reloadRecommended) {
  const key = "httpIdleTimeoutMs";
  if (!hasOwnSetting(body, key)) return;
  const next = Number(body[key]);
  if (!Number.isFinite(next) || next < 0) throw makeHttpError(400, `${key} must be a non-negative number`);
  const normalized = Math.floor(next);
  const before = settingsManager.getHttpIdleTimeoutMs();
  if (before !== normalized) settingsManager.setHttpIdleTimeoutMs(normalized);
  rememberSettingChange(changed, reloadRecommended, key, before, normalized);
}

async function setNativeSettingsData(tab, body) {
  const submitted = body?.settings && typeof body.settings === "object" ? body.settings : {};
  const settingsManager = settingsManagerForTab(tab);
  const changed = [];
  const reloadRecommended = [];

  applyStringChoiceSetting(submitted, "transport", SETTINGS_TRANSPORT_CHOICES, settingsManager, settingsManager.getTransport, settingsManager.setTransport, changed, reloadRecommended);
  applyHttpIdleTimeoutSetting(submitted, settingsManager, changed, reloadRecommended);
  applyBooleanSetting(submitted, "autoResizeImages", settingsManager, settingsManager.getImageAutoResize, settingsManager.setImageAutoResize, changed, reloadRecommended);
  applyBooleanSetting(submitted, "blockImages", settingsManager, settingsManager.getBlockImages, settingsManager.setBlockImages, changed, reloadRecommended);
  applyBooleanSetting(submitted, "enableSkillCommands", settingsManager, settingsManager.getEnableSkillCommands, settingsManager.setEnableSkillCommands, changed, reloadRecommended);
  applyBooleanSetting(submitted, "hideThinkingBlock", settingsManager, settingsManager.getHideThinkingBlock, settingsManager.setHideThinkingBlock, changed, reloadRecommended);
  applyBooleanSetting(submitted, "showImages", settingsManager, settingsManager.getShowImages, settingsManager.setShowImages, changed, reloadRecommended);
  applyNumberChoiceSetting(submitted, "imageWidthCells", SETTINGS_IMAGE_WIDTH_CELLS, settingsManager, settingsManager.getImageWidthCells, settingsManager.setImageWidthCells, changed, reloadRecommended);
  applyBooleanSetting(submitted, "collapseChangelog", settingsManager, settingsManager.getCollapseChangelog, settingsManager.setCollapseChangelog, changed, reloadRecommended);
  applyBooleanSetting(submitted, "quietStartup", settingsManager, settingsManager.getQuietStartup, settingsManager.setQuietStartup, changed, reloadRecommended);
  applyBooleanSetting(submitted, "enableInstallTelemetry", settingsManager, settingsManager.getEnableInstallTelemetry, settingsManager.setEnableInstallTelemetry, changed, reloadRecommended);
  applyStringChoiceSetting(submitted, "doubleEscapeAction", SETTINGS_DOUBLE_ESCAPE_ACTIONS, settingsManager, settingsManager.getDoubleEscapeAction, settingsManager.setDoubleEscapeAction, changed, reloadRecommended);
  applyStringChoiceSetting(submitted, "treeFilterMode", SETTINGS_TREE_FILTER_MODES, settingsManager, settingsManager.getTreeFilterMode, settingsManager.setTreeFilterMode, changed, reloadRecommended);
  applyBooleanSetting(submitted, "showHardwareCursor", settingsManager, settingsManager.getShowHardwareCursor, settingsManager.setShowHardwareCursor, changed, reloadRecommended);
  applyNumberChoiceSetting(submitted, "editorPaddingX", SETTINGS_EDITOR_PADDING_X, settingsManager, settingsManager.getEditorPaddingX, settingsManager.setEditorPaddingX, changed, reloadRecommended);
  applyNumberChoiceSetting(submitted, "autocompleteMaxVisible", SETTINGS_AUTOCOMPLETE_MAX_VISIBLE, settingsManager, settingsManager.getAutocompleteMaxVisible, settingsManager.setAutocompleteMaxVisible, changed, reloadRecommended);
  applyBooleanSetting(submitted, "clearOnShrink", settingsManager, settingsManager.getClearOnShrink, settingsManager.setClearOnShrink, changed, reloadRecommended);
  applyBooleanSetting(submitted, "showTerminalProgress", settingsManager, settingsManager.getShowTerminalProgress, settingsManager.setShowTerminalProgress, changed, reloadRecommended);

  if (submitted.warnings && typeof submitted.warnings === "object" && hasOwnSetting(submitted.warnings, "anthropicExtraUsage")) {
    const warnings = settingsManager.getWarnings();
    const before = warnings.anthropicExtraUsage ?? true;
    const next = requireBooleanSetting(submitted.warnings.anthropicExtraUsage, "warnings.anthropicExtraUsage");
    if (before !== next) {
      settingsManager.setWarnings({ ...warnings, anthropicExtraUsage: next });
      rememberSettingChange(changed, reloadRecommended, "warnings.anthropicExtraUsage", before, next);
    }
  }

  await settingsManager.flush();
  let activeTab = tab;
  let reloaded = false;
  const shouldReload = body?.reload === true && reloadRecommended.length > 0;
  if (shouldReload) {
    activeTab = await restartTabRpc(tab, "settings");
    reloaded = true;
  }

  return {
    ...nativeSettingsPayload(settingsManagerForTab(activeTab)),
    changed,
    reloadRecommended: [...new Set(reloadRecommended)],
    reloaded,
    tab: tabMeta(activeTab),
  };
}

async function annotateSkillCommandState(tab, commands) {
  let disabledSkills = new Set();
  try {
    const state = await getMergedSkillConfigData(tab);
    disabledSkills = new Set((state.skills || []).filter((skill) => skill.enabled === false).map((skill) => skill.name));
  } catch {
    // Commands should remain available even if an older tab has not loaded the helper yet.
  }

  return commands
    .filter((command) => command?.name !== WEBUI_HELPER_COMMAND)
    .map((command) => {
      const skillName = command?.source === "skill" && String(command.name || "").startsWith("skill:") ? String(command.name).slice("skill:".length) : "";
      return skillName ? { ...command, enabled: !disabledSkills.has(skillName) } : command;
    });
}

async function getCommandData(tab) {
  try {
    const response = await tab.rpc.send({ type: "get_commands" });
    if (response.success === false) throw makeHttpError(400, response.error || "failed to load commands");
    const rpcCommands = await annotateSkillCommandState(tab, response.data?.commands || []);
    return { commands: [...NATIVE_SLASH_COMMANDS, ...rpcCommands], rpcRunning: true };
  } catch (error) {
    const message = sanitizeError(error);
    if (!/Pi RPC process is not running/i.test(message)) throw error;
    return { commands: [...NATIVE_SLASH_COMMANDS], rpcRunning: false, error: message };
  }
}

function resolveCliPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(options.cwd, text);
}

function resolveTabPath(tab, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(tab?.cwd || options.cwd, text);
}

function configuredSessionDir() {
  for (let index = 0; index < options.piArgs.length; index++) {
    const arg = options.piArgs[index];
    if (arg === "--session-dir" && options.piArgs[index + 1]) return resolveCliPath(options.piArgs[index + 1]);
    if (arg.startsWith("--session-dir=")) return resolveCliPath(arg.slice("--session-dir=".length));
  }
  return undefined;
}

/** Roots that session switch/rename/delete paths must stay inside. */
function allowedSessionDirs() {
  const configured = configuredSessionDir();
  return configured ? [configured] : [path.join(agentDir, "sessions")];
}

function requireAllowedSessionPath(targetPath) {
  if (!isSessionPathAllowed(targetPath, allowedSessionDirs())) {
    throw makeHttpError(403, "sessionPath must stay inside the Pi session directory");
  }
}

function requirePersistentSessions() {
  if (options.noSession) throw makeHttpError(400, "Session selectors are unavailable when Web UI was started with --no-session.");
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeSessionInfo(info, currentSessionFile) {
  const sessionPath = String(info.path || "");
  return {
    path: sessionPath,
    id: String(info.id || ""),
    name: info.name || undefined,
    cwd: String(info.cwd || ""),
    created: isoDate(info.created),
    modified: isoDate(info.modified),
    messageCount: Number.isFinite(info.messageCount) ? info.messageCount : 0,
    firstMessage: truncateStatusText(info.firstMessage || "(no messages)", 220),
    parentSessionPath: info.parentSessionPath || undefined,
    current: !!currentSessionFile && path.resolve(sessionPath) === path.resolve(currentSessionFile),
  };
}

async function currentSessionState(tab) {
  const response = await safeRpcResponse(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  if (response.success === false) throw makeHttpError(400, response.error || "failed to load current session state");
  rememberTabState(tab, response.data);
  return response.data || {};
}

async function getSessionSelectorData(tab, scope = "current") {
  requirePersistentSessions();
  const state = await currentSessionState(tab).catch(() => tab.lastState || {});
  const sessionDir = configuredSessionDir();
  const listAll = String(scope || "current").toLowerCase() === "all";
  const sessions = listAll ? await SessionManager.listAll(sessionDir) : await SessionManager.list(tab.cwd, sessionDir);
  return {
    scope: listAll ? "all" : "current",
    sessionDir: sessionDir || undefined,
    currentSessionFile: state.sessionFile || tabRestorableSessionFile(tab),
    sessions: sessions.slice(0, SESSION_SELECTOR_LIMIT).map((info) => normalizeSessionInfo(info, state.sessionFile || tabRestorableSessionFile(tab))),
    limited: sessions.length > SESSION_SELECTOR_LIMIT,
  };
}

function extractSessionTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (part?.type === "toolCall") return `[tool call: ${part.toolName || "tool"}]`;
      if (part?.type === "thinking") return "[thinking]";
      if (part?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function sessionTreeEntryLabel(entry) {
  if (!entry || typeof entry !== "object") return "entry";
  if (entry.type === "message") return entry.message?.role || "message";
  if (entry.type === "branch_summary") return "branch summary";
  if (entry.type === "compaction") return "compaction";
  if (entry.type === "model_change") return "model";
  if (entry.type === "thinking_level_change") return "thinking";
  if (entry.type === "custom_message") return entry.customType || "custom";
  return entry.type || "entry";
}

function sessionTreeEntryText(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (entry.type === "message") return extractSessionTextContent(entry.message?.content);
  if (entry.type === "custom_message") return extractSessionTextContent(entry.content);
  if (entry.type === "branch_summary") return entry.summary || "branch summary";
  if (entry.type === "compaction") return entry.summary || "compaction summary";
  if (entry.type === "model_change") return [entry.provider, entry.modelId].filter(Boolean).join("/");
  if (entry.type === "thinking_level_change") return entry.thinkingLevel || "";
  return "";
}

function flattenSessionTree(nodes, { depth = 0, leafId, result = [] } = {}) {
  for (const node of nodes || []) {
    const entry = node.entry || {};
    result.push({
      id: entry.id,
      parentId: entry.parentId ?? null,
      depth,
      type: entry.type || "entry",
      role: entry.message?.role || undefined,
      label: node.label || undefined,
      timestamp: entry.timestamp || undefined,
      title: sessionTreeEntryLabel(entry),
      text: truncateStatusText(sessionTreeEntryText(entry), TREE_SELECTOR_TEXT_LIMIT),
      childCount: Array.isArray(node.children) ? node.children.length : 0,
      currentLeaf: !!leafId && entry.id === leafId,
    });
    flattenSessionTree(node.children || [], { depth: depth + 1, leafId, result });
  }
  return result;
}

async function getSessionTreeData(tab) {
  requirePersistentSessions();
  const state = await currentSessionState(tab).catch(() => tab.lastState || {});
  const sessionFile = state.sessionFile || tabRestorableSessionFile(tab);
  if (!sessionFile) throw makeHttpError(400, "No persisted session file is available for /tree.");
  const manager = SessionManager.open(sessionFile, configuredSessionDir(), tab.cwd);
  const leafId = manager.getLeafId();
  return {
    sessionFile: manager.getSessionFile(),
    sessionId: manager.getSessionId(),
    cwd: manager.getCwd(),
    leafId,
    nodes: flattenSessionTree(manager.getTree(), { leafId }),
  };
}

async function getForkMessagesData(tab) {
  const response = await safeRpcResponse(tab, { type: "get_fork_messages" });
  if (response.success === false) throw makeHttpError(400, response.error || "failed to load fork points");
  return { messages: Array.isArray(response.data?.messages) ? response.data.messages : [] };
}

async function requireIdleForSessionAction(tab, actionLabel) {
  const state = await currentSessionState(tab);
  if (state.isStreaming || state.isCompacting) throw makeHttpError(409, `Wait for the current agent run or compaction to finish before ${actionLabel}.`);
}

async function runForkCommand(tab, entryId) {
  await requireIdleForSessionAction(tab, "forking the session");
  const targetEntryId = String(entryId || "").trim();
  if (!targetEntryId) throw makeHttpError(400, "entryId is required");
  const response = await tab.rpc.send({ type: "fork", entryId: targetEntryId });
  if (response.success === false) return response;
  const state = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  if (state.ok) rememberTabState(tab, state.data);
  return rpcSuccess("fork", {
    message: response.data?.cancelled ? "Fork cancelled." : "Forked the current session.",
    text: response.data?.text || "",
    result: response.data,
    tab: tabMeta(tab),
  });
}

async function runCloneCommand(tab) {
  await requireIdleForSessionAction(tab, "cloning the session");
  const response = await tab.rpc.send({ type: "clone" });
  if (response.success === false) return response;
  const state = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  if (state.ok) rememberTabState(tab, state.data);
  return rpcSuccess("clone", {
    message: response.data?.cancelled ? "Clone cancelled." : "Cloned the current session.",
    result: response.data,
    tab: tabMeta(tab),
  });
}

async function switchTabSession(tab, sessionPath) {
  requirePersistentSessions();
  await requireIdleForSessionAction(tab, "switching sessions");
  const targetPath = resolveTabPath(tab, sessionPath);
  if (!targetPath) throw makeHttpError(400, "sessionPath is required");
  if (!targetPath.endsWith(".jsonl")) throw makeHttpError(400, "sessionPath must point to a .jsonl session file");
  requireAllowedSessionPath(targetPath);
  const targetStats = await stat(targetPath).catch(() => null);
  if (!targetStats?.isFile()) throw makeHttpError(404, `Session file not found: ${targetPath}`);
  const manager = SessionManager.open(targetPath, configuredSessionDir());
  const response = await tab.rpc.send({ type: "switch_session", sessionPath: manager.getSessionFile() });
  if (response.success === false) return response;
  if (!response.data?.cancelled) {
    tab.cwd = manager.getCwd();
    const state = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
    if (state.ok) rememberTabState(tab, state.data);
  }
  return rpcSuccess("switch_session", {
    message: response.data?.cancelled ? "Resume cancelled." : "Resumed selected session.",
    result: response.data,
    tab: tabMeta(tab),
  });
}

let authContextCache;

function authContext() {
  if (!authContextCache) authContextCache = createAuthContext();
  return authContextCache;
}

async function renameSessionData(tab, body) {
  requirePersistentSessions();
  const sessionPath = resolveTabPath(tab, body.sessionPath || body.path);
  const result = await renameSessionMetadata(sessionPath, body.name, configuredSessionDir(), { allowedDirs: allowedSessionDirs() });
  return {
    message: `Renamed session metadata to: ${result.name}`,
    ...result,
  };
}

async function deleteSessionData(tab, body) {
  requirePersistentSessions();
  const state = await currentSessionState(tab).catch(() => tab.lastState || {});
  const validation = validateSessionDelete(resolveTabPath(tab, body.sessionPath || body.path), {
    openSessionFiles: collectOpenSessionFiles([...tabs.values()]),
    currentSessionFile: state.sessionFile || tabRestorableSessionFile(tab),
    confirmed: body.confirmed === true,
    allowedDirs: allowedSessionDirs(),
  });
  if (!validation.allowed) {
    throw makeHttpError(validation.reason === "confirmation_required" ? 409 : validation.reason === "outside_session_dir" ? 403 : 400, validation.message);
  }
  const deleted = await deleteSessionFile(validation.sessionPath, { allowedDirs: allowedSessionDirs() });
  return {
    message: deleted.method === "trash" ? "Session moved to trash." : "Session deleted.",
    ...deleted,
  };
}

function getAuthProvidersData() {
  return authProvidersPayload(authContext().modelRegistry);
}

function logoutAuthProviderData(body) {
  if (body.confirmed !== true) throw makeHttpError(409, "Logout requires explicit confirmation (confirmed: true).");
  return logoutStoredProvider(authContext().modelRegistry, body.provider || body.providerId);
}

async function navigateSessionTree(tab, body) {
  requirePersistentSessions();
  await requireIdleForSessionAction(tab, "navigating the session tree");
  const entryId = String(body.entryId || body.targetId || "").trim();
  if (!entryId) throw makeHttpError(400, "entryId is required");
  const payload = {
    entryId,
    summarize: body.summarize === true,
    customInstructions: typeof body.customInstructions === "string" ? body.customInstructions : undefined,
    replaceInstructions: body.replaceInstructions === true,
    label: typeof body.label === "string" ? body.label : undefined,
  };
  const response = await tab.rpc.send({ type: "prompt", message: `/webui-tree-navigate ${JSON.stringify(payload)}` });
  if (response.success === false) return response;
  const state = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  if (state.ok) rememberTabState(tab, state.data);
  return rpcSuccess("tree", {
    message: "Navigated the session tree.",
    result: response.data,
    tab: tabMeta(tab),
  });
}

function formatSessionOutput(tab, state, stats) {
  return [
    `Session: ${state.sessionName || state.sessionId || "unknown"}`,
    `Tab: ${tab.title}`,
    `CWD: ${tab.cwd}`,
    `Model: ${state.model ? `${state.model.provider}/${state.model.id}` : "none"}`,
    `Thinking: ${state.thinkingLevel || "unknown"}`,
    `Status: ${state.isStreaming ? "running" : state.isCompacting ? "compacting" : "idle"}`,
    `Messages: ${state.messageCount ?? "?"}`,
    `Queue: ${state.pendingMessageCount ?? 0}`,
    `Session file: ${state.sessionFile || "none"}`,
    stats ? `Tokens: input ${stats.tokens?.input ?? 0}, output ${stats.tokens?.output ?? 0}, cache read ${stats.tokens?.cacheRead ?? 0}` : undefined,
    stats?.cost !== undefined ? `Cost: ${stats.cost}` : undefined,
  ].filter(Boolean).join("\n");
}

function nativeExportBaseName(tab, state = {}) {
  const source = state.sessionName || tab?.title || state.sessionId || "pi-session";
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  return safeDownloadFileName(`${source}-${date}`, "pi-session").replace(/\s+/g, "-");
}

async function nativeExportTempPath(tab, state = {}, ext = ".html") {
  await mkdir(NATIVE_EXPORT_TEMP_ROOT, { recursive: true });
  return path.join(NATIVE_EXPORT_TEMP_ROOT, `${nativeExportBaseName(tab, state)}-${randomUUID()}${ext}`);
}

function exportTargetExtension(targetPath) {
  return path.extname(targetPath).toLowerCase();
}

async function exportTargetExists(targetPath) {
  const targetStats = await stat(targetPath).catch(() => null);
  return !!targetStats;
}

async function handleNativeExportCommand(tab, args, req) {
  const explicitTarget = String(args || "").trim();
  const state = await currentSessionState(tab).catch(() => tab.lastState || {});

  if (!explicitTarget) {
    const outputPath = await nativeExportTempPath(tab, state, ".html");
    const response = await tab.rpc.send({ type: "export_html", outputPath });
    if (response.success === false) return response;
    const exportedPath = response.data?.path || outputPath;
    const download = registerNativeDownload(exportedPath, {
      command: "export",
      fileName: `${nativeExportBaseName(tab, state)}.html`,
      contentType: MIME_TYPES.get(".html"),
    });
    return respondNative("export", {
      status: "succeeded",
      level: "info",
      message: `Exported current session to HTML.\nDownload: ${download.fileName}\nOpen it in your browser when prompted.\nOpen URL: ${download.openUrl || download.url}\nDownload URL: ${download.url}\nLink expires: ${download.expiresAt}`,
      download,
      result: response.data,
      refresh: ["state"],
    });
  }

  if (!isLocalRequest(req)) {
    return respondNative("export", {
      status: "blocked",
      level: "error",
      reason: "Server-side export paths are only allowed from localhost.",
      safetyRestriction: "Explicit /export paths write files on the server and are blocked for non-local browser clients.",
      message: "Explicit /export paths are only allowed from localhost. Run /export without a path for a browser download, or retry from the local machine.",
      refresh: [],
    });
  }

  const targetPath = resolveTabPath(tab, explicitTarget);
  const ext = exportTargetExtension(targetPath);
  if (![".html", ".jsonl"].includes(ext)) throw makeHttpError(400, "Usage: /export [path.html|path.jsonl]");
  if (await exportTargetExists(targetPath)) {
    return respondNative("export", {
      status: "confirmation_required",
      level: "warn",
      reason: `Export target already exists: ${targetPath}`,
      safetyRestriction: "Overwrites require an explicit confirmation flow, which is not available from plain slash-command text yet.",
      message: `Export target already exists and was not overwritten:\n${targetPath}\n\nUse /export without a path for a browser download, or delete/rename the existing file first.`,
      refresh: [],
    });
  }

  await mkdir(path.dirname(targetPath), { recursive: true });

  if (ext === ".html") {
    const response = await tab.rpc.send({ type: "export_html", outputPath: targetPath });
    if (response.success === false) return response;
    return respondNative("export", {
      status: "succeeded",
      level: "info",
      message: `Exported current session HTML to server path:\n${response.data?.path || targetPath}`,
      serverPath: response.data?.path || targetPath,
      result: response.data,
      refresh: ["state"],
    });
  }

  requirePersistentSessions();
  const sessionFile = state.sessionFile || tabRestorableSessionFile(tab);
  if (!sessionFile) throw makeHttpError(400, "No persisted session file is available for JSONL export.");
  const sourceStats = await stat(sessionFile).catch(() => null);
  if (!sourceStats?.isFile()) throw makeHttpError(404, `Current session file not found: ${sessionFile}`);
  await copyFile(sessionFile, targetPath);
  return respondNative("export", {
    status: "succeeded",
    level: "info",
    message: `Copied current session JSONL to server path:\n${targetPath}`,
    serverPath: targetPath,
    result: { path: targetPath, sourcePath: sessionFile },
    refresh: ["state"],
  });
}

function webuiHotkeysOutput() {
  return [
    "Web UI hotkeys:",
    "Enter: send on desktop; newline on mobile",
    "Ctrl/Cmd+Enter: send from textarea",
    "Tab: accept slash-command or @path suggestion",
    "Arrow up/down: move through slash-command or @path suggestions",
    "Escape: close actions, tabs, model picker, or mobile drawer",
    "Mobile: Send button submits; Return inserts a newline",
  ].join("\n");
}

async function handleNativeSlashCommand(tab, body, req) {
  const parsed = parseSlashCommand(body.message);
  if (!parsed) return undefined;

  // Dispatch guards come straight from the parity matrix guards array (not the
  // sensitive flag), so localhost/trusted-context entries cannot drift out of
  // enforcement; confirmation guards stay handler/browser-specific by design.
  const evaluation = evaluateDispatchTrustGuards(guardsForNativeCommand(parsed.name, nativeParityMatrix), {
    isLocal: isLocalRequest(req),
    confirmed: body.confirmed === true,
    networkOpen: networkStatus().open,
  });
  if (!evaluation.allowed) {
    return nativeCommandBlocked(parsed.name, req, nativeParityMatrix, {
      confirmed: body.confirmed === true,
      networkOpen: networkStatus().open,
    });
  }

  switch (parsed.name) {
    case "reload": {
      const reloaded = await restartTabRpc(tab, "slash-command");
      return respondNative("reload", {
        status: "succeeded",
        message: "Reloaded keybindings, extensions, skills, prompts, and themes.",
        tab: tabMeta(reloaded),
        refresh: ["tabs", "state", "commands"],
      });
    }
    case "new": {
      const response = await tab.rpc.send({ type: "new_session" });
      if (response.success === false) return response;
      tab.conversationStarted = false;
      return respondNative("new", {
        status: "succeeded",
        message: "Started a new session.",
        tab: tabMeta(tab),
        result: response.data,
        refresh: ["tabs", "state"],
      });
    }
    case "compact": {
      const response = await tab.rpc.send(parsed.args ? { type: "compact", customInstructions: parsed.args } : { type: "compact" });
      if (response.success === false) return response;
      return respondNative("compact", {
        status: "succeeded",
        message: "Compaction finished.",
        result: response.data,
        refresh: ["state"],
      });
    }
    case "name": {
      if (!parsed.args) throw makeHttpError(400, "Usage: /name <session name>");
      const response = await tab.rpc.send({ type: "set_session_name", name: parsed.args });
      if (response.success === false) return response;
      renameTab(tab, parsed.args, { source: "explicit" });
      return respondNative("name", {
        status: "succeeded",
        message: `Session and tab name set to: ${tab.title}`,
        tab: tabMeta(tab),
        refresh: ["tabs"],
      });
    }
    case "session": {
      const [state, stats] = await Promise.all([
        tab.rpc.send({ type: "get_state" }),
        tab.rpc.send({ type: "get_session_stats" }).catch((error) => ({ success: false, error: sanitizeError(error) })),
      ]);
      if (state.success === false) return state;
      return respondNative("session", {
        status: "succeeded",
        message: formatSessionOutput(tab, state.data || {}, stats.success === false ? null : stats.data),
        refresh: ["state"],
      });
    }
    case "export": {
      return handleNativeExportCommand(tab, parsed.args, req);
    }
    case "copy": {
      const response = await tab.rpc.send({ type: "get_last_assistant_text" });
      if (response.success === false) return response;
      const text = String(response.data?.text || "");
      if (!text.trim()) throw makeHttpError(400, "No assistant message to copy.");
      return respondNative("copy", {
        status: "succeeded",
        message: "Copied the last assistant message.",
        copyText: text,
        refresh: [],
      });
    }
    case "hotkeys": {
      return respondNative("hotkeys", {
        status: "degraded",
        message: webuiHotkeysOutput(),
        refresh: [],
      });
    }
    case "clone": {
      const response = await runCloneCommand(tab);
      if (response.success === false) return response;
      return respondNative("clone", {
        status: "succeeded",
        message: response.data?.message || "Cloned the current session.",
        result: response.data?.result,
        refresh: ["tabs", "state"],
      });
    }
    default:
      return unavailableNative(parsed.name);
  }
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) throw makeHttpError(404, `Unknown Pi tab: ${id}`);
  if (tabs.size <= 1) throw makeHttpError(400, "Cannot close the last Pi tab");

  let restorableState = null;
  if (!options.noSession) {
    const stateResult = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
    if (stateResult.ok) restorableState = stateResult.data;
  }
  rememberClosedRestorableTab(tab, restorableState);

  const closingEvent = { type: "webui_tab_closing", tabId: tab.id, tabTitle: tab.title };
  recordEvent(closingEvent);
  for (const client of tab.sseClients) {
    sendSse(client, closingEvent);
    client.end();
  }
  tab.sseClients.clear();
  tab.rpcUnsubscribe?.();
  rejectTabBashQueue(tab, new Error("Pi tab closed; queued bash commands were cancelled"));
  stopAppRunnerForTab(tab, "tab closed", { force: true });
  tab.rpc.stop();
  tabs.delete(id);
  return tab;
}

async function closeTabs(ids) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
  const targetTabs = uniqueIds.map((id) => tabs.get(id)).filter(Boolean);
  if (!targetTabs.length) return [];

  if (targetTabs.length >= tabs.size) {
    await createTab({ cwd: targetTabs[0]?.cwd || options.cwd });
  }

  const closed = [];
  for (const tab of targetTabs) {
    if (!tabs.has(tab.id)) continue;
    closed.push(await closeTab(tab.id));
  }
  return closed;
}

function requestedTabId(req, url, body) {
  const header = req.headers["x-pi-webui-tab"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  return String(url.searchParams.get("tab") || url.searchParams.get("tabId") || body?.tabId || body?.tab || headerValue || "").trim();
}

function getRequestedTab(req, url, body = {}) {
  const id = requestedTabId(req, url, body);
  if (!id) {
    const tab = firstTab();
    if (!tab) throw makeHttpError(503, "No Pi tabs are available");
    return tab;
  }
  const tab = tabs.get(id);
  if (!tab) throw makeHttpError(404, `Unknown Pi tab: ${id}`);
  return tab;
}

function directoryPickerActiveCwd(req, url, body = {}) {
  const id = requestedTabId(req, url, body);
  if (id) return getRequestedTab(req, url, body).cwd;
  return firstTab()?.cwd || options.cwd;
}

async function createInitialTabs() {
  if (!restoreTabs.length) return options.cwdExplicit ? [await createTab()] : [];

  const created = [];
  for (const descriptor of restoreTabs) {
    try {
      created.push(await createTab(descriptor));
    } catch (error) {
      console.warn(`failed to restore Web UI tab ${descriptor.title || descriptor.id || "unknown"}: ${sanitizeError(error)}`);
    }
  }

  return created.length ? created : options.cwdExplicit ? [await createTab()] : [];
}

const serverStartedAt = new Date().toISOString();
let persistedRemoteAuthEnabled = await readPersistedRemoteAuthEnabled();
const initialTabs = await createInitialTabs();
const initialTab = initialTabs[0];
let currentHost = options.host;
let networkRebindInProgress = false;
let networkRebindTargetHost = null;
const remoteAuth = {
  pin: undefined,
  token: undefined,
  tokenExpiresAt: 0,
};

function localNetworkAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].sort();
}

function remoteAuthRequired() {
  return !isLocalHost(currentHost) && !!remoteAuth.pin;
}

function generateRemotePin() {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

function enableRemoteAuth(reason = "network exposure") {
  remoteAuth.pin = generateRemotePin();
  remoteAuth.token = createHash("sha256").update(`${randomUUID()}:${remoteAuth.pin}:${Date.now()}`).digest("base64url");
  remoteAuth.tokenExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  console.warn(`Pi Web UI remote PIN for ${reason}: ${remoteAuth.pin}`);
  return remoteAuth.pin;
}

function resetRemoteAuth() {
  remoteAuth.pin = undefined;
  remoteAuth.token = undefined;
  remoteAuth.tokenExpiresAt = 0;
}

function remoteAuthPreferenceEnabled() {
  return persistedRemoteAuthEnabled === true;
}

function remoteAuthStartupEnabled() {
  return options.remoteAuthExplicit ? options.remoteAuth === true : remoteAuthPreferenceEnabled();
}

function remoteAuthStartupReason() {
  if (options.remoteAuthExplicit) return "startup option";
  return "saved setting";
}

function remoteAuthStatus({ includePin = false } = {}) {
  const enabled = !!remoteAuth.pin;
  const status = {
    enabled,
    required: enabled && !isLocalHost(currentHost),
  };
  if (includePin && enabled) status.pin = remoteAuth.pin;
  return status;
}

function networkStatus({ includeAuthPin = false } = {}) {
  const open = !isLocalHost(currentHost);
  const targetHost = networkRebindTargetHost || currentHost;
  const opening = networkRebindInProgress && !isLocalHost(targetHost);
  const closing = networkRebindInProgress && isLocalHost(targetHost);
  const networkUrls = open ? localNetworkAddresses().map((address) => `http://${address}:${options.port}/`) : [];
  return {
    open,
    opening,
    closing,
    host: currentHost,
    port: options.port,
    localUrl: `http://127.0.0.1:${options.port}/`,
    networkUrls,
    auth: remoteAuthStatus({ includePin: includeAuthPin }),
  };
}

async function loadRemoteQrCore() {
  if (!remoteQrCorePromise) {
    remoteQrCorePromise = (async () => {
      const candidates = [];
      try {
        candidates.push(require.resolve("@firstpick/pi-package-remote-webui/lib/remote-core.mjs", { paths: [packageRoot] }));
      } catch {
        // Optional companion package is not installed; try the monorepo sibling below.
      }
      candidates.push(path.resolve(packageRoot, "..", "pi-package-remote-webui", "lib", "remote-core.mjs"));
      let lastError;
      for (const candidate of candidates) {
        try {
          await access(candidate);
          return await import(pathToFileURL(candidate).href);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Remote WebUI QR support is unavailable");
    })();
  }
  return remoteQrCorePromise;
}

function networkQrDisplayUrl(network) {
  const urls = Array.isArray(network?.networkUrls) ? network.networkUrls : [];
  return urls.find((candidate) => typeof candidate === "string" && /^https?:\/\//i.test(candidate)) || network?.localUrl || `http://127.0.0.1:${options.port}/`;
}

async function remoteNetworkQrPayload() {
  const network = networkStatus({ includeAuthPin: true });
  const { generateQrLines, remoteAuthQrUrl } = await loadRemoteQrCore();
  const displayUrl = networkQrDisplayUrl(network);
  const qrUrl = remoteAuthQrUrl(displayUrl, network);
  const qrLines = await generateQrLines(qrUrl);
  return { url: displayUrl, qrUrl, qrLines, network };
}

function closeSseClientsForRebind(nextHost) {
  for (const tab of tabs.values()) {
    const rebindEvent = {
      type: "webui_network_rebinding",
      tabId: tab.id,
      tabTitle: tab.title,
      host: nextHost,
      port: options.port,
      opening: !isLocalHost(nextHost),
      closing: isLocalHost(nextHost),
    };
    recordEvent(rebindEvent);
    for (const client of tab.sseClients) {
      sendSse(client, rebindEvent);
      client.end();
    }
    tab.sseClients.clear();
  }
}

function closeSseClientsForRemoteAuthChange() {
  for (const tab of tabs.values()) {
    const authEvent = {
      type: "webui_remote_auth_changed",
      tabId: tab.id,
      tabTitle: tab.title,
      auth: remoteAuthStatus(),
    };
    recordEvent(authEvent);
    for (const client of tab.sseClients) {
      sendSse(client, authEvent);
      client.end();
    }
    tab.sseClients.clear();
  }
}

function closeServerListener() {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const forceCloseTimer = setTimeout(() => {
      // Rebinding is intentionally disruptive. Long-poll/SSE/keep-alive clients can
      // otherwise keep server.close() pending and leave currentHost stuck on 0.0.0.0.
      server.closeAllConnections?.();
    }, NETWORK_REBIND_FORCE_CLOSE_MS);
    forceCloseTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceCloseTimer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

function listenOn(host) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, host);
  });
}

async function openToLocalNetwork() {
  const nextHost = "0.0.0.0";
  if (!isLocalHost(currentHost) || networkRebindInProgress) return networkStatus({ includeAuthPin: true });

  networkRebindInProgress = true;
  networkRebindTargetHost = nextHost;
  closeSseClientsForRebind(nextHost);
  const previousHost = currentHost;
  try {
    await closeServerListener();
    await listenOn(nextHost);
    currentHost = nextHost;
    console.warn(`WARNING: Web UI is now reachable from the local network${remoteAuth.pin ? " and requires the remote PIN for non-local clients" : " without remote PIN authentication"}.`);
    return networkStatus({ includeAuthPin: true });
  } catch (error) {
    console.error("Failed to open Web UI to local network:", sanitizeError(error));
    if (!server.listening) {
      try {
        await listenOn(previousHost);
      } catch (restoreError) {
        console.error("Failed to restore Web UI listener:", sanitizeError(restoreError));
      }
    }
    throw error;
  } finally {
    networkRebindInProgress = false;
    networkRebindTargetHost = null;
  }
}

async function closeNetworkAccess() {
  const nextHost = "127.0.0.1";
  if (isLocalHost(currentHost) || networkRebindInProgress) return networkStatus();

  networkRebindInProgress = true;
  networkRebindTargetHost = nextHost;
  closeSseClientsForRebind(nextHost);
  const previousHost = currentHost;
  try {
    await closeServerListener();
    await listenOn(nextHost);
    currentHost = nextHost;
    if (!remoteAuthPreferenceEnabled()) resetRemoteAuth();
    console.warn("Web UI network access closed; listening on localhost only.");
    return networkStatus({ includeAuthPin: true });
  } catch (error) {
    console.error("Failed to close Web UI network access:", sanitizeError(error));
    if (!server.listening) {
      try {
        await listenOn(previousHost);
      } catch (restoreError) {
        console.error("Failed to restore Web UI listener:", sanitizeError(restoreError));
      }
    }
    throw error;
  } finally {
    networkRebindInProgress = false;
    networkRebindTargetHost = null;
  }
}

if (remoteAuthStartupEnabled()) enableRemoteAuth(remoteAuthStartupReason());

async function safeRpcData(tab, command, timeoutMs = STATUS_RPC_TIMEOUT_MS) {
  try {
    const response = await tab.rpc.send(command, timeoutMs);
    if (response?.success === false) return { ok: false, error: response.error || `${command.type} failed` };
    if (command?.type === "get_state") rememberTabState(tab, response?.data);
    return { ok: true, data: command?.type === "get_state" ? stateWithPendingThinking(tab, response?.data) : response?.data ?? null };
  } catch (error) {
    return { ok: false, error: sanitizeError(error) };
  }
}

function stateIsBusyForSettings(state) {
  return !!(state?.isStreaming || state?.isCompacting);
}

async function setThinkingLevelForTab(tab, level, { allowPending = true } = {}) {
  if (!THINKING_LEVELS.includes(level)) throw makeHttpError(400, "Invalid thinking level");
  const stateResult = allowPending ? await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS) : { ok: false };
  if (allowPending && stateResult.ok && stateIsBusyForSettings(stateResult.data)) {
    tab.pendingThinkingLevel = level;
    broadcastPendingThinkingState(tab, stateResult.data);
    return rpcSuccess("set_thinking_level", { level, pending: true, message: `Thinking level ${level} will apply to the next prompt.` });
  }
  const response = await tab.rpc.send({ type: "set_thinking_level", level });
  if (response.success !== false) {
    tab.pendingThinkingLevel = undefined;
    const updatedState = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
    const effectiveLevel = updatedState.ok ? updatedState.data?.thinkingLevel : level;
    return { ...response, data: { ...(response.data && typeof response.data === "object" ? response.data : {}), level: effectiveLevel || level, requestedLevel: level } };
  }
  return response;
}

async function applyPendingThinkingBeforePrompt(tab) {
  const level = tab?.pendingThinkingLevel;
  if (!level) return null;
  const stateResult = await safeRpcData(tab, { type: "get_state" }, STATUS_RPC_TIMEOUT_MS);
  if (stateResult.ok && stateIsBusyForSettings(stateResult.data)) return null;
  const response = await setThinkingLevelForTab(tab, level, { allowPending: false });
  if (response.success === false) return response;
  return { ...response, pendingApplied: true };
}

function providerList(models) {
  const providers = new Set();
  for (const model of Array.isArray(models) ? models : []) {
    if (model?.provider) providers.add(String(model.provider));
  }
  return [...providers].sort();
}

async function tabStatusDetails(tab) {
  const [stateResult, modelsResult, statsResult, workspaceResult] = await Promise.all([
    safeRpcData(tab, { type: "get_state" }),
    safeRpcData(tab, { type: "get_available_models" }),
    safeRpcData(tab, { type: "get_session_stats" }),
    getWorkspaceInfo(tab.cwd, tab.rpc.startedAt).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error: sanitizeError(error) })),
  ]);
  const models = modelsResult.ok ? modelsResult.data?.models || [] : [];
  const stateData = stateResult.ok ? stateResult.data : tab.lastState || null;
  return {
    ...tabMeta(tab),
    state: stateData,
    stateError: stateResult.ok ? undefined : stateResult.error,
    stats: statsResult.ok ? statsResult.data : null,
    statsError: statsResult.ok ? undefined : statsResult.error,
    workspace: workspaceResult.ok ? workspaceResult.data : null,
    workspaceError: workspaceResult.ok ? undefined : workspaceResult.error,
    pendingExtensionUiRequests: pendingExtensionUiRequestSummaries(tab),
    models: {
      count: models.length,
      providers: providerList(models),
      error: modelsResult.ok ? undefined : modelsResult.error,
    },
  };
}

async function webuiStatus({ detailed = false, eventLimit = 40, includeAuthPin = false } = {}) {
  const tab = firstTab();
  const network = networkStatus({ includeAuthPin });
  const statusTabs = listTabs();
  const data = {
    online: true,
    webuiVersion: packageJson.version,
    webuiDev: webuiDevServer,
    webuiMode: webuiDevServer ? "dev" : "production",
    webuiPid: process.pid,
    startedAt: serverStartedAt,
    cwd: options.cwd,
    boundHost: currentHost,
    port: options.port,
    pageUrl: network.localUrl,
    boundUrl: `http://${formatUrlHost(currentHost)}:${options.port}/`,
    network,
    piPid: tab?.rpc.child?.pid,
    piRunning: !!tab?.rpc.child && tab.rpc.child.exitCode === null,
    tabs: statusTabs,
    restorableTabs: mergeRestorableTabDescriptors(statusTabs),
  };

  if (detailed) {
    const detailedTabs = await Promise.all([...tabs.values()].map((item) => tabStatusDetails(item)));
    data.tabs = detailedTabs;
    data.restorableTabs = mergeRestorableTabDescriptors(detailedTabs);
    data.closedTabs = closedRestorableTabs.slice();
    data.events = latestEvents(eventLimit);
  }

  return data;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/remote-auth" && req.method === "GET") {
      sendRemoteAuthPage(res, url.searchParams.get("return") || "/");
      return;
    }

    if (url.pathname === "/api/remote-auth" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: { auth: remoteAuthStatus({ includePin: isLocalRequest(req) }), local: isLocalRequest(req) } });
      return;
    }

    if (url.pathname === "/api/remote-auth" && req.method === "POST") {
      const body = await readJsonBody(req);
      const pin = String(body.pin || "").trim();
      if (!remoteAuth.pin) throw makeHttpError(400, "Remote PIN authentication is not enabled");
      if (!/^\d{4}$/.test(pin) || !safeTimingEqual(pin, remoteAuth.pin)) throw makeHttpError(403, "Incorrect remote PIN");
      sendJson(res, 200, { ok: true, data: { auth: remoteAuthStatus() } }, { "set-cookie": remoteAuthCookie() });
      return;
    }

    if (shouldChallengeRemoteAuth(req, url)) {
      sendRemoteAuthRequired(req, res, url);
      return;
    }

    if (url.pathname === "/api/remote-auth/settings" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req);
      if (body.enabled === true) {
        enableRemoteAuth("side panel toggle");
        await saveRemoteAuthPreference(true);
      } else if (body.enabled === false) {
        resetRemoteAuth();
        await saveRemoteAuthPreference(false);
      } else throw makeHttpError(400, "enabled must be true or false");
      closeSseClientsForRemoteAuthChange();
      const headers = body.enabled === false ? { "set-cookie": clearRemoteAuthCookie() } : {};
      sendJson(res, 200, { ok: true, data: { auth: remoteAuthStatus({ includePin: true }), network: networkStatus({ includeAuthPin: true }) } }, headers);
      return;
    }

    if (url.pathname === "/api/tabs" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: { tabs: await listTabsWithReconciledActivity() } });
      return;
    }

    if (url.pathname === "/api/tabs" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = await createTab({ title: body.title, cwd: body.cwd });
      sendJson(res, 201, { ok: true, data: { tab: tabMeta(tab), tabs: listTabs() } });
      return;
    }

    if (url.pathname === "/api/tabs/close" && req.method === "POST") {
      const body = await readJsonBody(req);
      const closed = await closeTabs(body.ids || body.tabIds || []);
      sendJson(res, 200, { ok: true, data: { closedIds: closed.map((tab) => tab.id), tabs: listTabs(), activeTabId: firstTab()?.id || null } });
      return;
    }

    if (url.pathname.startsWith("/api/tabs/") && req.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.slice("/api/tabs/".length));
      const body = await readJsonBody(req);
      const { tab, changed } = await updateTabCwd(id, body.cwd);
      sendJson(res, 200, { ok: true, data: { tab: tabMeta(tab), tabs: listTabs(), changed } });
      return;
    }

    if (url.pathname.startsWith("/api/tabs/") && req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/tabs/".length));
      await closeTab(id);
      sendJson(res, 200, { ok: true, data: { tabs: listTabs(), activeTabId: firstTab()?.id || null } });
      return;
    }

    if (url.pathname === "/api/events" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      });
      res.write(": connected\n\n");
      tab.sseClients.add(res);
      sendSse(res, {
        type: "webui_connected",
        version: packageJson.version,
        webuiDev: webuiDevServer,
        webuiMode: webuiDevServer ? "dev" : "production",
        tabId: tab.id,
        tabTitle: tab.title,
        pid: tab.rpc.child?.pid,
        cwd: tab.cwd,
        startedAt: tab.rpc.startedAt,
        tabActivity: tabActivitySnapshot(tab),
        pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
        activeRun: publicAppRunnerState(tab.appRunner),
      });
      replayExtensionStatuses(tab, res);
      replayExtensionWidgets(tab, res);
      replayPendingExtensionUiRequests(tab, res);
      const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        tab.sseClients.delete(res);
      });
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      const status = await webuiStatus({ includeAuthPin: isLocalRequest(req) });
      sendJson(res, 200, {
        ok: true,
        webuiVersion: status.webuiVersion,
        webuiDev: status.webuiDev,
        webuiMode: status.webuiMode,
        webuiPid: status.webuiPid,
        piPid: status.piPid,
        piRunning: status.piRunning,
        cwd: status.cwd,
        network: status.network,
        tabs: status.tabs,
        restorableTabs: status.restorableTabs,
      });
      return;
    }

    if (url.pathname === "/api/webui-status" && req.method === "GET") {
      const detailed = ["1", "true", "yes", "detailed"].includes(String(url.searchParams.get("detailed") || "").toLowerCase());
      const parsedEventLimit = Number.parseInt(url.searchParams.get("events") || "40", 10);
      const eventLimit = Number.isFinite(parsedEventLimit) ? parsedEventLimit : 40;
      sendJson(res, 200, { ok: true, data: await webuiStatus({ detailed, eventLimit, includeAuthPin: isLocalRequest(req) }) });
      return;
    }

    if (url.pathname === "/api/update-status" && req.method === "GET") {
      const force = ["1", "true", "yes", "refresh"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
      const status = await getUpdateStatus({ force });
      sendJson(res, 200, { ok: true, data: updateStatusForRequest(status, req) });
      return;
    }

    if (url.pathname === "/api/native-parity" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: nativeParityMatrix });
      return;
    }

    if (url.pathname.startsWith("/api/native-download/") && req.method === "GET") {
      await sendNativeDownload(res, decodeURIComponent(url.pathname.slice("/api/native-download/".length)), {
        inline: url.searchParams.get("disposition") === "inline",
      });
      return;
    }

    if (url.pathname === "/api/themes" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: await readBundledThemes() });
      return;
    }

    if (url.pathname === "/api/codex-usage" && req.method === "GET") {
      try {
        const forceRefresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
        sendJson(res, 200, { ok: true, data: await getOpenAICodexUsageStatus({ forceRefresh }) });
      } catch (error) {
        sendJson(res, error?.statusCode || 500, { ok: false, error: error?.message || "Failed to read OpenAI Codex usage" });
      }
      return;
    }

    if (url.pathname === "/api/network" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: networkStatus({ includeAuthPin: isLocalRequest(req) }) });
      return;
    }

    if (url.pathname === "/api/network/qr" && req.method === "GET") {
      requireLocalhost(req, "Remote QR generation is only allowed from localhost");
      sendJson(res, 200, { ok: true, data: await remoteNetworkQrPayload() });
      return;
    }

    if (url.pathname === "/api/network/open" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const before = networkStatus({ includeAuthPin: true });
      const shouldOpen = !before.open && !networkRebindInProgress;
      sendJson(res, 202, { ok: true, data: { ...before, opening: shouldOpen || before.opening, closing: before.closing } }, { connection: "close" });
      if (shouldOpen) {
        setTimeout(() => openToLocalNetwork().catch((error) => console.error("network open failed:", sanitizeError(error))), NETWORK_REBIND_DELAY_MS).unref();
      }
      return;
    }

    if (url.pathname === "/api/network/close" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const before = networkStatus({ includeAuthPin: true });
      const shouldClose = before.open && !networkRebindInProgress;
      sendJson(res, 202, { ok: true, data: { ...before, opening: before.opening, closing: shouldClose || before.closing } }, { connection: "close" });
      if (shouldClose) {
        setTimeout(() => closeNetworkAccess().catch((error) => console.error("network close failed:", sanitizeError(error))), NETWORK_REBIND_DELAY_MS).unref();
      }
      return;
    }

    if (url.pathname === "/api/restart" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const restorableTabs = await restorableTabsForRestart();
      const child = spawnRestartServer(restorableTabs);
      sendJson(res, 200, { ok: true, message: "Pi Web UI restarting", webuiPid: process.pid, nextWebuiPid: child.pid, restorableTabCount: restorableTabs.length });
      setTimeout(() => shutdown("api restart"), 20).unref();
      return;
    }

    if (url.pathname === "/api/update" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req);
      const queryAll = ["1", "true", "yes", "all"].includes(String(url.searchParams.get("all") || "").toLowerCase());
      const bodyAll = body?.all === true || String(body?.mode || "").toLowerCase() === "all";
      const data = await runPiUpdateAndPrepareRestart({ all: queryAll || bodyAll });
      sendJson(res, 200, { ok: true, data });
      setTimeout(() => shutdown("api update"), 20).unref();
      return;
    }

    if (url.pathname === "/api/shutdown" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      sendJson(res, 200, { ok: true, message: "Pi Web UI shutting down", webuiPid: process.pid });
      setTimeout(() => shutdown("api shutdown"), 20).unref();
      return;
    }

    if (url.pathname === "/api/workspace" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, {
        ok: true,
        data: await getWorkspaceInfo(tab.cwd, tab.rpc.startedAt),
      });
      return;
    }

    if (url.pathname === "/api/app-runners" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getAppRunnerData(tab) });
      return;
    }

    if (url.pathname === "/api/app-runner" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await startAppRunner(tab, String(body.runnerId || body.id || "")) });
      return;
    }

    if (url.pathname === "/api/app-runner/input" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const text = Object.prototype.hasOwnProperty.call(body, "text") ? body.text : body.input;
      sendJson(res, 200, { ok: true, data: sendAppRunnerInput(tab, text, { appendNewline: body.newline !== false, closeStdin: body.closeStdin === true || body.close === true }) });
      return;
    }

    if (url.pathname === "/api/app-runner/context" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await transferAppRunnerContext(tab, body) });
      return;
    }

    if (url.pathname === "/api/app-runner/stop" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      stopAppRunnerForTab(tab, "stop requested from Web UI");
      sendJson(res, 200, { ok: true, data: await getAppRunnerData(tab) });
      return;
    }

    if (url.pathname === "/api/app-runner/clear" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      clearAppRunnerForTab(tab);
      sendJson(res, 200, { ok: true, data: await getAppRunnerData(tab) });
      return;
    }

    if (url.pathname === "/api/app-runner-config" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getCustomAppRunnerConfigData(tab) });
      return;
    }

    if (url.pathname === "/api/app-runner-config" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await saveCustomAppRunner(tab, body.runner || body) });
      return;
    }

    if (url.pathname === "/api/app-runner-config" && req.method === "DELETE") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await deleteCustomAppRunner(tab, body.id || body.runnerId) });
      return;
    }

    if (url.pathname === "/api/app-runner-files" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getAppRunnerFileBrowserData(tab, url.searchParams.get("path")) });
      return;
    }

    if (url.pathname === "/api/directories" && req.method === "GET") {
      const activeCwd = directoryPickerActiveCwd(req, url);
      sendJson(res, 200, {
        ok: true,
        data: await getDirectoryPickerData(url.searchParams.get("path"), activeCwd),
      });
      return;
    }

    if (url.pathname === "/api/directories" && req.method === "POST") {
      const body = await readJsonBody(req);
      const activeCwd = directoryPickerActiveCwd(req, url, body);
      sendJson(res, 201, {
        ok: true,
        data: await createDirectoryPickerDirectory(body.parent ?? body.cwd ?? body.path, body.name, activeCwd),
      });
      return;
    }

    if (url.pathname === "/api/path-suggestions" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getPathSuggestionData(tab, url.searchParams.get("query")) });
      return;
    }

    if (url.pathname === "/api/path-fast-picks" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: { picks: await readPathFastPicks() } });
      return;
    }

    if (url.pathname === "/api/path-fast-picks" && req.method === "POST") {
      const body = await readJsonBody(req);
      const picks = await writePathFastPicks(body.picks ?? body);
      sendJson(res, 200, { ok: true, data: { picks } });
      return;
    }

    if (url.pathname === "/api/attachments" && req.method === "POST") {
      const body = await readJsonBody(req, { limitBytes: requestBodyLimitForPath(url.pathname) });
      sendJson(res, 201, { ok: true, data: await saveUploadedAttachments(body) });
      return;
    }

    if (url.pathname === "/api/scoped-models" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getScopedModelData(tab) });
      return;
    }

    if (url.pathname === "/api/model-cycle" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await cycleTabModel(tab, body.direction || body.mode);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/fork-messages" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getForkMessagesData(tab) });
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getSessionSelectorData(tab, url.searchParams.get("scope") || "current") });
      return;
    }

    if (url.pathname === "/api/session-tree" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getSessionTreeData(tab) });
      return;
    }

    if (url.pathname === "/api/fork" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await runForkCommand(tab, body.entryId);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/clone" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await runCloneCommand(tab);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/switch-session" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await switchTabSession(tab, body.sessionPath || body.path);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/session-rename" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await renameSessionData(tab, body), tab: tabMeta(tab) });
      return;
    }

    if (url.pathname === "/api/session-delete" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await deleteSessionData(tab, body), tab: tabMeta(tab) });
      return;
    }

    if (url.pathname === "/api/auth-providers" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: getAuthProvidersData() });
      return;
    }

    if (url.pathname === "/api/auth-logout" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req);
      sendJson(res, 200, { ok: true, data: logoutAuthProviderData(body) });
      return;
    }

    if (url.pathname === "/api/tree-navigate" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await navigateSessionTree(tab, body);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/optional-features" && req.method === "GET") {
      sendJson(res, 200, { ok: true, data: await optionalFeaturePackageStatuses() });
      return;
    }

    if (url.pathname === "/api/optional-feature-install" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req);
      const data = await installOptionalFeaturePackage(String(body.featureId || ""));
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (url.pathname === "/api/tools" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getToolConfigData(tab) });
      return;
    }

    if (url.pathname === "/api/tools" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await setToolConfigData(tab, body) });
      return;
    }

    if (url.pathname === "/api/skills" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getMergedSkillConfigData(tab) });
      return;
    }

    if (url.pathname === "/api/skills" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await setSkillConfigData(tab, body) });
      return;
    }

    if (url.pathname === "/api/skill-file" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: await getSkillFileData(tab, { name: url.searchParams.get("name"), path: url.searchParams.get("path") }) });
      return;
    }

    if (url.pathname === "/api/skill-file" && req.method === "POST") {
      requireLocalhostRoute(req, url.pathname);
      const body = await readJsonBody(req, { limitBytes: SKILL_FILE_BODY_LIMIT_BYTES });
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await saveSkillFileData(tab, body) });
      return;
    }

    if (url.pathname === "/api/settings" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { ok: true, data: nativeSettingsPayload(settingsManagerForTab(tab)) });
      return;
    }

    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      sendJson(res, 200, { ok: true, data: await setNativeSettingsData(tab, body) });
      return;
    }

    if (url.pathname === "/api/commands" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      sendJson(res, 200, { type: "response", command: "get_commands", success: true, data: await getCommandData(tab) });
      return;
    }

    if (url.pathname === "/api/action-feedback" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const response = await handleActionFeedback(tab, body);
      sendJson(res, response.success === false ? 400 : 200, response);
      return;
    }

    if (url.pathname === "/api/queue/remove" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const data = await sendWebuiHelperCommand(tab, "queue-remove", {
        kind: body.kind || "followUp",
        index: body.index,
        message: body.message,
      });
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (url.pathname === "/api/prompt" && req.method === "POST") {
      const body = await readJsonBody(req, { limitBytes: requestBodyLimitForPath(url.pathname) });
      const tab = getRequestedTab(req, url, body);
      const nativeResponse = await handleNativeSlashCommand(tab, body, req);
      if (nativeResponse) {
        sendJson(res, nativeResponse.success === false ? 400 : 200, responseWithTab(nativeResponse, tab));
        return;
      }
      const command = commandFromPost(url.pathname, body);
      const pendingThinkingResponse = await applyPendingThinkingBeforePrompt(tab);
      if (pendingThinkingResponse?.success === false) {
        sendJson(res, 400, responseWithTab(pendingThinkingResponse, tab));
        return;
      }
      const startsVisibleWork = commandStartsVisibleWork(command);
      if (startsVisibleWork) {
        maybeNameTabForConversation(tab, command);
        markTabWorking(tab);
      }
      const response = await tab.rpc.send(command, PROMPT_REQUEST_TIMEOUT_MS);
      if (response.success === false && startsVisibleWork) markTabIdle(tab);
      sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
      return;
    }

    if (url.pathname === "/api/git-changes" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      try {
        sendJson(res, 200, { ok: true, data: await readGitChanges(tab.cwd) });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: sanitizeError(error) });
      }
      return;
    }

    if (url.pathname === "/api/git-changes/untracked-file" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      try {
        sendJson(res, 200, { ok: true, data: await readGitUntrackedFile(tab.cwd, url.searchParams.get("path") || "") });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: sanitizeError(error) });
      }
      return;
    }

    if (url.pathname === "/api/git-changes/pull" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      try {
        sendJson(res, 200, await pullGitChanges(tab.cwd));
      } catch (error) {
        sendJson(res, 200, { ok: false, error: sanitizeError(error) });
      }
      return;
    }

    if (url.pathname === "/api/git-worktrees" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      try {
        sendJson(res, 200, { ok: true, data: await listGitWorktrees(tab.cwd) });
      } catch (error) {
        sendGitWorktreeFailure(res, error);
      }
      return;
    }

    if (url.pathname === "/api/git-worktrees" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      try {
        sendJson(res, 200, { ok: true, data: await createGitWorktreeTab(tab, body) });
      } catch (error) {
        sendGitWorktreeFailure(res, error);
      }
      return;
    }

    if (url.pathname === "/api/git-worktrees/open" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      try {
        sendJson(res, 200, { ok: true, data: await openExistingGitWorktreeTab(tab, body) });
      } catch (error) {
        sendGitWorktreeFailure(res, error);
      }
      return;
    }

    if (url.pathname === "/api/git-worktrees" && req.method === "DELETE") {
      requireLocalhost(req, "Removing Git worktrees is only allowed from localhost");
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      try {
        sendJson(res, 200, { ok: true, data: await removeGitWorktreeForTab(tab, body) });
      } catch (error) {
        sendGitWorktreeFailure(res, error);
      }
      return;
    }

    if (url.pathname === "/api/git-branches" && req.method === "GET") {
      const tab = getRequestedTab(req, url);
      try {
        sendJson(res, 200, { ok: true, data: await readGitBranches(tab.cwd) });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: sanitizeError(error) });
      }
      return;
    }

    if (url.pathname === "/api/git-branch" && req.method === "POST") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      try {
        sendJson(res, 200, await switchGitBranch(tab.cwd, body.branch, { create: body.create === true }));
      } catch (error) {
        sendJson(res, 200, { ok: false, error: sanitizeError(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/git-workflow/")) {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const tab = getRequestedTab(req, url, body);
      const response = await handleGitWorkflowRequest(url.pathname, body, tab);
      if (response) {
        sendJson(res, 200, response);
        return;
      }
    }

    const getCommand = req.method === "GET" ? commandFromGet(url.pathname) : undefined;
    if (getCommand) {
      const tab = getRequestedTab(req, url);
      const response = await safeRpcResponse(tab, getCommand);
      if (url.pathname === "/api/messages") applyMessagesSinceParam(response, url);
      sendJson(res, response.success === false ? 400 : 200, response);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/extension-ui-response") {
      const body = await readJsonBody(req);
      const tab = getRequestedTab(req, url, body);
      const { tabId, tab: _tab, ...payload } = body;
      if (payload.type !== "extension_ui_response") payload.type = "extension_ui_response";
      if (!payload.id) throw new Error("id is required");
      await tab.rpc.writeRaw(payload);
      const resolved = resolvePendingExtensionUiRequest(tab, payload.id);
      if (resolved) {
        broadcastTabEvent(tab, {
          type: "webui_extension_ui_resolved",
          tabId: tab.id,
          tabTitle: tab.title,
          id: String(payload.id),
          pendingExtensionUiRequestCount: pendingExtensionUiRequests(tab).length,
          tabActivity: tabActivitySnapshot(tab),
        });
      }
      sendJson(res, 200, { ok: true, tab: tabMeta(tab) });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req, { limitBytes: requestBodyLimitForPath(url.pathname) });
      const command = commandFromPost(url.pathname, body);
      if (command) {
        const tab = getRequestedTab(req, url, body);
        if (command.type === "abort") await cancelPendingExtensionUiRequests(tab);
        const startsVisibleWork = commandStartsVisibleWork(command);
        if (startsVisibleWork) {
          maybeNameTabForConversation(tab, command);
          markTabWorking(tab);
        }
        let response = command.type === "set_thinking_level"
          ? await setThinkingLevelForTab(tab, command.level)
          : command.type === "bash"
            ? await sendQueuedBashCommand(tab, command)
            : await tab.rpc.send(command);
        if (command.type === "bash" && response.success !== false) {
          const trustWarning = remoteShellTrustWarning(req, networkStatus().open);
          if (trustWarning) response = { ...response, warnings: [trustWarning] };
        }
        if (response.success === false && startsVisibleWork) markTabIdle(tab);
        if (response.success !== false && command.type === "new_session") {
          tab.conversationStarted = false;
          forgetTabState(tab);
          rememberTabState(tab, response.data);
          clearPendingExtensionUiRequests(tab);
          clearExtensionStatuses(tab);
          clearExtensionWidgets(tab);
        }
        sendJson(res, response.success === false ? 400 : 200, responseWithTab(response, tab));
        return;
      }
    }

    if (await serveStatic(req, res, url)) return;

    sendError(res, 404, "Not found");
  } catch (error) {
    sendError(res, error?.statusCode || 500, error);
  }
});

server.on("error", (error) => {
  if (networkRebindInProgress) {
    console.error("Web UI network rebind failed:", sanitizeError(error));
    return;
  }
  console.error("Web UI server failed:", sanitizeError(error));
  for (const tab of tabs.values()) {
    stopAppRunnerForTab(tab, "server error", { force: true });
    tab.rpc.stop();
  }
  process.exit(1);
});

function sweepWebuiTempArtifacts() {
  sweepStaleTempEntries(UPLOAD_TEMP_ROOT, { ttlMs: UPLOAD_TEMP_TTL_MS }).catch(() => {});
  sweepStaleTempEntries(NATIVE_EXPORT_TEMP_ROOT, { ttlMs: NATIVE_EXPORT_TEMP_TTL_MS }).catch(() => {});
}

sweepWebuiTempArtifacts();
setInterval(sweepWebuiTempArtifacts, TEMP_ARTIFACT_SWEEP_INTERVAL_MS).unref();

server.listen(options.port, currentHost, () => {
  const urlHost = formatUrlHost(currentHost);
  console.log(`Pi Web UI: http://${urlHost}:${options.port}/`);
  console.log(`Working directory: ${options.cwd}`);
  if (initialTab) console.log(`Pi RPC: ${initialTab.rpc.displayCommand}`);
  else console.log("Pi RPC: waiting for CWD selection in the Web UI");
  if (restoreTabs.length) console.log(`Restored Web UI tabs: ${initialTabs.length}`);
  if (!isLocalHost(currentHost)) {
    console.warn(`WARNING: Web UI is exposed to the network. Remote PIN auth is ${remoteAuth.pin ? "enabled" : "OFF"}; only expose it on trusted networks.`);
  }
});

function shutdown(signal) {
  console.log(`\n${signal}: shutting down Pi Web UI...`);
  const forceCloseTimer = setTimeout(() => {
    server.closeAllConnections?.();
  }, NETWORK_REBIND_FORCE_CLOSE_MS);
  forceCloseTimer.unref?.();
  server.close(() => {
    clearTimeout(forceCloseTimer);
    process.exit(0);
  });
  server.closeIdleConnections?.();
  for (const tab of tabs.values()) {
    stopAppRunnerForTab(tab, "server shutdown", { force: true });
    tab.rpc.stop();
  }
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
