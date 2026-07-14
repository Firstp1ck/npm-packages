import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingCommandExcerpt } from "../src/excerpt.ts";

const rmRule = { pattern: /rm\s+-rf\b/i };

test("matched dangerous command and up to five following lines are preserved", () => {
  const command = [
    "echo before",
    "rm -rf build/output",
    "echo after 1",
    "echo after 2",
    "echo after 3",
    "echo after 4",
    "echo after 5",
    "echo after 6",
  ].join("\n");

  const excerpt = matchingCommandExcerpt(rmRule, command);

  assert.match(excerpt, /!!! 2 \| >>> rm -rf <<< build\/output/);
  for (let line = 1; line <= 5; line += 1) {
    assert.match(excerpt, new RegExp(`echo after ${line}`));
  }
  assert.doesNotMatch(excerpt, /echo before/);
  assert.doesNotMatch(excerpt, /echo after 6/);
});

test("long commands before the dangerous token are truncated without hiding the match", () => {
  const prefix = `echo ${"x".repeat(2_000)} && `;
  const command = `${prefix}rm -rf /tmp/demo\necho after`;

  const excerpt = matchingCommandExcerpt(rmRule, command);

  assert.match(excerpt, /!!! 1 \|/);
  assert.match(excerpt, />>> rm -rf <<</);
  assert.match(excerpt, /\/tmp\/demo/);
  assert.match(excerpt, /truncated \d+ chars before match/);
  assert.match(excerpt, /echo after/);
  assert.ok(excerpt.length < command.length, "expected excerpt to be shorter than the original command");
});

test("large following lines are individually truncated instead of truncating away the dangerous line", () => {
  const command = [
    "rm -rf ./danger",
    "echo short context",
    `echo ${"y".repeat(5_000)}`,
    "echo final context",
  ].join("\n");

  const excerpt = matchingCommandExcerpt(rmRule, command);

  assert.match(excerpt, /!!! 1 \| >>> rm -rf <<< \.\/danger/);
  assert.match(excerpt, /echo short context/);
  assert.match(excerpt, /echo final context/);
  assert.match(excerpt, /truncated \d+ chars/);
  assert.doesNotMatch(excerpt, /prompt display/);
});
