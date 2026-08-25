# Omarchy Plugin Marketplace publishing checklist

Use this reference only after the development workflow has a coherent plugin contract. It condenses the official [publishing guide](https://omarchyplugins.com/publish.html) (marked stable and updated 20 August 2026 when this reference was written). Re-check the live guide, issue form, and official Omarchy Quattro plugin reference before submission because requirements can change.

This checklist prepares evidence; it does not authorize external actions. Making a repository public, pushing commits, opening or submitting the Marketplace issue, and publishing are distinct external side effects. Stop before each action unless the user already authorized it or explicitly confirms it.

## 1. Freeze the candidate identity and contract

- [ ] The plugin uses a permanent namespace controlled by its author.
- [ ] A third-party ID does not begin with reserved `omarchy.*`.
- [ ] The same permanent ID appears in the manifest, QML module identity, routing/IPC identifiers, docs, and commands.
- [ ] Clone-only `omarchy.clonedFrom` metadata is gone.
- [ ] No upstream placeholder ID, author, repository URL, or description remains.
- [ ] Every declared plugin kind has its matching `entryPoints` key and ordinary in-repository QML file.
- [ ] A panel nested inside a bar widget remains an internal component unless it truly has a standalone `panel` contract.
- [ ] The version is the intended release value and no longer than the publishing guide's 64-character Marketplace display limit.

## 2. Review the entire repository as executable input

Plugins run unsandboxed with user permissions in the shared Omarchy shell. Marketplace validation checks listing structure, not plugin security.

- [ ] Review every tracked source file and asset, not only the manifest entry points.
- [ ] Review every dependency, imported module, executable, command, installer, service, privilege, file write, network call, and remote build.
- [ ] Remove unnecessary privileges and avoid opaque installation commands.
- [ ] Ensure no code starts or instructs users to start a second Quickshell process.
- [ ] Ensure bounded work and cleanup for timers, processes, sockets, file watchers, and subscriptions.
- [ ] Verify external input cannot become an unquoted or unvalidated shell command.
- [ ] Confirm no credentials, tokens, private data, local machine paths, build output, or editor state is tracked.
- [ ] Confirm the complete tree contains no symlinks. Marketplace plugin repositories cannot contain them.
- [ ] Confirm included code and assets have compatible provenance and licensing.

Useful local, read-only inspection includes:

```bash
git status --short
git ls-files
find . -type l -print
```

Any output from the symlink search is a blocker. Review ignored and untracked files separately when they could accidentally be committed later.

## 3. Prepare the repository root

The official publishing guide requires a public GitHub repository containing:

- [ ] a valid `manifest.json` at the repository root;
- [ ] the exact QML entry-point files and all nested code/assets they need;
- [ ] a README with purpose, requirements, dependency/setup disclosure, safe installation, use/configuration, troubleshooting, update notes where relevant, and safe removal;
- [ ] a license file covering the repository's distributable work;
- [ ] safe install and removal behavior that has been reviewed and, where authorized, tested;
- [ ] optionally, a representative preview image suitable for public display.

Do not make the repository public merely to satisfy this checklist. If visibility must change, present the consequence and obtain explicit confirmation first.

### Manifest readiness

Confirm the root manifest includes valid values for:

- `schemaVersion`;
- `id`;
- `name`;
- `version`;
- `author`;
- `description`;
- `kinds`;
- `entryPoints`;
- current kind-specific metadata required by the shell contract.

Every path must be a safe relative path with matching capitalization and must stay within the repository. The manifest, README, repository description, and actual behavior must describe the same plugin.

### README safety disclosure

The README should make risk discoverable before installation:

- state that the plugin runs unsandboxed with the user's permissions in the shared shell process;
- enumerate required dependencies, commands, permissions, services, installers, network access, and remote build behavior;
- explain what install/enable and removal change;
- provide commands only after they have been source-reviewed;
- never suggest launching another Quickshell process.

## 4. Validate the exact candidate commit

Run validation against the repository content intended for submission, not an older development folder:

- [ ] JSON parses.
- [ ] `omarchy plugin validate <candidate-folder>` passes when the tool is available.
- [ ] `qmllint` covers every entry point and relevant nested QML against the installed shell imports when available.
- [ ] The symlink search has no output.
- [ ] Kind/entry-point/path/case checks pass by direct inspection.
- [ ] Dependency and command review has no unresolved blocker.
- [ ] Authorized lifecycle checks cover relevant interaction, open/close, Escape, repeated use, disable/re-enable, shell restart, and removal.
- [ ] Git status and the commit ID identify exactly what was reviewed.
- [ ] Required checks not run are recorded as omissions, not passes.

Do not claim that structural validation proves the plugin is secure. Record residual unsandboxed-code risk even after all checks pass.

## 5. Prepare Marketplace submission material

Without opening or submitting anything, prepare:

- [ ] the public GitHub repository URL;
- [ ] the exact reviewed commit ID;
- [ ] an accurate category;
- [ ] concise relevant tags;
- [ ] an accurate name and description consistent with the manifest;
- [ ] any preview and user-facing dependency or privilege disclosure;
- [ ] a short validation summary and known limitations.

Automated Marketplace validation checks the current commit before maintainer approval. Re-run the live publishing requirements immediately before submission.

The official guide currently links this submission form:

```text
https://github.com/HANCORE-linux/omarchy-plugin-marketplace/issues/new?template=submit-plugin.yml
```

Treat the URL as current upstream data rather than a permanent API. Verify it against the live publishing guide before use, and do not open it when that would transmit data or create browser state unless the user has authorized that exact action.

## 6. Stop for explicit confirmation

Present the prepared material and evidence, then stop. If the user has not already authorized the exact next side effect, request explicit confirmation before:

1. creating a remote repository;
2. changing repository visibility to public;
3. pushing code or tags;
4. opening the Marketplace issue form if doing so transmits data or creates browser state;
5. submitting the Marketplace issue;
6. publishing any package or release.

Authorization for preparation is not authorization for submission. Authorization to open a form is not authorization to submit it. Report the resulting URL or submission state only after verified completion; never imply Marketplace approval from successful issue creation.

## Readiness result

Classify the candidate as one of:

- **Ready to request submission confirmation** — required files and checks pass, exact commit is identified, disclosures are complete, and residual risks are stated.
- **Conditionally ready** — environment-dependent checks are explicitly omitted, with a concrete pre-submission action list.
- **Not ready** — a manifest, symlink, identity, dependency, command, licensing, lifecycle, repository, or documentation blocker remains.

Always include the evidence supporting the classification and remind the user that plugin source remains their responsibility despite Marketplace validation.
