export class AgentSession {
    async setModel(model) {
        const previousModel = this.model;
        this.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
        const thinkingLevel = this.thinkingLevel;
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(model, previousModel, "set");
        this.settingsManager.setColorScheme("night");
    }

    async _cycleScopedModel(direction) {
        const currentModel = this.model;
        const next = { model: { provider: "scoped", id: direction } };
        this.model = next.model;
        this.sessionManager.appendModelChange(next.model.provider, next.model.id);
        this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
        const thinkingLevel = this.thinkingLevel;
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(next.model, currentModel, "cycle");
    }

    async _cycleAvailableModel(direction) {
        const currentModel = this.model;
        const nextModel = { provider: "available", id: direction };
        this.model = nextModel;
        this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
        this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
        const thinkingLevel = this.thinkingLevel;
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(nextModel, currentModel, "cycle");
    }

    setThinkingLevel(level) {
        const availableLevels = this.availableLevels;
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        if (this.thinkingLevel !== effectiveLevel) {
            this.thinkingLevel = effectiveLevel;
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            this._emit({ type: "thinking_level_changed", level: effectiveLevel });
            this.extensionRunner?.emit({
                type: "thinking_level_select",
                level: effectiveLevel,
            });
                this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
        }
    }
}
