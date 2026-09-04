import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startBackend } from "./helpers/backend-client.mjs";
import { bridgeHarness } from "./helpers/qml-functions.mjs";
import { LIMITS } from "../lib/backend/protocol.mjs";

test("three maximum-size attachments, bounded text reads, hello and selection fit real frames", async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", e => e.ready);
  assert((await b.send("hello", { attachmentMetadata: true })).ok);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(b.temporary, `large-${i}.txt`);
    await writeFile(file, (i === 2 ? "\u0001" : "x").repeat(LIMITS.maxTextAttachmentBytes));
    const result = await b.send("attachment_add", { path: file });
    assert(result.ok, JSON.stringify(result));
    assert.equal(result.data.attachment.text, undefined);
    ids.push(result.data.attachment.id);
  }
  const hello = await b.send("hello");
  assert.equal(hello.data.attachments.length, 3);
  const selected = await b.send("tab_select", { tab: hello.data.tabs.activeTab });
  assert(selected.ok);
  assert.equal(selected.data.attachments.length, 3);
  let offset = 0;
  let value = "";
  do {
    const result = await b.send("attachment_read", { attachmentId: ids[2], offset });
    assert(result.ok, JSON.stringify(result));
    assert(Buffer.byteLength(JSON.stringify(result) + "\n") < LIMITS.maxOutboundFrameBytes);
    value += result.data.text;
    offset = result.data.nextOffset;
  } while (offset !== null);
  assert.equal(value, "\u0001".repeat(LIMITS.maxTextAttachmentBytes));
  assert((await b.send("attachment_update", { attachmentId: ids[0], text: "edited" })).ok);
  assert((await b.send("attachment_remove", { attachmentId: ids[1] })).ok);
  assert((await b.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__", attachments: [ids[0], ids[2]] })).ok);
  assert.deepEqual((await b.send("hello")).data.attachments, []);
});

test("legacy protocol remains readable and rejects attachment growth before commit", async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", e => e.ready);
  const file = path.join(b.temporary, "legacy.txt");
  await writeFile(file, "original");
  const added = await b.send("attachment_add", { path: file });
  assert.equal(added.data.attachment.text, "original");
  await writeFile(file, "x".repeat(LIMITS.maxTextAttachmentBytes));
  const refused = await b.send("attachment_add", { path: file });
  assert.equal(refused.error.code, "limit_exceeded");
  assert.equal((await b.send("hello")).data.attachments.length, 1);
});

for (const unit of ["x", "é", "😀", '"', "\\", "\u0001"]) {
  test(`QML edit preflight agrees with UTF-8 framing for ${JSON.stringify(unit)}`, async () => {
    const payload = n => JSON.stringify({ v: 1, id: "q-1", type: "attachment_update", attachmentId: "id", text: unit.repeat(n), tab: "A" }) + "\n";
    let lo = 0, hi = LIMITS.maxInboundFrameBytes;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (Buffer.byteLength(payload(mid)) <= LIMITS.maxInboundFrameBytes) lo = mid; else hi = mid - 1; }
    for (const n of [lo - 1, lo, lo + 1]) {
      const { context: q, frames } = await bridgeHarness();
      let response;
      const id = q.updateAttachment("id", unit.repeat(n), result => { response = result; });
      assert.equal(q.utf8Bytes(payload(n)), Buffer.byteLength(payload(n)));
      assert.equal(Boolean(id), n <= lo);
      assert.equal(frames.length, n <= lo ? 1 : 0);
      if (n > lo) assert.equal(response.error.code, "limit_exceeded");
    }
  });
}
