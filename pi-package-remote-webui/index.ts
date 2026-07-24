import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detachChildProcess as releaseStartedChild, terminateChildProcess as terminateFailedChild } from "@firstpick/pi-utils/process";
import { truncate } from "@firstpick/pi-utils/text";
import {
  DEFAULT_PORT,
  REMOTE_CONTROLS_STATUS_KEY,
  REMOTE_WIDGET_KEY,
  RemoteWebuiController,
  buildRemoteControlsPayload,
  buildRemoteWidgetLines,
  closeRemoteWebui,
  formatStatus,
  generateQrLines,
  openRemoteWebui,
  parseRemoteArgs,
  remoteAuthQrUrl,
  requiresOpenConfirmation,
  usage,
} from "./lib/remote-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = __dirname;
const require = createRequire(import.meta.url);
const LOCAL_HOST = "127.0.0.1";

const OPEN_WARNING = [
  "Pi Web UI can control Pi/WebUI and run allowed tools from connected browsers.",
  "You will be asked whether to activate Remote PIN auth before the QR code is shown.",
  "",
  "Only open this on a trusted local network.",
  "",
  "Open to local network?",
].join("\n");

const AUTH_WARNING = [
  "Remote PIN auth is currently off.",
  "",
  "Activate it now? /remote will embed the generated PIN in the QR code so your phone can sign in without typing it.",
  "",
  "Choose No only on a trusted LAN where anyone with the URL may control Pi/WebUI.",
].join("\n");

type WebuiChild = ChildProcessByStdio<null, Readable, Readable>;

type RemoteOptions = {
  action: "open" | "status" | "close" | "refresh" | "auth";
  port: number;
  name?: string;
  yes: boolean;
  authEnabled?: boolean;
};

type RemoteNetworkStatus = {
  auth?: { enabled?: boolean; pin?: string };
  [key: string]: unknown;
};

function resolveExistingPath(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  return existsSync(candidate) ? candidate : undefined;
}

function resolveWebuiBin(): string {
  const candidates: Array<() => string | undefined> = [
    () => resolveExistingPath(require.resolve("@firstpick/pi-package-webui/bin/pi-webui.mjs")),
    () => resolveExistingPath(path.join(path.dirname(require.resolve("@firstpick/pi-package-webui/package.json")), "bin", "pi-webui.mjs")),
    () => resolveExistingPath(path.resolve(packageRoot, "..", "pi-package-webui", "bin", "pi-webui.mjs")),
  ];

  for (const candidate of candidates) {
    try {
      const resolved = candidate();
      if (resolved) return resolved;
    } catch {
      // Try next resolution strategy.
    }
  }

  throw new Error("Could not locate @firstpick/pi-package-webui/bin/pi-webui.mjs. Install @firstpick/pi-package-webui or run from the pi-coding-agent-forge checkout.");
}

function appendBoundedOutput(current: string, chunk: Buffer | string, maxChars = 20_000): string {
  const next = current + String(chunk);
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

async function spawnWebui(options: RemoteOptions, ctx: ExtensionCommandContext): Promise<void> {
  const webuiBin = resolveWebuiBin();
  const args = [webuiBin, "--host", LOCAL_HOST, "--port", String(options.port), "--cwd", ctx.cwd];
  if (options.name) args.push("--name", options.name);

  const child = spawn(process.execPath, args, {
    cwd: ctx.cwd,
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let output = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startedTimer);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) {
        terminateFailedChild(child);
        reject(error);
      } else {
        releaseStartedChild(child);
        resolve();
      }
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`Pi Web UI exited before startup (${code ?? signal ?? "unknown"}). Output:\n${output.trim() || "(no output)"}`));
    };

    child.stdout.on("data", (chunk) => {
      output = appendBoundedOutput(output, chunk);
    });
    child.stderr.on("data", (chunk) => {
      output = appendBoundedOutput(output, chunk);
    });
    child.once("error", onError);
    child.once("exit", onExit);

    // If the process survives this short preflight, the controller health poll
    // will perform the authoritative readiness check.
    const startedTimer = setTimeout(() => finish(), 250);
  });
}

function setRemoteStatus(ctx: ExtensionCommandContext, text?: string): void {
  ctx.ui.setStatus(REMOTE_WIDGET_KEY, text);
}

