# Development guide: Safety Guard for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Auto-review protocol

The auto-review request contains only rule/category/risk metadata, the current working directory, and bounded command or path text from the pending tool input. It excludes conversation history, file contents, tool results, and credentials.

Calls use the configured authenticated model without tools, retries, or cache retention. The current bounds are a 20-second timeout and a 256-token output budget. The accepted response is one JSON object containing only `verdict` (`allow` or `block`) and a one-line reason of at most 512 characters. Authentication failure, timeout, malformed output, or any other invalid response falls back to the normal user confirmation prompt.

## Verification

Run the package test suite and dry-run the publish payload:

```bash
npm test
npm pack --dry-run --json
```
