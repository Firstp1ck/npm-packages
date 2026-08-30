import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

export class TuiSetupOptionSelectorComponent extends Container {
  constructor(config, theme, callbacks) {
    super();
    this.callbacks = callbacks;

    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(config.title)), 0, 0));
    this.addChild(new Spacer(1));

    this.list = new SelectList(
      config.options.map((option) => ({ value: option, label: option })),
      Math.min(config.options.length, 10),
      {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    );
    this.list.onSelect = (item) => callbacks.onSelect(item.value);
    this.list.onCancel = callbacks.onBack;
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "  ↑/↓ navigate · Enter select · Esc Back · Ctrl+C Close"), 0, 0));
    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
  }

  handleInput(data) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.callbacks.onExit();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.callbacks.onBack();
      return;
    }

    this.list.handleInput(data);
    this.callbacks.onRender?.();
  }
}

export async function selectTuiSetupOption(ctx, config) {
  return await ctx.ui.custom((tui, theme, _keybindings, done) => new TuiSetupOptionSelectorComponent(config, theme, {
    onSelect: done,
    onBack: () => done(undefined),
    onExit: () => done(null),
    onRender: () => tui.requestRender(),
  }));
}
