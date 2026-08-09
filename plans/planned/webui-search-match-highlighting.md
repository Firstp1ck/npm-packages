# WebUI search match highlighting

## Goal

Highlight every case-insensitive match while searching file contents, the main transcript, or a live subagent output stream, while retaining current-match navigation.

## Classification

Lightweight feature. The repository evidence shows one cohesive browser-only interaction slice in `public/app.js`, `public/index.html`, and `public/styles.css`, with focused static tests already covering file and transcript search. It does not add a backend contract, persistence, migration, security boundary, or rollout requirement. The parent will implement directly because this is one tightly coupled write outcome; delegation would not create two independent writer lanes.

## Scope and success criteria

- Render all matches and distinguish the current match.
- Keep Enter/Shift+Enter navigation and scrolling behavior.
- Search the active main transcript or active subagent terminal output, including refreshed streamed content.
- Preserve file editing and selection workflows; use a non-interactive source overlay and non-mutating CSS highlights for rendered DOM.
- Bound match collection using the existing 10,000-match limit.
- Update focused tests and user documentation.

## Checks

- `node tests/file-viewer-search-static.test.mjs`
- `node tests/mobile-static.test.mjs`
- Relevant new transcript/output search test, if separated.
- `npm run check`
- `git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'`

## Assumptions and residual risk

- The WebUI browser supports the CSS Custom Highlight API for exact DOM-range highlights; a class-based coarse fallback remains for older engines.
- Textarea source highlighting uses a synchronized visual overlay so the editable textarea and its selection semantics remain unchanged.

## Completion evidence

- Focused static tests passed: `search-match-highlighting-static`, `file-viewer-search-static`, and `git-panel-file-preview-static`.
- Chromium browser acceptance passed for three transcript matches, three editable source matches, current-match distinction, and synchronized source scrolling.
- JavaScript syntax and Markdown/source diff checks passed.
- `npm run check` completed 145 test files; 137 passed and 8 unrelated pre-existing contract/documentation tests failed. The feature-focused tests passed within that run.
