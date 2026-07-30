# @firstpick/pi-extension-feature-system-prompt

Classifies Pi requests and adds a short, fail-closed routing bridge to the enabled `feature-development-workflow` skill only for feature work.

## Install

```bash
pi install npm:@firstpick/pi-extension-feature-system-prompt
```

Pi discovers `feature-system-prompt.ts` through the package manifest. The `feature-development-workflow` skill must also be enabled.

## Behavior

Before the main agent starts, the extension first applies a conservative local fast path for explicit non-feature work and known short continuations. Ambiguous or potentially additive requests use an isolated, tool-free Pi session with the active conversation model. The classifier returns one exact request kind. The feature kinds are `feature_lightweight` and `feature_complex`; either appends a short complexity context and a mandatory bridge telling the parent to load the enabled `feature-development-workflow` skill with `read`. Other successful classifications leave the system prompt unchanged.

The bridge preserves progressive disclosure rather than duplicating the skill body. Before selecting the bridge, the extension resolves the advertised `<location>` for `feature-development-workflow` from `<available_skills>`, verifies that its `SKILL.md` is readable and non-empty, and—when classified complex—verifies that `references/COMPLEX-FEATURE-CONTRACT.md` beside it is also readable and non-empty. A failed availability check injects a configuration-error policy instead of the bridge.

The fast path recognizes only narrow bug, review, research, explanatory-question, and troubleshooting forms, and refuses prompts with additive capability signals. A narrow local continuation check resolves short, explicit follow-ups from the previous effective kind; when no prior kind exists, the active-model classifier remains authoritative. Session starts and tree navigation reset that in-memory continuation state.

In RPC mode only, the extension publishes the effective feature category with `ctx.ui.setStatus(FEATURE_CATEGORY_STATUS_KEY, value)`, where the exported key is `"feature-category"`. The only values are `"lightweight-feature"` and `"complex-feature"`; non-feature, unavailable, invalid, and reset states clear the status with `undefined`.

## Configuration and requirements

Enable `feature-development-workflow` through Pi settings or a package entry. The extension does not read an external feature prompt file and does not bundle a second copy of feature policy.

Reload Pi after changing the extension, skill, or settings so resource discovery and extension state are rebuilt.

## Security and privacy boundaries

- The local fast path receives only the current request and does not persist it.
- The model classifier receives only bounded current request text and, for a conservative continuation, bounded previous request text plus its effective classification.
- The nested classifier uses an in-memory Pi session, no tools, and a minimal resource loader to avoid recursive extension loading.
- The extension does not read the enabled skill during classification or send skill contents to the classifier.
- Classification telemetry and prompt text are not persisted by this extension.

## Failure behavior and limitations

If no active model is available, the classifier fails, times out, or returns an invalid label, the extension appends a short fallback telling the parent to classify from request and repository evidence, then load the feature skill only when applicable.

A successfully classified feature receives the bridge only after the availability check passes. If the enabled skill is missing from the current system prompt or a required file is unavailable, unreadable, or empty, the extension injects a configuration-error policy directing the parent not to implement the feature until configuration is restored.

The availability check is machine-enforced; following the loaded policy remains an agent instruction rather than an authorization system.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Tests cover taxonomy parsing, bounded classifier input, continuation state, feature-only bridge injection, fail-closed language, lifecycle resets, RPC status, and inert registration.

## License

MIT
