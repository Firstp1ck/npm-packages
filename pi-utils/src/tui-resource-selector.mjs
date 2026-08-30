import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, getKeybindings, Input, Key, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";

function keyMatches(data, keybinding, fallback) {
  const keybindings = getKeybindings();
  return keybindings.matches(data, keybinding) || matchesKey(data, fallback);
}

export class TuiResourceSelectorComponent extends Container {
  constructor(config, theme, callbacks) {
    super();
    this.resources = [...new Set(config.resources)];
    this.enabled = new Set(config.enabledResourceNames.filter((name) => this.resources.includes(name)));
    this.theme = theme;
    this.callbacks = callbacks;
    this.filteredResources = [...this.resources];
    this.selectedIndex = 0;
    this.maxVisible = 10;
    this.isDirty = false;
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
    const text = `  Enter toggle · Ctrl+A all · Ctrl+X clear · Ctrl+S save · ${this.enabled.size}/${this.resources.length} enabled`;
    return this.isDirty ? `${this.theme.fg("dim", text)} ${this.theme.fg("warning", "(unsaved)")}` : this.theme.fg("dim", text);
  }

  refresh() {
    const query = this.searchInput.getValue();
    this.filteredResources = query ? fuzzyFilter(this.resources, query, (name) => name) : [...this.resources];
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredResources.length - 1));
    this.updateList();
    this.footerText.setText(this.footer());
    this.callbacks.onRender?.();
  }

  updateList() {
    this.listContainer.clear();
    if (this.filteredResources.length === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching resources"), 0, 0));
      return;
    }

    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredResources.length - this.maxVisible),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredResources.length);
    for (let index = startIndex; index < endIndex; index++) {
      const name = this.filteredResources[index];
      const selected = index === this.selectedIndex;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const label = selected ? this.theme.fg("accent", name) : name;
      const status = this.enabled.has(name) ? this.theme.fg("success", " ✓") : this.theme.fg("dim", " ✗");
      this.listContainer.addChild(new Text(`${prefix}${label}${status}`, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredResources.length) {
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredResources.length})`), 0, 0),
      );
    }
  }

  setFilteredEnabled(enabled) {
    const targets = this.searchInput.getValue() ? this.filteredResources : this.resources;
    for (const name of targets) {
      if (enabled) this.enabled.add(name);
      else this.enabled.delete(name);
    }
    this.isDirty = true;
    this.refresh();
  }

  handleInput(data) {
    const keybindings = getKeybindings();

    if (keybindings.matches(data, "tui.select.up")) {
      if (this.filteredResources.length > 0) {
        this.selectedIndex = this.selectedIndex === 0 ? this.filteredResources.length - 1 : this.selectedIndex - 1;
        this.updateList();
        this.callbacks.onRender?.();
      }
      return;
    }
    if (keybindings.matches(data, "tui.select.down")) {
      if (this.filteredResources.length > 0) {
        this.selectedIndex = this.selectedIndex === this.filteredResources.length - 1 ? 0 : this.selectedIndex + 1;
        this.updateList();
        this.callbacks.onRender?.();
      }
      return;
    }
    if (keybindings.matches(data, "tui.select.confirm")) {
      const name = this.filteredResources[this.selectedIndex];
      if (name) {
        if (this.enabled.has(name)) this.enabled.delete(name);
        else this.enabled.add(name);
        this.isDirty = true;
        this.refresh();
      }
      return;
    }
    if (keyMatches(data, "app.models.enableAll", Key.ctrl("a"))) {
      this.setFilteredEnabled(true);
      return;
    }
    if (keyMatches(data, "app.models.clearAll", Key.ctrl("x"))) {
      this.setFilteredEnabled(false);
      return;
    }
    if (keyMatches(data, "app.models.save", Key.ctrl("s"))) {
      this.callbacks.onSave(this.resources.filter((name) => this.enabled.has(name)));
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

export async function selectTuiResources(ctx, config) {
  return await ctx.ui.custom((tui, theme, _keybindings, done) => new TuiResourceSelectorComponent(config, theme, {
    onSave: done,
    onCancel: () => done(undefined),
    onRender: () => tui.requestRender(),
  }));
}
