import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readResourceDefaults } from "../src/resource-management.mjs";
import { registerScopedResourceCommand } from "../src/scoped-resource-command.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-scoped-resource-command-"));
const previousSettingsFile = process.env.PI_WEBUI_SETTINGS_FILE;
process.env.PI_WEBUI_SETTINGS_FILE = path.join(root, "settings.json");

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function createUi(steps, notifications, visited = []) {
  return {
    async custom(factory) {
      const step = steps.shift();
      assert.ok(step, "unexpected custom setup screen");
      return await new Promise((done) => {
        const component = factory({ requestRender() {} }, theme, {}, done);
        const rendered = component.render(120).join("\n");
        assert.ok(rendered.includes(step.title), `expected ${step.title} screen, received:\n${rendered}`);
        for (const text of step.includes ?? []) {
          assert.ok(rendered.includes(text), `expected ${step.title} screen to include ${text}, received:\n${rendered}`);
        }
        visited.push(step.title);
        for (const input of step.inputs) component.handleInput(input);
      });
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  };
}

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
    getResourcePresentation: async () => [
      { name: "alpha", description: "npm:package-a: Alpha skill" },
      { name: "beta", description: "local: Beta skill" },
    ],
    getRuntimeNames: async () => ["alpha"],
    getEnabledNames: async () => ["alpha"],
    recompute: async () => {
      recomputes += 1;
      return true;
    },
  });

  const notifications = [];
  const context = (ui) => ({
    mode: "tui",
    model: { provider: "alpha", id: "model" },
    modelRegistry: {
      getAvailable: () => [{ provider: "alpha", id: "model", name: "Model" }],
    },
    ui,
  });

  const saveSteps = [
    { title: "Skills setup", inputs: ["\x1b[B", "\r"] },
    { title: "Global skills default", inputs: ["\r"] },
    {
      title: "Skills Configuration",
      includes: ["npm:package-a: Alpha skill"],
      inputs: ["\x1b[B", "\r", "\x13"],
    },
  ];
  await command.handler("", context(createUi(saveSteps, notifications)));

  assert.deepEqual(saveSteps, []);
  assert.deepEqual((await readResourceDefaults()).skills.enabledSkills, ["alpha", "beta"]);
  assert.equal(recomputes, 1);
  assert.deepEqual(notifications, [{ message: "Skills global default saved.", type: "info" }]);

  const navigationSteps = [
    { title: "Skills setup", inputs: ["\x1b[B", "\x1b[B", "\r"] },
    { title: "Skills Model Profile", inputs: ["\r"] },
    { title: "Skills for alpha/model", inputs: ["\x1b"] },
    { title: "Skills Model Profile", inputs: ["\x1b"] },
    { title: "Skills setup", inputs: ["\x1b[B", "\r"] },
    { title: "Global skills default", inputs: ["\x1b"] },
    { title: "Skills setup", inputs: ["\x1b[B", "\r"] },
    { title: "Global skills default", inputs: ["\r"] },
    { title: "Skills Configuration", inputs: ["\x1b"] },
    { title: "Global skills default", inputs: ["\r"] },
    { title: "Skills Configuration", inputs: ["\x13"] },
  ];
  const navigationVisited = [];
  await command.handler("", context(createUi(navigationSteps, notifications, navigationVisited)));

  assert.deepEqual(navigationSteps, []);
  assert.deepEqual(navigationVisited, [
    "Skills setup",
    "Skills Model Profile",
    "Skills for alpha/model",
    "Skills Model Profile",
    "Skills setup",
    "Global skills default",
    "Skills setup",
    "Global skills default",
    "Skills Configuration",
    "Global skills default",
    "Skills Configuration",
  ]);
  assert.equal(recomputes, 2, "saving after Back navigation should recompute once");

  const escapeSteps = [{ title: "Skills setup", inputs: ["\x1b"] }];
  await command.handler("", context(createUi(escapeSteps, notifications)));
  assert.deepEqual(escapeSteps, []);
  assert.equal(recomputes, 2, "Esc on the top-level screen should close without applying changes");

  const exitScenarios = [
    [{ title: "Skills setup", inputs: ["\x03"] }],
    [
      { title: "Skills setup", inputs: ["\x1b[B", "\r"] },
      { title: "Global skills default", inputs: ["\x03"] },
    ],
    [
      { title: "Skills setup", inputs: ["\x1b[B", "\x1b[B", "\r"] },
      { title: "Skills Model Profile", inputs: ["\x03"] },
    ],
    [
      { title: "Skills setup", inputs: ["\x1b[B", "\x1b[B", "\r"] },
      { title: "Skills Model Profile", inputs: ["\r"] },
      { title: "Skills for alpha/model", inputs: ["\x03"] },
    ],
    [
      { title: "Skills setup", inputs: ["\x1b[B", "\r"] },
      { title: "Global skills default", inputs: ["\r"] },
      { title: "Skills Configuration", inputs: ["\x03"] },
    ],
  ];

  for (const steps of exitScenarios) {
    await command.handler("", context(createUi(steps, notifications)));
    assert.deepEqual(steps, [], "Ctrl+C should close from the current screen without opening another one");
    assert.equal(recomputes, 2, "Ctrl+C should close without applying changes");
  }
} finally {
  if (previousSettingsFile === undefined) delete process.env.PI_WEBUI_SETTINGS_FILE;
  else process.env.PI_WEBUI_SETTINGS_FILE = previousSettingsFile;
  await rm(root, { recursive: true, force: true });
}

console.log("scoped-resource-command.test.mjs passed");
