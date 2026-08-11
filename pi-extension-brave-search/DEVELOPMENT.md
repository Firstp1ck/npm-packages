# Development guide: Brave Search for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Request scheduling

`brave_search` sends requests through one process-local FIFO queue. Each request holds the queue until the API attempt finishes and the 1.1-second spacing interval completes. Failed attempts also observe the interval, and a rejected request does not block later queued work.

Run the focused queue tests with:

```bash
npm test
```

## Example output

```text
brave_search "Brave Search API documentation" (2 results)
 1. Documentation - Brave Search API
 https://api-dashboard.search.brave.com/documentation
 Access billions of web pages with our core search API. Includes local results and rich content enhancements.

 2. Brave Search API | Brave
 https://brave.com/search/api/
 Enterprise-grade Web search API accessing an index of 40+ billion pages.
 Age: 1 month ago
```
