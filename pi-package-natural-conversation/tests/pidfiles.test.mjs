import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pidFilePath, removePidFile, sweepStalePidFiles, voiceRuntimeDir, writePidFile } from "../lib/native-audio/pidfiles.mjs";

test("voiceRuntimeDir prefers XDG_RUNTIME_DIR", () => {
  assert.equal(voiceRuntimeDir({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/pi-voice");
  assert.ok(voiceRuntimeDir({}).endsWith("/pi-voice"));
});

test("write and remove pidfiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-pids-"));
  writePidFile(dir, 12345);
  assert.ok(existsSync(pidFilePath(dir, 12345)));
  removePidFile(dir, 12345);
  assert.ok(!existsSync(pidFilePath(dir, 12345)));
});

test("sweep kills live stale companions, clears dead ones, and spares reused pids", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-pids-"));
  writeFileSync(join(dir, "100.pid"), "native-audio-companion\n"); // live companion
  writeFileSync(join(dir, "200.pid"), "native-audio-companion\n"); // dead
  writeFileSync(join(dir, "300.pid"), "native-audio-companion\n"); // pid reused by another process
  writeFileSync(join(dir, "400.pid"), "native-audio-companion\n"); // ours — must be skipped
  writeFileSync(join(dir, "junk.txt"), "ignored");

  const signals = [];
  const result = sweepStalePidFiles(dir, {
    skipPids: [400],
    kill: (pid, signal) => {
      if (signal === 0) {
        if (pid === 200) throw new Error("ESRCH"); // dead
        return true;
      }
      signals.push({ pid, signal });
    },
    readCmdline: (pid) => (pid === 300 ? "/usr/bin/firefox" : `node /x/native-audio-companion.mjs (${pid})`),
  });

  assert.deepEqual(result.killed, [100]);
  assert.deepEqual(result.removed.sort(), [200, 300]);
  assert.deepEqual(signals, [{ pid: 100, signal: "SIGTERM" }]);
  assert.ok(!existsSync(join(dir, "100.pid")));
  assert.ok(!existsSync(join(dir, "200.pid")));
  assert.ok(!existsSync(join(dir, "300.pid")));
  assert.ok(existsSync(join(dir, "400.pid")), "our own pidfile must survive the sweep");
  assert.ok(existsSync(join(dir, "junk.txt")));
});
