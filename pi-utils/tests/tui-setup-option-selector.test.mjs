import assert from "node:assert/strict";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { TuiSetupOptionSelectorComponent } from "../src/tui-setup-option-selector.mjs";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function createSelector() {
  const selected = [];
  let backed = 0;
  let exited = 0;
  const selector = new TuiSetupOptionSelectorComponent(
    { title: "Skills setup", options: ["Session only", "Global default", "Model default"] },
    theme,
    {
      onSelect: (value) => selected.push(value),
      onBack: () => backed++,
      onExit: () => exited++,
    },
  );
  return { selector, selected, backed: () => backed, exited: () => exited };
}

setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

{
  const { selector, backed, exited } = createSelector();
  assert.match(selector.render(100).join("\n"), /Esc Back · Ctrl\+C Close/);
  selector.handleInput("\x1b");
  assert.equal(backed(), 1);
  assert.equal(exited(), 0);
}

{
  const { selector, backed, exited } = createSelector();
  selector.handleInput("\x03");
  assert.equal(backed(), 0);
  assert.equal(exited(), 1);
}

{
  const { selector, selected } = createSelector();
  selector.handleInput("\x1b[B");
  selector.handleInput("\r");
  assert.deepEqual(selected, ["Global default"]);
}

console.log("tui-setup-option-selector.test.mjs passed");
