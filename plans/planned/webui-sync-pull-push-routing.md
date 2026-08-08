# WebUI Sync Pull/Push Routing Correction

## Classification

Lightweight correction to the existing footer Sync action. One cohesive browser-side routing change restores previously supported behavior without new components or migrations.

## Outcome

- Incoming-only (`behind > 0`, `ahead = 0`): direct `git pull --ff-only origin`.
- Outgoing (`ahead > 0`), including diverged state: preserve the original confirmed push flow and its guarded `--force-with-lease` fallback.
- Sync states with neither count remain non-actionable.

## Compatibility

Keep the existing `webui-sync-push` visibility key and guarded API routes.

## Checks

- [x] `node --check public/app.js`
- [x] `node --check bin/pi-webui.mjs`
- [x] `node tests/mobile-static.test.mjs`
- [x] `git diff --check -- pi-package-webui`
- [x] Final diff reviewed.

## Completion

Implemented and verified on 2026-08-05. Incoming-only Sync routes to direct origin pull; outgoing and diverged Sync routes to the restored confirmed push/force-with-lease flow.