function configuredWebuiPort(): number {
  const parsed = Number.parseInt(String(process.env.PI_WEBUI_PORT || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

function publishRemoteControls(ctx: ExtensionContext, port = configuredWebuiPort()): void {
  if (ctx.mode !== "rpc") return;
  ctx.ui.setStatus(REMOTE_CONTROLS_STATUS_KEY, JSON.stringify(buildRemoteControlsPayload({ port })));
}

function clearRemoteControls(ctx: ExtensionContext): void {
  if (ctx.mode !== "rpc") return;
  ctx.ui.setStatus(REMOTE_CONTROLS_STATUS_KEY, undefined);
}

function clearRemoteWidget(ctx: ExtensionCommandContext): void {
  ctx.ui.setWidget(REMOTE_WIDGET_KEY, undefined);
}

function formatWidgetLine(line: string, width: number): string {
  if (width <= 0) return "";
  if (width === 1) return " ";
  return ` ${truncate(line, width - 1, { ellipsis: "", collapseWhitespace: false, trimEnd: false })}`;
}

function setFullRemoteWidget(ctx: ExtensionCommandContext, lines: string[]): void {
  if (ctx.mode !== "tui") {
    ctx.ui.setWidget(REMOTE_WIDGET_KEY, lines, { placement: "aboveEditor" });
    return;
  }

  const widgetLines = lines.map((line) => String(line ?? ""));
  ctx.ui.setWidget(
    REMOTE_WIDGET_KEY,
    () => ({
      render: (width: number) => widgetLines.map((line) => formatWidgetLine(line, width)),
      invalidate: () => {},
    }),
    { placement: "aboveEditor" },
  );
}

async function renderRemoteWidget(ctx: ExtensionCommandContext, result: { url: string; network?: unknown; started?: boolean }): Promise<void> {
  const qrUrl = remoteAuthQrUrl(result.url, result.network || {});
  const qrLines = await generateQrLines(qrUrl);
  const lines = buildRemoteWidgetLines({ url: result.url, qrUrl, qrLines, network: result.network, started: result.started });
  setFullRemoteWidget(ctx, lines);
  setRemoteStatus(ctx, `remote ${result.url}`);
}

async function confirmRemoteOpen(options: RemoteOptions, ctx: ExtensionCommandContext): Promise<boolean> {
  if (!requiresOpenConfirmation(options)) return true;
  if (!ctx.hasUI) throw new Error("/remote requires confirmation. Re-run with /remote --yes in non-interactive modes.");
  return await ctx.ui.confirm("Open Pi Web UI to LAN?", OPEN_WARNING);
}

function remoteAuthEnabled(network: unknown): boolean {
  return (network as RemoteNetworkStatus | undefined)?.auth?.enabled === true;
}

function networkFromAuthUpdate(previous: unknown, data: unknown): unknown {
  const update = data as { network?: unknown; auth?: unknown } | undefined;
  if (update?.network) return update.network;
  if (update?.auth && previous && typeof previous === "object") return { ...(previous as RemoteNetworkStatus), auth: update.auth };
  return previous;
}

async function maybeActivateRemoteAuth(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController, network: unknown): Promise<unknown> {
  if (remoteAuthEnabled(network)) return network;

  let activate = options.yes === true;
  if (!activate) {
    if (!ctx.hasUI) return network;
    activate = await ctx.ui.confirm("Activate Remote PIN auth?", AUTH_WARNING);
  }
  if (!activate) return network;

  setRemoteStatus(ctx, "enabling remote PIN auth…");
  const data = await controller.setRemoteAuth(options.port, true);
  return networkFromAuthUpdate(network, data);
}

async function handleStatus(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController): Promise<void> {
  setRemoteStatus(ctx, "checking remote webui…");
  try {
    const status = await controller.status(options.port);
    ctx.ui.notify(formatStatus(status), status.online ? "info" : "warning");
  } finally {
    setRemoteStatus(ctx, undefined);
  }
}

async function handleRefresh(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController): Promise<void> {
  setRemoteStatus(ctx, "refreshing remote QR…");
  try {
    const status = await controller.status(options.port);
    if (!status.online) {
      clearRemoteWidget(ctx);
      ctx.ui.notify(`${formatStatus(status)}\n\nRun /remote to start and open it.`, "warning");
      return;
    }
    if (!status.network?.open || !status.url || !/^https?:\/\//i.test(status.url)) {
      clearRemoteWidget(ctx);
      ctx.ui.notify(`${formatStatus(status)}\n\nRun /remote to open LAN access and show a QR code.`, "warning");
      return;
    }
    await renderRemoteWidget(ctx, { url: status.url, network: status.network, started: false });
    ctx.ui.notify(`Pi Remote WebUI QR refreshed:\n${status.url}`, "info");
  } finally {
    setRemoteStatus(ctx, undefined);
  }
}

async function handleClose(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController): Promise<void> {
  setRemoteStatus(ctx, "closing remote webui…");
  try {
    const result = await closeRemoteWebui(options, { controller });
    clearRemoteWidget(ctx);
    setRemoteStatus(ctx, undefined);
    if (!result.online) {
      ctx.ui.notify("Pi Web UI is not running; cleared the remote QR widget.", "warning");
      return;
    }
    ctx.ui.notify("Pi Web UI LAN access closed. The local Web UI server may keep running on localhost.", "info");
  } finally {
    setRemoteStatus(ctx, undefined);
  }
}

async function confirmRemoteAuthChange(options: RemoteOptions, ctx: ExtensionCommandContext): Promise<boolean> {
  if (options.yes === true) return true;
  if (!ctx.hasUI) throw new Error("/remote auth requires confirmation. Re-run with /remote auth on|off --yes in non-interactive modes.");
  const enabling = options.authEnabled === true;
  const message = enabling
    ? "Enable Remote PIN auth?\n\nA random 4-digit PIN will be required for non-local browser clients. /remote QR codes can embed the PIN for automatic mobile sign-in."
    : "Disable Remote PIN auth?\n\nNon-local browser clients will no longer need a PIN while LAN access is open. Only do this on a trusted local network.";
  return await ctx.ui.confirm(enabling ? "Enable Remote PIN auth?" : "Disable Remote PIN auth?", message);
}

async function handleAuth(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController): Promise<void> {
  if (options.authEnabled !== true && options.authEnabled !== false) throw new Error("/remote auth requires on or off");
  if (!(await confirmRemoteAuthChange(options, ctx))) {
    ctx.ui.notify("Remote PIN auth change cancelled.", "info");
    return;
  }

  setRemoteStatus(ctx, options.authEnabled ? "enabling remote PIN auth…" : "disabling remote PIN auth…");
  try {
    await controller.setRemoteAuth(options.port, options.authEnabled);
    const status = await controller.status(options.port);
    if (status.online && status.network?.open && status.url && /^https?:\/\//i.test(status.url)) {
      await renderRemoteWidget(ctx, { url: status.url, network: status.network, started: false });
    }
    ctx.ui.notify(formatStatus(status), status.online ? "info" : "warning");
  } finally {
    setRemoteStatus(ctx, undefined);
  }
}

async function handleOpen(options: RemoteOptions, ctx: ExtensionCommandContext, controller: RemoteWebuiController): Promise<void> {
  if (!(await confirmRemoteOpen(options, ctx))) {
    ctx.ui.notify("Remote WebUI cancelled; LAN access was not opened.", "info");
    return;
  }

  setRemoteStatus(ctx, "opening remote webui…");
  const result = await openRemoteWebui(options, {
    controller,
    startWebui: async (startOptions: RemoteOptions) => spawnWebui(startOptions, ctx),
    prepareNetwork: async (network: unknown) => maybeActivateRemoteAuth(options, ctx, controller, network),
  });
  await renderRemoteWidget(ctx, result);
  ctx.ui.notify(`Pi Remote WebUI ready:\n${result.url}\n\nScan the QR code above from your phone.`, "info");
}

export default function remoteWebuiExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    publishRemoteControls(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearRemoteControls(ctx);
  });

  pi.registerCommand("remote", {
    description: "Open Pi Web UI to a trusted LAN and show a mobile QR code",
    handler: async (args, ctx) => {
      let options: RemoteOptions;
      try {
        options = parseRemoteArgs(args) as RemoteOptions;
      } catch (error) {
        ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}\n${usage()}`, "error");
        return;
      }

      publishRemoteControls(ctx, options.port);
      const controller = new RemoteWebuiController();
      try {
        if (options.action === "status") {
          await handleStatus(options, ctx, controller);
          return;
        }
        if (options.action === "refresh") {
          await handleRefresh(options, ctx, controller);
          return;
        }
        if (options.action === "close") {
          await handleClose(options, ctx, controller);
          return;
        }
        if (options.action === "auth") {
          await handleAuth(options, ctx, controller);
          return;
        }
        await handleOpen(options, ctx, controller);
      } catch (error) {
        setRemoteStatus(ctx, undefined);
        ctx.ui.notify(`Pi Remote WebUI failed:\n${error instanceof Error ? error.message : String(error)}\n${usage()}`, "error");
      }
    },
  });
}
