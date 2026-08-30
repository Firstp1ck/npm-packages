import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, getKeybindings, Input, Key, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";

function modelKey(model) {
  return `${model.provider}\0${model.id}`;
}

function modelSearchText(model) {
  return `${model.provider} ${model.id} ${model.name || ""}`;
}

export class TuiModelProfileSelectorComponent extends Container {
  constructor(config, theme, callbacks) {
    super();
    const seen = new Set();
    this.models = config.models.filter((model) => {
      if (!model?.provider || !model?.id) return false;
      const key = modelKey(model);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.activeModelKey = config.activeModelKey || "";
    this.configuredModelKeys = new Set(config.configuredModelKeys || []);
    this.theme = theme;
    this.callbacks = callbacks;
    this.filteredModels = [...this.models];
    const activeModel = this.models.find((model) => modelKey(model) === this.activeModelKey);
    const configuredModel = this.models.find((model) => this.configuredModelKeys.has(modelKey(model)));
    const initialKey = activeModel ? this.activeModelKey : configuredModel ? modelKey(configuredModel) : "";
    this.selectedIndex = Math.max(0, this.filteredModels.findIndex((model) => modelKey(model) === initialKey));
    this.lastQuery = "";
    this.maxVisible = 10;
    this._focused = false;

    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(config.title)), 0, 0));
    this.addChild(new Text(theme.fg("muted", config.subtitle), 0, 0));
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));

    this.footerText = new Text(this.footer(), 0, 0);
    this.addChild(this.footerText);
    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    this.refresh();
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  footer() {
    const position = this.filteredModels.length ? `${this.selectedIndex + 1}/${this.filteredModels.length}` : "0/0";
    return this.theme.fg("dim", `  ↑/↓ navigate · Enter select · Ctrl+C clear/cancel · Esc cancel · ${position}`);
  }

  refresh() {
    const selectedKey = this.filteredModels[this.selectedIndex] ? modelKey(this.filteredModels[this.selectedIndex]) : "";
    const query = this.searchInput.getValue();
    const queryChanged = query !== this.lastQuery;
    this.lastQuery = query;
    this.filteredModels = query ? fuzzyFilter(this.models, query, modelSearchText) : [...this.models];
    const retainedIndex = selectedKey
      ? this.filteredModels.findIndex((model) => modelKey(model) === selectedKey)
      : -1;
    this.selectedIndex = retainedIndex >= 0
      ? retainedIndex
      : queryChanged
        ? 0
        : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    this.updateList();
    this.footerText.setText(this.footer());
    this.callbacks.onRender?.();
  }

  updateList() {
    this.listContainer.clear();
    if (this.filteredModels.length === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching models"), 0, 0));
      return;
    }

    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredModels.length - this.maxVisible),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredModels.length);
    for (let index = startIndex; index < endIndex; index++) {
      const model = this.filteredModels[index];
      const key = modelKey(model);
      const selected = index === this.selectedIndex;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const id = selected ? this.theme.fg("accent", model.id) : model.id;
      const provider = this.theme.fg("muted", ` [${model.provider}]`);
      const active = key === this.activeModelKey ? this.theme.fg("success", " [active]") : "";
      const configured = this.configuredModelKeys.has(key) ? this.theme.fg("warning", " [profile]") : "";
      this.listContainer.addChild(new Text(`${prefix}${id}${provider}${active}${configured}`, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredModels.length) {
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`), 0, 0),
      );
    }

    const selectedModel = this.filteredModels[this.selectedIndex];
    if (selectedModel) {
      const profileState = this.configuredModelKeys.has(modelKey(selectedModel)) ? "configured" : "inherited";
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", `  Model Name: ${selectedModel.name || selectedModel.id} · Profile: ${profileState}`), 0, 0),
      );
    }
  }

  handleInput(data) {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.up")) {
      if (this.filteredModels.length > 0) {
        this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
        this.updateList();
        this.footerText.setText(this.footer());
        this.callbacks.onRender?.();
      }
      return;
    }
    if (keybindings.matches(data, "tui.select.down")) {
      if (this.filteredModels.length > 0) {
        this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
        this.updateList();
        this.footerText.setText(this.footer());
        this.callbacks.onRender?.();
      }
      return;
    }
    if (keybindings.matches(data, "tui.select.confirm")) {
      const model = this.filteredModels[this.selectedIndex];
      if (model) this.callbacks.onSelect(model);
      return;
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.refresh();
      } else {
        this.callbacks.onCancel();
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.callbacks.onCancel();
      return;
    }

    this.searchInput.handleInput(data);
    this.refresh();
  }

  getSearchInput() {
    return this.searchInput;
  }
}

export async function selectTuiModelProfile(ctx, config) {
  return await ctx.ui.custom((tui, theme, _keybindings, done) => new TuiModelProfileSelectorComponent(config, theme, {
    onSelect: done,
    onCancel: () => done(undefined),
    onRender: () => tui.requestRender(),
  }));
}
