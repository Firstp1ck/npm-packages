import {
  exactModelProfile,
  preserveUnavailableResourceNames,
  readResourceDefaults,
  resolveResourceSelection,
  setExactModelProfile,
  updateResourceDefaults,
} from "./resource-management.mjs";
import { selectTuiModelProfile } from "./tui-model-profile-selector.mjs";
import { selectTuiResources } from "./tui-resource-selector.mjs";
import { selectTuiSetupOption } from "./tui-setup-option-selector.mjs";

function modelKey(model) {
  return model?.provider && model?.id ? `${model.provider}\0${model.id}` : "";
}

function availableModels(ctx) {
  return ctx.modelRegistry.getAvailable()
    .filter((model) => model?.provider && model?.id)
    .sort((left, right) => `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`));
}

export function registerScopedResourceCommand(pi, config) {
  const {
    commandName,
    resourceType,
    resourceLabel,
    selectionKey,
    customType,
    getVisibleNames,
    getResourcePresentation,
    getRuntimeNames,
    getEnabledNames,
    recompute,
  } = config;

  pi.registerCommand(commandName, {
    description: `Choose session, global, or exact-model ${resourceType}`,
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(`/${commandName} is available in interactive TUI mode only.`, "warning");
        return;
      }

      let screen = "scope";
      let scope;
      let defaults;
      let visibleNames = [];
      let resourcePresentation = [];
      let runtimeNames = [];
      let previousNames = null;
      let provider = "";
      let modelId = "";

      while (true) {
        if (screen === "scope") {
          scope = await selectTuiSetupOption(ctx, {
            title: `${resourceLabel} setup`,
            options: ["Session only", "Global default", "Model default"],
          });
          if (scope === null || !scope) return;
          defaults = await readResourceDefaults();
          visibleNames = await getVisibleNames(ctx);
          resourcePresentation = getResourcePresentation ? await getResourcePresentation(ctx) : [];
          runtimeNames = await getRuntimeNames(ctx);
          previousNames = null;
          provider = "";
          modelId = "";
          screen = scope === "Model default" ? "model" : "action";
          continue;
        }

        if (screen === "model") {
          const models = availableModels(ctx);
          if (!models.length) {
            ctx.ui.notify("No authenticated Pi models are available.", "warning");
            return;
          }
          const configuredModelKeys = (Array.isArray(defaults?.modelProfiles) ? defaults.modelProfiles : [])
            .filter((profile) => Array.isArray(profile?.[resourceType]?.[selectionKey]))
            .map((profile) => `${profile.provider}\0${profile.modelId}`);
          const model = await selectTuiModelProfile(ctx, {
            title: `${resourceLabel} Model Profile`,
            subtitle: "Choose a profile to edit. This does not switch the active model.",
            models,
            activeModelKey: modelKey(ctx.model),
            configuredModelKeys,
          });
          if (model === null) return;
          if (!model) {
            screen = "scope";
            continue;
          }
          provider = model.provider;
          modelId = model.id;
          screen = "action";
          continue;
        }

        if (screen === "action") {
          let action;
          if (scope === "Session only") {
            action = await selectTuiSetupOption(ctx, {
              title: `${resourceLabel} for this session`,
              options: ["Edit selection", "Use inherited defaults"],
            });
          } else if (scope === "Global default") {
            action = await selectTuiSetupOption(ctx, {
              title: `Global ${resourceLabel.toLowerCase()} default`,
              options: ["Edit selection", "Use Pi runtime default"],
            });
          } else {
            action = await selectTuiSetupOption(ctx, {
              title: `${resourceLabel} for ${provider}/${modelId}`,
              options: ["Edit selection", "Use inherited defaults"],
            });
          }

          if (action === null) return;
          if (!action) {
            screen = scope === "Model default" ? "model" : "scope";
            continue;
          }

          if (scope === "Session only") {
            if (action === "Use inherited defaults") {
              pi.appendEntry(customType, { version: 2, mode: "inherit" });
              await recompute(ctx);
              ctx.ui.notify(`${resourceLabel} now use inherited defaults.`, "info");
              return;
            }
            previousNames = await getEnabledNames(ctx);
          } else if (scope === "Global default") {
            if (action === "Use Pi runtime default") {
              await updateResourceDefaults((current) => ({
                ...current,
                [resourceType]: { ...current[resourceType], [selectionKey]: null },
              }));
              await recompute(ctx);
              ctx.ui.notify(`Global ${resourceLabel.toLowerCase()} default now inherits Pi runtime behavior.`, "info");
              return;
            }
            previousNames = defaults?.[resourceType]?.[selectionKey];
            if (previousNames === null) previousNames = resolveResourceSelection(defaults, resourceType, "", "", runtimeNames).names;
          } else {
            const profile = exactModelProfile(defaults, provider, modelId);
            previousNames = profile?.[resourceType]?.[selectionKey] ?? null;
            if (action === "Use inherited defaults") {
              await updateResourceDefaults((current) => ({
                ...current,
                modelProfiles: setExactModelProfile(current, provider, modelId, resourceType, null),
              }));
              await recompute(ctx);
              ctx.ui.notify(`${resourceLabel} for ${provider}/${modelId} now use inherited defaults.`, "info");
              return;
            }
            if (previousNames === null) {
              previousNames = resolveResourceSelection(defaults, resourceType, provider, modelId, runtimeNames).names;
            }
          }

          screen = "resources";
          continue;
        }

        const selectionTarget = scope === "Model default" ? `${provider}/${modelId} model profile` : scope;
        const selected = await selectTuiResources(ctx, {
          title: `${resourceLabel} Configuration`,
          subtitle: `${selectionTarget}. Changes apply only after Ctrl+S.`,
          resources: visibleNames,
          resourcePresentation,
          enabledResourceNames: previousNames || [],
        });
        if (selected === null) return;
        if (!selected) {
          screen = "action";
          continue;
        }

        if (scope === "Session only") {
          pi.appendEntry(customType, {
            version: 2,
            mode: "explicit",
            [selectionKey]: preserveUnavailableResourceNames(previousNames, visibleNames, selected),
          });
        } else if (scope === "Global default") {
          await updateResourceDefaults((current) => ({
            ...current,
            [resourceType]: {
              ...current[resourceType],
              [selectionKey]: preserveUnavailableResourceNames(current?.[resourceType]?.[selectionKey], visibleNames, selected),
            },
          }));
        } else {
          await updateResourceDefaults((current) => {
            const currentNames = exactModelProfile(current, provider, modelId)?.[resourceType]?.[selectionKey];
            return {
              ...current,
              modelProfiles: setExactModelProfile(
                current,
                provider,
                modelId,
                resourceType,
                preserveUnavailableResourceNames(currentNames, visibleNames, selected),
              ),
            };
          });
        }

        await recompute(ctx);
        ctx.ui.notify(`${resourceLabel} ${selectionTarget.toLowerCase()} saved.`, "info");
        return;
      }
    },
  });
}
