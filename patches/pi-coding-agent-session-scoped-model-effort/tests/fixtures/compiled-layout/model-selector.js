export class ModelSelector {
    handleSelect(model) {
        this.close();
        // Save as new default
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
        this.onSelectCallback(model);
        this.settingsManager.setColorScheme("night");
    }
}
