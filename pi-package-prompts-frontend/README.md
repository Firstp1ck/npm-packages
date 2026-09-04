# Frontend design prompts for Pi

Adds reusable prompts for building and comparing frontend page concepts in an existing project.

## What you can do

- Build several page directions side by side instead of settling on the first draft.
- Compare each concept at a predictable route.
- Reuse the frontend stack and design conventions already in the project.
- Require responsive, accessible, and working implementations.

## Install

```bash
pi install npm:@firstpick/pi-prompts-frontend
```

Restart Pi if the prompt does not appear in your current session.

## How to use it

Open the frontend project you want Pi to edit, then run:

```text
/land-page
```

The prompt creates five landing-page concepts for a second-brain note-taking app at `/1` through `/5`. Each page includes a compact control for switching between concepts.

You can add brand, stack, or style context after the command:

```text
/land-page Use the existing Next.js app and the warm neutral colors in our brand guide.
```

Pi inspects the project before editing it and uses the routing conventions it finds.

## Before you start

The command edits the current frontend project. Commit or stash work you need to protect, and review the five routes before choosing a direction.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-prompts-frontend/TECHNICAL.md) for command behavior, compatibility, and troubleshooting.
