import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createPiSession } from "../lib/backend/pi-session.mjs";

for (const count of [1, 5]) {
  test(`cancellation observers see committed dialog snapshots (${count} pending)`, async (t) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      exitCode: null, signalCode: null,
    });
    const cancelled = [];
    const session = createPiSession({
      nodeExecutable: "unused", piCliEntry: "unused", cwd: "/", env: {},
      spawnImpl: () => child,
      emit(type, payload) {
        if (type !== "extension.cancelled") return;
        // Exercise the synchronous observer, not a later hello after the loop finishes.
        const snapshot = session.snapshot();
        assert.equal(snapshot.pendingDialogs, 0);
        assert.deepEqual(snapshot.dialogs, []);
        cancelled.push(payload.requestId);
      },
    });
    t.after(async () => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
      await session.stop();
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
    });
    session.start();
    for (let i = 0; i < count; i++) {
      child.stdout.write(JSON.stringify({ type: "extension_ui_request", id: `dialog-${i}`, method: "input" }) + "\n");
    }
    assert.equal(session.snapshot().pendingDialogs, count);
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await session.stop();
    assert.deepEqual(cancelled, Array.from({ length: count }, (_, i) => `dialog-${i}`));
    assert.throws(() => session.answerDialog({ requestId: "dialog-0", cancelled: true }), { code: "stale_request" });
  });
}
