# @firstpick/pi-extension-feature-system-prompt

Classifies each Pi request and appends an external feature-development prompt only when the request is feature work.

## Install

```bash
pi install npm:@firstpick/pi-extension-feature-system-prompt
```

Pi discovers `feature-system-prompt.ts` through the package manifest.

## Behavior

Before the main agent starts, the extension first applies a conservative local fast path for explicit non-feature work and known short continuations. Ambiguous or potentially additive requests use an isolated, tool-free Pi session with the active conversation model. The classifier returns one exact request kind. The feature kinds are `feature_lightweight` and `feature_complex`; either appends a short complexity context followed by `APPEND_FEATURE.md`. Other successful classifications leave the system prompt unchanged.

The fast path recognizes only narrow bug, review, research, explanatory-question, and troubleshooting forms, and refuses prompts with additive capability signals. A narrow local continuation check resolves short, explicit follow-ups from the previous effective kind; when no prior kind exists, the active-model classifier remains authoritative. Session starts and tree navigation reset that in-memory continuation state.

In RPC mode only, the extension publishes the effective feature category with `ctx.ui.setStatus(FEATURE_CATEGORY_STATUS_KEY, value)`, where the exported key is `"feature-category"`. The only values are `"lightweight-feature"` and `"complex-feature"`; non-feature, unavailable, invalid, and reset states clear the status with `undefined`. This replayable status is presentation-neutral and does not change native TUI layout.

## Configuration and requirements

This package intentionally does not publish `APPEND_FEATURE.md`. Provide that file in Pi's configured agent directory with the feature workflow appropriate for your environment. Pi normally uses its standard agent directory; `PI_CODING_AGENT_DIR` can select a different agent directory when supported by Pi.

`APPEND_FEATURE.md` must be non-empty when a request is classified as feature work. Update the file and reload Pi to refresh the extension's cached copy.

## Security and privacy boundaries

- The local fast path receives only the current request and does not persist it. The model classifier receives only bounded current request text and, where applicable, bounded previous request text plus its effective classification. It does not receive the main system prompt, project files, prompt-file contents, tools, skills, or persistent classifier state.
- The nested classifier uses an in-memory Pi session, no tools, and a minimal resource loader to avoid recursive extension loading.
- Treat `APPEND_FEATURE.md` as trusted local configuration because it is appended to the main agent's system prompt.
- The extension does not persist classification telemetry or prompt text outside its in-memory turn/session state.

## Failure behavior and limitations

If no active model is available, the classifier fails, times out, or returns an invalid label, the extension appends a short local fallback instructing the main agent to classify feature work before acting. It does not load the external feature prompt for that fallback path.

If a request is successfully classified as feature work but `APPEND_FEATURE.md` is missing, unreadable, or empty, the extension appends a configuration-error fallback that directs the main agent not to implement feature work until the file is restored.

Classification is advisory routing, not an authorization system. The local fast path deliberately falls through on ambiguity or capability-addition signals; it cannot validate the correctness of local prompt policy, prevent a model from misclassifying a request, or enforce actions outside Pi's normal runtime controls.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The migrated deterministic tests cover taxonomy parsing, bounded classifier input, continuation state, feature injection, missing configuration, failure fallbacks, lifecycle resets, and inert registration.

## License

MIT
