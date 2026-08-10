# Harmonized Project README template — review draft

This is the proposed canonical template for the `project-readme` skill. First classify the repository as **user-oriented** or **developer/library-oriented**. User-oriented products, applications, tools, setup repositories, and installable packages use a short outcome-and-usage README with **no development or implementation information**. Libraries, SDKs, APIs, frameworks, and contributor-facing repositories use a separate developer/library profile. Retain a conditional section only when repository evidence makes it useful; remove the instructional comments from the finished README.

---

```markdown
# {{PROJECT_NAME}}

{{ONE_SENTENCE_OUTCOME: what this project is, who it helps, and the result it provides.}}

<!-- Optional trust strip: include only verified badges such as CI, release, package, platform, or license status. -->

<!-- User-oriented visual products: look for an existing Main Window image. If none exists, ask the user to provide or capture one, or explicitly choose to continue without it. Never invent, generate, or silently substitute an image. Omit this section only when the project has no meaningful visual interface or the user declines. -->
## Main Window

![Main window of {{PROJECT_NAME}}]({{MAIN_WINDOW_IMAGE_PATH}})

{{OPTIONAL_ONE_SENTENCE_CAPTION}}

## What you can do

- {{CAPABILITY_1}}
- {{CAPABILITY_2}}
- {{CAPABILITY_3}}

<!-- User-oriented visual products: identify two to four common user-visible features or workflows that can be shown clearly. If repository evidence does not establish them, ask the user to name the common visualizable features. Reuse verified repository images when available; when images are missing, request image paths or captures. Use descriptive alt text and short captions; omit empty placeholders when the user declines. -->
## Common feature previews

### {{COMMON_FEATURE_1}}

![{{DESCRIPTIVE_ALT_TEXT}}]({{FEATURE_IMAGE_PATH_1}})

{{SHORT_USER_OUTCOME_CAPTION}}

### {{COMMON_FEATURE_2}}

![{{DESCRIPTIVE_ALT_TEXT}}]({{FEATURE_IMAGE_PATH_2}})

{{SHORT_USER_OUTCOME_CAPTION}}

<!-- Conditional: use "Status" before setup when the project is experimental, incomplete, archived, or has an important migration state. -->

## Quick start

### Requirements

- {{RUNTIME_OR_PLATFORM_REQUIREMENT}}
- {{REQUIRED_TOOL_OR_SERVICE}}

### Install

```bash
{{PRIMARY_INSTALL_COMMAND}}
```

### Run

```bash
{{PRIMARY_RUN_COMMAND}}
```

{{FIRST_SUCCESS: tell the reader what to open, expect, or do to confirm the project works.}}

<!-- Conditional: add "How to use" when the first successful workflow needs more than the quick-start step. -->
## How to use

1. {{USER_STEP_1}}
2. {{USER_STEP_2}}
3. {{USER_STEP_3}}

<!-- Conditional: user-editable configuration only. Include before risky or confusing setup when users must configure files, environment variables, storage, credentials, privilege elevation, destructive operations, or privacy-sensitive behavior. Do not document internal endpoints, API calls, request/response data, schemas, or implementation configuration here. -->
## Configuration and data

| Setting | Required | Purpose |
| --- | --- | --- |
| `{{SETTING}}` | {{YES_OR_NO}} | {{PURPOSE}} |

{{WHERE_DATA_IS_STORED_AND_HOW_TO_BACK_IT_UP_OR_RESET_IT}}

<!-- Conditional: keep essential warnings prominent even when SECURITY.md or technical docs contain fuller detail. -->
## Safety and privacy

- {{IMPORTANT_SAFETY_OR_PRIVACY_BEHAVIOR}}
- {{SAFE_DEFAULT_OR_CONFIRMATION_BOUNDARY}}
- {{WHERE_TO_REPORT_A_SECURITY_ISSUE}}

<!-- Conditional: use when platform, architecture, language, or compatibility boundaries affect adoption. -->
## Compatibility

| Area | Supported |
| --- | --- |
| Platforms | {{PLATFORMS}} |
| Languages | {{LANGUAGES}} |
| Important limits | {{LIMITS}} |

<!-- Developer/library profile only. Never include this section in a user-oriented README. Avoid internal architecture dumps even in the developer/library profile. -->
## Technology

| Layer | Technology |
| --- | --- |
| {{LAYER}} | {{TECHNOLOGY}} |

<!-- Developer/library profile only. Omit from user-oriented product READMEs. Include only a short map of directories library users or contributors actually need. -->
## Project structure

```text
{{PATH}}/    {{PURPOSE}}
{{PATH}}/    {{PURPOSE}}
```

<!-- Developer/library profile only. Never include development setup, test commands, fixtures, benchmarks, source details, or contributor verification in a user-oriented README. Link to CONTRIBUTING.md or DEVELOPMENT.md instead. -->
## Development and verification

```bash
{{PRIMARY_CHECK_COMMAND}}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) or [DEVELOPMENT.md](DEVELOPMENT.md) for contributor setup and the full verification matrix.

