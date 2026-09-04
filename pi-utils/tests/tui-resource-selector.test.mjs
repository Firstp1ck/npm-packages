import assert from "node:assert/strict";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { TuiResourceSelectorComponent } from "../src/tui-resource-selector.mjs";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function createSelector(enabledResourceNames = ["alpha", "gamma"], resourcePresentation = []) {
  const saved = [];
  let cancelled = 0;
  let exited = 0;
  const selector = new TuiResourceSelectorComponent(
    {
      title: "Tools Configuration",
      subtitle: "Session only. Changes apply only after Ctrl+S.",
      resources: ["alpha", "beta", "gamma"],
      resourcePresentation,
      enabledResourceNames,
    },
    theme,
    {
      onSave: (selection) => saved.push(selection),
      onCancel: () => cancelled++,
      onExit: () => exited++,
    },
  );
  return { selector, saved, cancelled: () => cancelled, exited: () => exited };
}

setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

{
  const { selector } = createSelector();
  const output = selector.render(100).join("\n");
  const alphaRow = selector.render(100).find((line) => line.includes("alpha"));
  const betaRow = selector.render(100).find((line) => line.includes("beta"));

  assert.match(output, /Ctrl\+X Disable all · Ctrl\+A Enable all · Ctrl\+S save · Esc Back · Ctrl\+C Close/);
  assert.doesNotMatch(output, /[✓✗]/);
  assert.match(alphaRow, /alpha\s{2}enabled/);
  assert.match(betaRow, /beta\s{3}disabled/);
  assert.equal(alphaRow.indexOf("enabled"), betaRow.indexOf("disabled"), "status values should share one column");
}

{
  const { selector } = createSelector(["alpha", "gamma"], [
    { name: "alpha", label: "alpha (Pi built-in)", description: "Pi built-in: Alpha tool" },
    { name: "beta", label: "beta (extension:sample)", description: "npm:sample: Beta tool" },
  ]);
  assert.match(selector.render(100).join("\n"), /alpha \(Pi built-in\).*enabled[\s\S]*Pi built-in: Alpha tool/);

  selector.handleInput("\x1b[B");
  assert.match(selector.render(100).join("\n"), /npm:sample: Beta tool/);
  assert.doesNotMatch(selector.render(100).join("\n"), /Pi built-in: Alpha tool/);

  selector.handleInput("n");
  selector.handleInput("p");
  selector.handleInput("m");
  assert.match(selector.render(100).join("\n"), /beta \(extension:sample\)/, "source and description text should be searchable");
}

{
  const { selector, saved } = createSelector();
  selector.handleInput("\x1b[B");
  selector.handleInput("\r");
  assert.match(selector.render(100).join("\n"), /3\/3 enabled[\s\S]*\(unsaved\)/);
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
  const { selector, cancelled, exited } = createSelector();
  selector.handleInput("z");
  selector.handleInput("z");
  assert.match(selector.render(100).join("\n"), /No matching resources/);
  selector.handleInput("\x03");
  assert.equal(selector.getSearchInput().getValue(), "zz", "Ctrl+C should close without clearing search first");
  assert.equal(cancelled(), 0);
  assert.equal(exited(), 1, "Ctrl+C should close the setup flow directly");
}

{
  const { selector, cancelled } = createSelector();
  selector.handleInput("\x1b");
  assert.equal(cancelled(), 1, "Escape should return without saving");
}

console.log("tui-resource-selector.test.mjs passed");
