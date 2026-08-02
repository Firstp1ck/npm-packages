import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatProviderUsage,
  parseAnthropicProviderUsage,
  parseCodexProviderUsage,
} from "../provider-usage.ts";

test("parses complete Codex usage with provider-reported windows, resets, and plan metadata", () => {
  assert.deepEqual(
    parseCodexProviderUsage({
      "x-codex-primary-used-percent": "12.5",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-at": "1760000000",
      "x-codex-primary-reset-after-seconds": "900",
      "x-codex-secondary-used-percent": "64",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-secondary-reset-at": "1760500000000",
      "x-codex-secondary-reset-after-seconds": "7200.5",
      "x-codex-plan-type": " plus ",
    }),
    {
      provider: "openai-codex",
      primary: {
        label: "5h",
        usedPercent: 12.5,
        windowMinutes: 300,
        resetAt: 1760000000000,
        resetAfterSeconds: 900,
      },
      secondary: {
        label: "weekly",
        usedPercent: 64,
        windowMinutes: 10080,
        resetAt: 1760500000000,
        resetAfterSeconds: 7200.5,
      },
      plan: "plus",
    },
  );
});

test("uses Codex window-minute metadata instead of assuming primary means 5h", () => {
  const usage = parseCodexProviderUsage({
    "x-codex-primary-used-percent": "29",
    "x-codex-primary-window-minutes": "10080",
    "x-codex-secondary-used-percent": "0",
    "x-codex-secondary-window-minutes": "10080",
  });
  assert.ok(usage);
  assert.equal(formatProviderUsage(usage), "weekly 29% · weekly 0%");
  assert.equal(usage.primary.windowMinutes, 10080);
  assert.equal(usage.secondary.windowMinutes, 10080);
});

test("parses complete Anthropic usage and normalizes fixed window labels and reset times", () => {
  assert.deepEqual(
    parseAnthropicProviderUsage({
      "anthropic-ratelimit-unified-5h-utilization": "0.125",
      "anthropic-ratelimit-unified-5h-reset": "2026-01-02T03:04:05.000Z",
      "anthropic-ratelimit-unified-7d-utilization": "1",
      "anthropic-ratelimit-unified-7d-reset": "1760000000",
    }),
    {
      provider: "anthropic",
      primary: {
        label: "5h",
        usedPercent: 12.5,
        windowMinutes: 300,
        resetAt: Date.parse("2026-01-02T03:04:05.000Z"),
      },
      secondary: {
        label: "7d",
        usedPercent: 100,
        windowMinutes: 10080,
        resetAt: 1760000000000,
      },
    },
  );
});

test("rejects absent or partial utilization headers", () => {
  assert.equal(parseCodexProviderUsage({}), undefined);
  assert.equal(parseCodexProviderUsage({ "x-codex-primary-used-percent": "10" }), undefined);
  assert.equal(parseCodexProviderUsage({ "x-codex-secondary-used-percent": "10" }), undefined);

  assert.equal(parseAnthropicProviderUsage({}), undefined);
  assert.equal(parseAnthropicProviderUsage({ "anthropic-ratelimit-unified-5h-utilization": "0.1" }), undefined);
  assert.equal(parseAnthropicProviderUsage({ "anthropic-ratelimit-unified-7d-utilization": "0.1" }), undefined);
});

test("rejects malformed and non-finite utilization", () => {
  for (const invalid of ["", " ", "not-a-number", "NaN", "Infinity", "-Infinity"]) {
    assert.equal(
      parseCodexProviderUsage({
        "x-codex-primary-used-percent": invalid,
        "x-codex-secondary-used-percent": "20",
      }),
      undefined,
      `Codex should reject ${JSON.stringify(invalid)}`,
    );
    assert.equal(
      parseAnthropicProviderUsage({
        "anthropic-ratelimit-unified-5h-utilization": "0.2",
        "anthropic-ratelimit-unified-7d-utilization": invalid,
      }),
      undefined,
      `Anthropic should reject ${JSON.stringify(invalid)}`,
    );
  }
});

test("accepts utilization boundaries and rejects values outside provider ranges", () => {
  assert.deepEqual(
    parseCodexProviderUsage({
      "x-codex-primary-used-percent": "0",
      "x-codex-secondary-used-percent": "100",
    }),
    {
      provider: "openai-codex",
      primary: { label: "primary", usedPercent: 0 },
      secondary: { label: "secondary", usedPercent: 100 },
    },
  );
  for (const invalid of ["-0.01", "100.01"]) {
    assert.equal(
      parseCodexProviderUsage({
        "x-codex-primary-used-percent": invalid,
        "x-codex-secondary-used-percent": "50",
      }),
      undefined,
    );
  }

  assert.deepEqual(
    parseAnthropicProviderUsage({
      "anthropic-ratelimit-unified-5h-utilization": "0",
      "anthropic-ratelimit-unified-7d-utilization": "1",
    }),
    {
      provider: "anthropic",
      primary: { label: "5h", usedPercent: 0, windowMinutes: 300 },
      secondary: { label: "7d", usedPercent: 100, windowMinutes: 10080 },
    },
  );
  for (const invalid of ["-0.001", "1.001"]) {
    assert.equal(
      parseAnthropicProviderUsage({
        "anthropic-ratelimit-unified-5h-utilization": "0.5",
        "anthropic-ratelimit-unified-7d-utilization": invalid,
      }),
      undefined,
    );
  }
});

test("ignores malformed optional Codex window/reset metadata without guessing labels", () => {
  assert.deepEqual(
    parseCodexProviderUsage({
      "x-codex-primary-used-percent": "10",
      "x-codex-primary-window-minutes": "nope",
      "x-codex-primary-reset-at": "never",
      "x-codex-primary-reset-after-seconds": "-1",
      "x-codex-secondary-used-percent": "20",
      "x-codex-secondary-window-minutes": "0",
      "x-codex-secondary-reset-at": "Infinity",
      "x-codex-secondary-reset-after-seconds": "nope",
      "x-codex-plan-type": "  ",
    }),
    {
      provider: "openai-codex",
      primary: { label: "primary", usedPercent: 10 },
      secondary: { label: "secondary", usedPercent: 20 },
    },
  );
});

test("formats compact used percentages from snapshot labels", () => {
  const usage = parseAnthropicProviderUsage({
    "anthropic-ratelimit-unified-5h-utilization": "0.125",
    "anthropic-ratelimit-unified-7d-utilization": "0.994",
  });
  assert.ok(usage);
  assert.equal(formatProviderUsage(usage), "5h 13% · 7d 99%");
});
