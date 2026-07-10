---
description: Generate a PR description from template + actual branch diff, then save under dev/PR.
argument-hint: "[language: en|de]"
---
Create a PR description for the current branch in `${1:-en}` (`en` = English, `de` = German).

Required inputs:
- `@.github/PULL_REQUEST_TEMPLATE.md` (if present)
- diff/commits against the repository default branch (`main`, `master`, or upstream default)

Process:
1. Fill template sections with branch-specific facts.
2. Include what changed, why, risks, and test/verification notes.
3. Keep concise and reviewer-focused.

Save to:
- `dev/PR/<current-branch>.md`

Rules:
- Do not leave placeholder text unresolved.
- Do not claim tests were run unless verified.
- Use bullet points where possible.