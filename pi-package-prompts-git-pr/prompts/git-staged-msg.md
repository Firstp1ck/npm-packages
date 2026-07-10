---
description: Generate short + long conventional commit messages from staged diff and save both files.
argument-hint: "[language: en|de] [scope: auto|never|required]"
---
Create commit messages for the **currently staged files only**.

Preferences supplied by the caller:
- Output language: `${1:-en}` (`en` = English, `de` = German).
- Conventional Commit scope policy: `${2:-auto}`.
  - `auto`: include a concise scope only when the staged work has one clear component.
  - `never`: use `<type>: <summary>` without a scope.
  - `required`: always choose a concise lowercase scope and use `<type>(<scope>): <summary>`.

Process:
1. Inspect staged diff only (`git diff --cached`).
2. Choose the best primary type from:
   `fix|feat|change|perf|test|chore|refactor|docs|style|build|ci|revert`
3. Produce in the requested language:
   - one short subject line (single line)
   - one long commit message (subject + typed bullet list)

Write exactly these files (create directory if missing):
- `dev/COMMIT/staged-commit-short.txt`
- `dev/COMMIT/staged-commit-long.txt`

Required content format:

`staged-commit-short.txt`
```text
<type>[(<scope>)]: <short summary>
```

`staged-commit-long.txt`
```text
<type>[(<scope>)]: <short summary>
- <type>: <change 1>
- <type>: <change 2>
```

Rules:
- Imperative mood
- Subject <= 72 chars
- Bullet points must describe only staged hunks
- No unstaged/unrelated changes
- No code fences or extra prose in either output file
