# Development guide: Skills for Pi

Contributor-only implementation, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Resource lifecycle

The extension owns `/skills` in TUI mode. `@firstpick/pi-utils/scoped-resource-command` owns the shared Session, Global, and Model command flow, while `@firstpick/pi-utils/resource-management` resolves and stores profiles.

Skill names remain the stable selection identifiers. The extension passes source and description text through `getResourcePresentation()`. The shared selector renders that text for the selected skill and includes it in search without writing presentation data to saved profiles.

Candidate discovery covers standard user and project skill directories, configured Pi packages, and explicitly loaded skills when `--no-skills` or `-ns` disables normal discovery. Keep source presentation separate from discovery and enablement rules.

## Verification

Run `bun test` from this package after changing discovery, command ownership, source presentation, or invocation filtering. Shared selector behavior is covered by the `pi-utils` test suite.
