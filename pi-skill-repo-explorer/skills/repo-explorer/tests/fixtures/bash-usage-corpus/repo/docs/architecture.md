# Architecture

The TypeScript controller creates sessions, the Python service persists tokens, and the Go router exposes health checks. CI calls the deterministic check script.
