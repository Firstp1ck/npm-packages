Pi Web UI startup failure
=========================
Time: 2026-08-05T19:06:15.238Z
Page: http://192.168.1.250:31415/
Reason: The WebUI entry module, one of its imports, or the critical stylesheet failed to load or evaluate.
Error: TypeError: Failed to fetch dynamically imported module: http://192.168.1.250:31415/app.js
Document state: complete
Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0

Diagnosis
---------
Summary: Missing startup module: /stream-output-controller.mjs (HTTP 404).
Likely cause: The backend is healthy, but the running server's static asset allowlist is out of sync with app.js.
Browser note: a transitive import failure may be reported as app.js; the individual probes below identify the actual failing file.

Failing checks
--------------
- imported module: HTTP 404 application/json — http://192.168.1.250:31415/stream-output-controller.mjs

All checks
----------
- backend health: HTTP 200 application/json (ok=true, webuiVersion=0.8.5) — http://192.168.1.250:31415/api/health
- entry module: HTTP 200 text/javascript — http://192.168.1.250:31415/app.js
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/aur-review-payload.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/guided-git-command-state.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/guided-git-review-state.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/fast-output-live.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/subagent-launch-slot-state.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/subagent-gate-visibility.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/workflow-status-stack.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/issue-wizard-state.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/issue-bot-client.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/mobile-shell-state.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/transcript-renderer.mjs
- imported module: HTTP 404 application/json — http://192.168.1.250:31415/stream-output-controller.mjs
- imported module: HTTP 200 text/javascript — http://192.168.1.250:31415/voice-conversation.mjs

Related browser checks
----------------------
- optional web manifest: HTTP 200 application/manifest+json — http://192.168.1.250:31415/manifest.webmanifest
- manifest impact: The optional web manifest is valid and is not the startup blocker.

Suggested troubleshooting
-------------------------
1. In Pi, run: /webui-status detailed
2. Check the backend: curl -i http://192.168.1.250:31415/api/health
3. Recheck the failing asset: curl -i http://192.168.1.250:31415/stream-output-controller.mjs
4. For an imported-module 404, synchronize the WebUI static allowlist and PWA app shell with app.js imports.
5. For a JavaScript syntax/evaluation error during development, finish or revert the incomplete edit and run the package syntax check before reloading.
6. After correcting files, run /webui-start again to restart the server and restore tabs.
7. Share this complete report with your troubleshooting assistant.