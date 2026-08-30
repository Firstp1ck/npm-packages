import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readResourceDefaults } from "../src/resource-management.mjs";
import { registerScopedResourceCommand } from "../src/scoped-resource-command.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-scoped-resource-command-"));
const previousSettingsFile = process.env.PI_WEBUI_SETTINGS_FILE;
process.env.PI_WEBUI_SETTINGS_FILE = path.join(root, "settings.json");

try {
  let command;
  let recomputes = 0;
  const pi = {
    appendEntry() {},
    registerCommand(name, value) {
      assert.equal(name, "skills");
      command = value;
    },
  };
  registerScopedResourceCommand(pi, {
    commandName: "skills",
    resourceType: "skills",
    resourceLabel: "Skills",
    selectionKey: "enabledSkills",
    customType: "webui-skills-config",
    getVisibleNames: async () => ["alpha", "beta"],
    getRuntimeNames: async () => ["alpha"],
    getEnabledNames: async () => ["alpha"],
    recompute: async () => {
      recomputes += 1;
      return true;
    },
  });

  const choices = ["Global default", "Edit selection"];
  const notifications = [];
  await command.handler("", {
    mode: "tui",
    model: undefined,
    ui: {
      async select() {
        return choices.shift();
      },
      async custom(factory) {
        return await new Promise((done) => {
          const component = factory(
            { requestRender() {} },
            { fg: (_color, text) => text, bold: (text) => text },
            {},
            done,
          );
          component.handleInput("\x1b[B");
          component.handleInput("\r");
          component.handleInput("\x13");
        });
      },
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  });

  assert.deepEqual((await readResourceDefaults()).skills.enabledSkills, ["alpha", "beta"]);
  assert.equal(recomputes, 1);
  assert.deepEqual(notifications, [{ message: "Skills global default saved.", type: "info" }]);
} finally {
  if (previousSettingsFile === undefined) delete process.env.PI_WEBUI_SETTINGS_FILE;
  else process.env.PI_WEBUI_SETTINGS_FILE = previousSettingsFile;
  await rm(root, { recursive: true, force: true });
}

console.log("scoped-resource-command.test.mjs passed");
