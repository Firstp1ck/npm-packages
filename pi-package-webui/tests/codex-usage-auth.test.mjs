import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_TOKEN_REFRESH_SKEW_MS, resolveCodexUsageAuth } from "../lib/codex-usage-auth.mjs";

function fakeRuntime(initial, refresh) {
  let credential = structuredClone(initial);
  let tail = Promise.resolve();
  const credentials = {
    async read() { return structuredClone(credential); },
    modify(_providerId, update) {
      const operation = tail.then(async () => {
        const next = await update(structuredClone(credential));
        if (next !== undefined) credential = structuredClone(next);
        return structuredClone(credential);
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
  return {
    credentials,
    getProvider() { return { auth: { oauth: { refresh } } }; },
    async getAuth() { throw new Error("OAuth tests must not use ordinary auth resolution"); },
  };
}

const NOW = 2_000_000_000_000;
const oauth = (access, expires) => ({ type: "oauth", access, refresh: "fake-refresh", expires, accountId: "acct_test" });

test("a 401 forces refresh of an otherwise unexpired Codex credential", async () => {
  let refreshCalls = 0;
  const runtime = fakeRuntime(oauth("rejected", NOW + 60 * 60 * 1000), async (current) => {
    refreshCalls += 1;
    return { ...current, access: "replacement", expires: NOW + 2 * 60 * 60 * 1000 };
  });
  const result = await resolveCodexUsageAuth(runtime, "openai-codex", { forceRefresh: true, now: NOW });
  assert.equal(refreshCalls, 1);
  assert.equal(result.accessToken, "replacement");
  assert.equal(result.refreshed, true);
});

test("Codex OAuth refresh uses the five-minute proactive skew", async () => {
  let refreshCalls = 0;
  const nearExpiry = fakeRuntime(oauth("near", NOW + CODEX_TOKEN_REFRESH_SKEW_MS - 1), async (current) => {
    refreshCalls += 1;
    return { ...current, access: "near-refreshed", expires: NOW + 60 * 60 * 1000 };
  });
  assert.equal((await resolveCodexUsageAuth(nearExpiry, "openai-codex", { now: NOW })).accessToken, "near-refreshed");
  assert.equal(refreshCalls, 1);

  const farExpiry = fakeRuntime(oauth("far", NOW + CODEX_TOKEN_REFRESH_SKEW_MS + 1), async () => {
    refreshCalls += 1;
    throw new Error("must not refresh");
  });
  assert.equal((await resolveCodexUsageAuth(farExpiry, "openai-codex", { now: NOW })).accessToken, "far");
  assert.equal(refreshCalls, 1);
});

test("forced refresh never returns the same rejected credential", async () => {
  const runtime = fakeRuntime(oauth("rejected", NOW + 60 * 60 * 1000), async (current) => ({ ...current }));
  await assert.rejects(
    resolveCodexUsageAuth(runtime, "openai-codex", { forceRefresh: true, now: NOW }),
    /rejected credential/,
  );
});
