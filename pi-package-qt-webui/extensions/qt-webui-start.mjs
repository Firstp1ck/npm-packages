import { spawn } from "node:child_process";
import { prepareLaunch } from "../lib/launcher.mjs";

export function launchQtWebUiDetached({
  cwd,
  spawnImpl = spawn,
  prepareLaunchImpl = prepareLaunch,
} = {}) {
  const launch = prepareLaunchImpl({ cwd });

  return new Promise((resolve, reject) => {
    const child = spawnImpl(launch.command, launch.args, {
      ...launch.options,
      detached: true,
      shell: false,
      stdio: "ignore",
    });

    const onError = (error) => reject(error);
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

export function registerQtWebUiStartCommand(pi, { launch = launchQtWebUiDetached } = {}) {
  pi.registerCommand("qt-webui-start", {
    description: "Start Qt WebUI for the current working directory",
    handler: async (args, ctx) => {
      if (args.trim().length > 0) {
        ctx.ui.notify("Usage: /qt-webui-start", "warning");
        return;
      }

      try {
        await launch({ cwd: ctx.cwd });
        ctx.ui.notify(`Started Qt WebUI for ${ctx.cwd}`, "info");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not start Qt WebUI: ${detail.slice(0, 512)}`, "error");
      }
    },
  });
}

export default function qtWebUiStartExtension(pi) {
  registerQtWebUiStartCommand(pi);
}