<!-- Developer/library profile only. A user-oriented README may link to downloadable releases and explain how to install them, but must not contain source-build, packaging, publication, or release-maintenance instructions. -->
## Build and release

```bash
{{PRIMARY_BUILD_COMMAND}}
```

{{ARTIFACT_LOCATION_OR_RELEASE_LINK}}

<!-- Conditional: include evidence-backed fixes for likely first-run failures; link to longer troubleshooting docs when large. -->
## Troubleshooting

- **{{SYMPTOM}}:** {{CHECK_OR_FIX}}
- **{{SYMPTOM}}:** {{CHECK_OR_FIX}}

<!-- Conditional: keep short and current; prefer an issue tracker or roadmap document for long backlogs. -->
## Roadmap

See [the project roadmap]({{ROADMAP_LINK}}).

## Contributing and support

- Report bugs or request features: {{ISSUE_LINK}}
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reports: [SECURITY.md](SECURITY.md)

## License

{{LICENSE_SUMMARY}} See [LICENSE](LICENSE).

<!-- Conditional: credit upstream projects, data providers, sponsors, or generated assets when attribution is useful or required. -->
## Acknowledgments

- {{CREDIT_OR_ATTRIBUTION}}
```

## Ordering rule

Lead with outcome and capabilities, then the fastest successful path. Put configuration and warnings before readers encounter their effects. Place technical orientation and contributor material after normal usage. Finish with support, contribution, and legal information.

## Profile and adaptation rule

### User-oriented profile

Use for applications, desktop/web products, CLI/TUI tools, setup repositories, and packages whose main reader wants to install or use the result.

- Lead with outcome, a **Main Window** image, capabilities, representative common-feature images, quick start, first workflow, user-editable configuration, safety, troubleshooting, support, and license.
- Search existing repository assets and user-visible behavior first. When a Main Window image is missing, ask the user to provide an image path/capture or explicitly continue without it. When common visualizable features are missing or unclear, ask the user to name two to four; request image paths/captures for any feature without a verified image. Do not invent, generate, capture, or silently substitute visuals.
- Include only information needed to choose, install, configure, use, update, recover, or safely remove the product.
- **Do not include development or implementation information:** API calls or endpoints, request/response examples, schemas, architecture, technology stack, repository/source layout, internal algorithms, test commands or fixtures, benchmarks, contributor setup, source-build instructions, packaging/publication internals, or release-maintenance procedures.
- Link to `TECHNICAL.md`, `DEVELOPMENT.md`, `CONTRIBUTING.md`, a wiki, generated command help, or API documentation for deeper material. The root README may describe what a linked document contains without reproducing its technical content.

### Developer/library-oriented profile

Use for libraries, SDKs, APIs, frameworks, reusable modules, and repositories whose normal reader integrates or extends code.

- Prioritize install, a minimal working code example, supported runtimes, public API/documentation links, compatibility, verification, and license.
- Add concise technology or project-structure orientation only when it helps integration or contribution; still keep internal algorithms and exhaustive source maps in technical/contributor docs.

### Project-type refinements

- **CLI/TUI:** prioritize install, run, a short command/keyboard reference, configuration, safety, and troubleshooting.
- **System/configuration repository:** prioritize prerequisites, safe install, rollback, customization, and troubleshooting.
- **Early rewrite or prototype:** place status and limitations near the top; avoid feature claims not yet implemented.
- **Small internal tool:** omit ceremony, but keep requirements, run instructions, ownership/support, and safety notes when relevant.
