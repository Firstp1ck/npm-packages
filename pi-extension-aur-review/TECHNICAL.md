# Technical reference: AUR Review for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Despite its historical name, AUR Review can review changes in any active Git repository.

## Commands

- `/aur-review` — start a review of current working-tree changes.
- `/aur-review start --scope staged --origin guided-git` — review exactly the staged changes used by Guided Git.
- `/aur-review refresh` — create a fresh review after corrections.
- `/aur-review status` — show whether the reviewed changes still match.
- `/aur-review approve` — approve the unchanged reviewed snapshot after confirmation.
- `/aur-review decline` — record review comments and request corrections.
- `/aur-review close` — close the review card without approving.

## Review snapshots

Approval is tied to the exact reviewed changes. Editing, staging, or replacing relevant files makes an earlier approval stale. Run `/aur-review refresh` after corrections.

Working-tree reviews include staged, unstaged, and relevant new files. Guided Git reviews include only the staged content that would move forward to commit-message generation.

Review records are stored privately under the Pi agent directory rather than inside the reviewed repository.

## Reports

You may attach repository-relative review reports. Report files must stay inside the repository, be regular files, and remain within the displayed size and count limits.

Browser review cards show report names and metadata but do not send report contents or diffs merely to render the card.

## Guided Git behavior

When the extension is enabled, Guided Git pauses after staging and opens a manual review step.

- **Review changes** opens the Git change view.
- **Approve** advances only when the staged content is unchanged.
- **Decline** returns to staging with the review comments.
- Corrected changes must be staged and reviewed again.

The review does not stage, commit, push, or approve changes automatically. If the extension is disabled, Guided Git uses its normal staging flow without this extra gate.

## Failure behavior

Malformed, stale, closed, declined, unrelated, or wrong-tab reviews never count as approval. Missing changes, changed reports, or unreadable files stop the review safely and require a fresh snapshot.
