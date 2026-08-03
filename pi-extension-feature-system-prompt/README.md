# @firstpick/pi-extension-feature-system-prompt

Classifies Pi requests and adds a short, fail-closed routing bridge to the enabled `feature-development-workflow` skill only for feature work.

## Install

```bash
pi install npm:@firstpick/pi-extension-feature-system-prompt
```

Pi discovers `feature-system-prompt.ts` through the package manifest. The `feature-development-workflow` skill must also be enabled.

## Behavior

Before the main agent starts, the extension first applies a conservative local fast path for explicit non-feature work and known short continuations. Ambiguous or potentially additive requests use an isolated, tool-free Pi session with the active conversation model. The classifier must return an exact JSON object with only `kind` and `reason`; `kind` is one exact request kind, while `reason` is normalized to one plain-text line and bounded to 500 characters. The feature kinds are `feature_lightweight` and `feature_complex`; either appends a short complexity context and a mandatory bridge telling the parent to load the enabled `feature-development-workflow` skill with `read`. Other successful classifications leave the system prompt unchanged.

The bridge preserves progressive disclosure rather than duplicating the skill body. Before selecting the bridge, the extension resolves the advertised `<location>` for `feature-development-workflow` from `<available_skills>`, verifies that its `SKILL.md` is readable and non-empty, and—when classified complex—verifies that `references/COMPLEX-FEATURE-CONTRACT.md` beside it is also readable and non-empty. A failed availability check injects a configuration-error policy instead of the bridge.

The fast path recognizes only narrow bug, review, research, explanatory-question, and troubleshooting forms, and refuses prompts with additive capability signals. A narrow local continuation check resolves short, explicit follow-ups from the previous effective kind; when no prior kind exists, the active-model classifier remains authoritative. Session starts and tree navigation reset that in-memory continuation state.

In RPC mode only, the extension publishes two replayable statuses. The existing `"feature-decision-output"` key carries versionless JSON such as `{"kind":"feature_complex","reason":"The request crosses the extension and UI contract."}`. The separate `"feature-category"` key remains exactly `"lightweight-feature"` or `"complex-feature"`. A consumer must require the category to match the structured decision kind; for rolling compatibility, it may also accept the legacy exact-label decision payloads `"feature_lightweight"` and `"feature_complex"` with a deterministic fallback reason. Non-feature, unavailable, invalid, and reset states clear both statuses with `undefined`. Known local continuations replay the prior structured feature decision, including its reason.

## Configuration and requirements

Enable `feature-development-workflow` through Pi settings or a package entry. The extension does not read an external feature prompt file and does not bundle a second copy of feature policy.

Reload Pi after changing the extension, skill, or settings so resource discovery and extension state are rebuilt.

## Security and privacy boundaries

- The local fast path receives only the current request and does not persist it.
- The model classifier receives only bounded current request text and, for a conservative continuation, bounded previous request text plus its effective classification.
- The nested classifier uses an in-memory Pi session, no tools, and a minimal resource loader to avoid recursive extension loading.
- The extension does not read the enabled skill during classification or send skill contents to the classifier.
- The untrusted classifier reason is used only in the serialized RPC status. It is never interpolated into the privileged system prompt; routing and injected complexity context use only the validated exact kind.
- Classification telemetry and prompt text are not persisted by this extension.

## Failure behavior and limitations

If no active model is available, the classifier fails, times out, or returns malformed structured output, the extension appends a short fallback telling the parent to classify from request and repository evidence, then load the feature skill only when applicable. JSON with an unknown kind, missing or extra fields, a non-string reason, or an empty normalized reason is invalid.

A successfully classified feature receives the bridge only after the availability check passes. If the enabled skill is missing from the current system prompt or a required file is unavailable, unreadable, or empty, the extension injects a configuration-error policy directing the parent not to implement the feature until configuration is restored.

The availability check is machine-enforced; following the loaded policy remains an agent instruction rather than an authorization system.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Tests cover taxonomy and strict decision parsing, bounded classifier input and reasons, continuation decision reuse, feature-only bridge injection without reason interpolation, fail-closed language, lifecycle resets, structured RPC statuses, and inert registration.

## License

MIT
