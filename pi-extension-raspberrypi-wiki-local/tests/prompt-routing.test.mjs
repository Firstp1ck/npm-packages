import assert from "node:assert/strict";
import test from "node:test";
import { shouldRouteLocalWikiPrompt } from "../lib/prompt-routing.mjs";

const raspberryPiPrompt = /\b(raspberry\s*pi|raspberrypi|raspi|rpi|pico|rp2040|rp2350)\b/i;

test("does not route unrelated extension diagnostics", () => {
  assert.equal(shouldRouteLocalWikiPrompt("[Extension issues]", raspberryPiPrompt), false);
  assert.equal(shouldRouteLocalWikiPrompt("npm:@firstpick/pi-package-webui (user)", raspberryPiPrompt), false);
});

test("does not intercept its own missing-corpus diagnostic", () => {
  assert.equal(shouldRouteLocalWikiPrompt(
    "Local Raspberry Pi Documentation docs are not available at /tmp/docs. Run /raspberrypi-wiki-local-setup to set them up.",
    raspberryPiPrompt,
  ), false);
});

test("routes actual Raspberry Pi support prompts", () => {
  assert.equal(shouldRouteLocalWikiPrompt("How do I enable SSH on Raspberry Pi OS?", raspberryPiPrompt), true);
  assert.equal(shouldRouteLocalWikiPrompt("Configure Pico SDK for RP2350", raspberryPiPrompt), true);
});
