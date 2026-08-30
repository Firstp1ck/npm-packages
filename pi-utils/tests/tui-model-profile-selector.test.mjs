import assert from "node:assert/strict";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { TuiModelProfileSelectorComponent } from "../src/tui-model-profile-selector.mjs";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function createSelector(config) {
  const selected = [];
  let cancelled = 0;
  let exited = 0;
  const selector = new TuiModelProfileSelectorComponent(
    {
      title: "Tools Model Profile",
      subtitle: "Choose a profile to edit. This does not switch the active model.",
      configuredModelKeys: [],
      ...config,
    },
    theme,
    {
      onSelect: (model) => selected.push(model),
      onCancel: () => cancelled++,
      onExit: () => exited++,
    },
  );
  return { selector, selected, cancelled: () => cancelled, exited: () => exited };
}

setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

{
  const models = Array.from({ length: 15 }, (_, index) => ({
    provider: index % 2 === 0 ? "alpha" : "beta",
    id: `model-${String(index).padStart(2, "0")}`,
    name: `Model ${index}`,
  }));
  const active = models[12];
  const { selector, selected } = createSelector({
    models,
    activeModelKey: `${active.provider}\0${active.id}`,
    configuredModelKeys: [`${active.provider}\0${active.id}`],
  });
  const rendered = selector.render(120).join("\n");
  assert.match(rendered, /model-12 \[alpha\] \[active\] \[profile\]/, "the picker should open around the active model and mark configured profiles");
  assert.match(rendered, /Model Name: Model 12 · Profile: configured/);

  selector.handleInput("\x1b[B");
  selector.handleInput("\r");
  assert.equal(selected[0], models[13], "selection should return the exact model object rather than decoding its label");
}

{
  const models = Array.from({ length: 15 }, (_, index) => ({
    provider: "alpha",
    id: `model-${String(index).padStart(2, "0")}`,
    name: `Model ${index}`,
  }));
  const active = models[12];
  const { selector, selected } = createSelector({ models, activeModelKey: `${active.provider}\0${active.id}` });
  for (const character of "model-00") selector.handleInput(character);
  selector.handleInput("\r");
  assert.equal(selected[0], models[0], "a narrowing search should select its first match instead of retaining a stale list index");
}

{
  const models = [
    { provider: "alpha", id: "shared-a", name: "Shared Model" },
    { provider: "beta", id: "shared-b", name: "Shared Model" },
    { provider: "gamma", id: "other", name: "Other" },
  ];
  const { selector, selected } = createSelector({ models, activeModelKey: "" });
  for (const character of "beta") selector.handleInput(character);
  assert.equal(selector.getSearchInput().getValue(), "beta");
  assert.doesNotMatch(selector.render(100).join("\n"), /\[alpha\]/);
  selector.handleInput("\r");
  assert.equal(selected[0], models[1], "provider search should disambiguate models with the same display name");
}

{
  const { selector, cancelled, exited } = createSelector({
    models: [{ provider: "alpha", id: "one", name: "One" }],
    activeModelKey: "",
  });
  for (const character of "missing") selector.handleInput(character);
  assert.match(selector.render(100).join("\n"), /No matching models/);
  selector.handleInput("\x03");
  assert.equal(selector.getSearchInput().getValue(), "missing", "Ctrl+C should close without clearing search first");
  assert.equal(cancelled(), 0);
  assert.equal(exited(), 1, "Ctrl+C should close the setup flow directly");
}

{
  const { selector, cancelled } = createSelector({
    models: [{ provider: "alpha", id: "one", name: "One" }],
    activeModelKey: "",
  });
  assert.match(selector.render(100).join("\n"), /Esc Back · Ctrl\+C Close/);
  selector.handleInput("\x1b");
  assert.equal(cancelled(), 1, "Escape should return from model profile selection");
}

console.log("tui-model-profile-selector.test.mjs passed");
