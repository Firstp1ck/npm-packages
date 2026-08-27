import assert from "node:assert/strict";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { TuiResourceSelectorComponent } from "../lib/tui-resource-selector.mjs";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function createSelector(enabledResourceNames = ["alpha", "gamma"]) {
  const saved = [];
  let cancelled = 0;
  const selector = new TuiResourceSelectorComponent(
    {
      title: "Tools Configuration",
      subtitle: "Session only. Changes apply only after Ctrl+S.",
      resources: ["alpha", "beta", "gamma"],
      enabledResourceNames,
    },
    theme,
    {
      onSave: (selection) => saved.push(selection),
      onCancel: () => cancelled++,
    },
  );
  return { selector, saved, cancelled: () => cancelled };
}

setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

{
  const { selector, saved } = createSelector();
  selector.handleInput("\x1b[B");
  selector.handleInput("\r");
  assert.match(selector.render(100).join("\n"), /3\/3 enabled.*\(unsaved\)/);
  selector.handleInput("\x13");
  assert.deepEqual(saved, [["alpha", "beta", "gamma"]], "Ctrl+S should save the current explicit selection");
}

{
  const { selector, saved } = createSelector();
  selector.handleInput("b");
  selector.handleInput("e");
  assert.equal(selector.getSearchInput().getValue(), "be");
  assert.doesNotMatch(selector.render(100).join("\n"), /alpha/);

  selector.handleInput("\x18");
  selector.handleInput("\x13");
  assert.deepEqual(saved.at(-1), ["alpha", "gamma"], "Ctrl+X should clear only resources matching the active search");

  selector.handleInput("\x01");
  selector.handleInput("\x13");
  assert.deepEqual(saved.at(-1), ["alpha", "beta", "gamma"], "Ctrl+A should enable only resources matching the active search");
}

{
  const { selector, cancelled } = createSelector();
  selector.handleInput("z");
  selector.handleInput("z");
  assert.match(selector.render(100).join("\n"), /No matching resources/);
  selector.handleInput("\x03");
  assert.equal(selector.getSearchInput().getValue(), "", "Ctrl+C should clear a non-empty search before cancelling");
  assert.equal(cancelled(), 0);
  selector.handleInput("\x03");
  assert.equal(cancelled(), 1, "Ctrl+C on an empty search should cancel");
}

{
  const { selector, cancelled } = createSelector();
  selector.handleInput("\x1b");
  assert.equal(cancelled(), 1, "Escape should cancel without saving");
}

console.log("tui-resource-selector.test.mjs passed");
