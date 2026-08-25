import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const MAX_ENV_VALUE_BYTES = 16 * 1024;
const TEST_ONLY_ENVIRONMENT_NAMES = new Set([
  "QT_WEBUI_SMOKE_MODE",
  "QT_WEBUI_SMOKE_CAPTURE_PATH",
  "QT_WEBUI_SMOKE_STATE_PATH",
  "QT_WEBUI_THEME_MODE",
]);
const SIGNAL_EXIT_CODES = new Map([
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function actionablePiResolutionError(cause) {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return new Error(
    `Could not resolve the package-local ${PI_PACKAGE_NAME} CLI. Reinstall @firstpick/pi-package-qt-webui so its npm dependencies are present${detail}`,
    { cause },
  );
}

function findDependencyPackageRoot(resolvedModulePath) {
  let current = path.dirname(resolvedModulePath);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.name === PI_PACKAGE_NAME) return { root: current, manifest };
      } catch {
        // Continue upward: a nested package manifest is not necessarily Pi's manifest.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`resolved module is not inside ${PI_PACKAGE_NAME}`);
}

export function resolvePiCliEntry({
  resolveDependencyUrl = () => import.meta.resolve(PI_PACKAGE_NAME),
} = {}) {
  try {
    const resolvedModuleUrl = resolveDependencyUrl();
    const resolvedModulePath = fileURLToPath(resolvedModuleUrl);
    const { root, manifest } = findDependencyPackageRoot(resolvedModulePath);
    const binPath = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
    if (typeof binPath !== "string" || binPath.length === 0) {
      throw new Error(`${PI_PACKAGE_NAME} does not declare its pi CLI entry`);
    }

    const cliEntry = path.resolve(root, binPath);
    if (!existsSync(cliEntry)) throw new Error(`declared Pi CLI entry is missing: ${cliEntry}`);

    // Reading through a require rooted at the resolved package ensures the CLI came
    // from the dependency visible to this launcher, not an unrelated global command.
    const dependencyRequire = createRequire(pathToFileURL(path.join(root, "package.json")));
    const confirmedManifest = dependencyRequire(path.join(root, "package.json"));
    if (confirmedManifest.name !== PI_PACKAGE_NAME) throw new Error("resolved Pi package identity changed");
    return cliEntry;
  } catch (error) {
    throw actionablePiResolutionError(error);
  }
}

export function parseLauncherArgs(argv) {
  if (argv.length === 0) return { development: false };
  if (argv.length === 1 && argv[0] === "dev") return { development: true };
  throw new Error("Usage: qt-webui [dev]");
}

export function detectSystemColorScheme({
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  try {
    const result = spawnSyncImpl("busctl", [
      "--user",
      "call",
      "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.Settings",
      "Read",
      "ss",
      "org.freedesktop.appearance",
      "color-scheme",
    ], {
      encoding: "utf8",
      env,
      timeout: 1_500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) return "unknown";
    const match = String(result.stdout ?? "").match(/\bu\s+(\d+)\s*$/);
    if (match?.[1] === "1") return "dark";
    if (match?.[1] === "2") return "light";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function boundedEnvironmentValue(name, value) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  if (value.includes("\0")) throw new Error(`${name} cannot contain a NUL byte`);
  if (Buffer.byteLength(value, "utf8") > MAX_ENV_VALUE_BYTES) {
    throw new Error(`${name} exceeds the ${MAX_ENV_VALUE_BYTES}-byte limit`);
  }
  return value;
}

export function prepareLaunch({
  argv = [],
  cwd = process.cwd(),
  env = process.env,
  root = packageRoot,
  nodeExecutable = process.execPath,
  resolvePiEntry = resolvePiCliEntry,
  detectColorScheme = detectSystemColorScheme,
  testOnlyEnvironment = {},
} = {}) {
  const { development } = parseLauncherArgs(argv);
  const qmlEntry = path.resolve(root, "qml", "shell.qml");
  const piCliEntry = resolvePiEntry();
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("QT_WEBUI_")),
  );
  const detectedColorScheme = detectColorScheme({ env: inheritedEnvironment });
  const systemColorScheme = ["dark", "light"].includes(detectedColorScheme)
    ? detectedColorScheme
    : "unknown";
  const explicitTestEnvironment = Object.fromEntries(
    Object.entries(testOnlyEnvironment).map(([name, value]) => {
      if (!TEST_ONLY_ENVIRONMENT_NAMES.has(name)) throw new Error(`Unsupported test-only environment value: ${name}`);
      return [name, boundedEnvironmentValue(name, value)];
    }),
  );
  const childEnv = {
    ...inheritedEnvironment,
    QT_WEBUI_CALLER_CWD: boundedEnvironmentValue("QT_WEBUI_CALLER_CWD", path.resolve(cwd)),
    QT_WEBUI_QML_ENTRY: boundedEnvironmentValue("QT_WEBUI_QML_ENTRY", qmlEntry),
    QT_WEBUI_NODE_EXECUTABLE: boundedEnvironmentValue("QT_WEBUI_NODE_EXECUTABLE", nodeExecutable),
    QT_WEBUI_PI_CLI_ENTRY: boundedEnvironmentValue("QT_WEBUI_PI_CLI_ENTRY", piCliEntry),
    QT_WEBUI_DEVELOPMENT_MODE: development ? "1" : "0",
    QT_WEBUI_SYSTEM_COLOR_SCHEME: systemColorScheme,
    ...explicitTestEnvironment,
  };

  return {
    command: "quickshell",
    args: ["--path", qmlEntry],
    options: {
      cwd: path.resolve(cwd),
      env: childEnv,
      shell: false,
      stdio: "inherit",
    },
    development,
    piCliEntry,
    qmlEntry,
  };
}

export function launchQtWebUi({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  root = packageRoot,
  nodeExecutable = process.execPath,
  resolvePiEntry = resolvePiCliEntry,
  detectColorScheme = detectSystemColorScheme,
  spawnImpl = spawn,
  signalSource = process,
  testOnlyEnvironment = {},
} = {}) {
  const launch = prepareLaunch({
    argv,
    cwd,
    env,
    root,
    nodeExecutable,
    resolvePiEntry,
    detectColorScheme,
    testOnlyEnvironment,
  });

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const signalHandlers = new Map();

    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) signalSource.removeListener(signal, handler);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    try {
      child = spawnImpl(launch.command, launch.args, launch.options);
    } catch (error) {
      reject(new Error(`Could not start Quickshell. Install Quickshell 0.3 or newer and ensure 'quickshell' is on PATH (${error.message})`, { cause: error }));
      return;
    }

    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      };
      signalHandlers.set(signal, handler);
      signalSource.on(signal, handler);
    }

    child.once("error", (error) => {
      finish(() => reject(new Error(
        `Could not start Quickshell. Install Quickshell 0.3 or newer and ensure 'quickshell' is on PATH (${error.message})`,
        { cause: error },
      )));
    });
    child.once("close", (code, signal) => {
      finish(() => resolve(code ?? SIGNAL_EXIT_CODES.get(signal) ?? 1));
    });
  });
}
