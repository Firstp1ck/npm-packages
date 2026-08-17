import assert from "node:assert/strict";
import {
  NORMAL_STREAM_RENDER_INTERVAL_MS,
  createLatestWinsRenderScheduler,
} from "../public/stream-render-scheduler.mjs";

class FakeClock {
  nowMs = 0;
  next = 1;
  timers = new Map();

  now = () => this.nowMs;

  schedule = (callback, delay) => {
    const handle = this.next++;
    this.timers.set(handle, { callback, at: this.nowMs + delay });
    return handle;
  };

  cancel = (handle) => {
    this.timers.delete(handle);
  };

  advance(ms) {
    this.nowMs += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.nowMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) return;
      const [handle, timer] = due;
      this.timers.delete(handle);
      timer.callback();
    }
  }
}

assert.equal(NORMAL_STREAM_RENDER_INTERVAL_MS, 40, "the measured candidate cadence should remain inside the approved 32–50 ms range");

// First output is synchronous. Sustained writes are latest-wins and publish no
// more than once per 40 ms interval.
{
  const clock = new FakeClock();
  const rendered = [];
  const diagnostics = [];
  const scheduler = createLatestWinsRenderScheduler({
    render: (value, metadata) => rendered.push({ value, reason: metadata.reason, at: clock.nowMs }),
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    onDiagnostic: (record) => diagnostics.push(record),
  });

  assert.equal(scheduler.request("first"), true);
  assert.deepEqual(rendered, [{ value: "first", reason: "immediate", at: 0 }]);
  scheduler.request("second");
  scheduler.request("latest");
  assert.equal(scheduler.pending(), true);
  assert.equal(clock.timers.size, 1, "sustained requests should share one bounded timer");
  clock.advance(39);
  assert.equal(rendered.length, 1);
  clock.advance(1);
  assert.deepEqual(rendered[1], { value: "latest", reason: "cadence", at: 40 });
  assert.equal(scheduler.pending(), false);
  assert.equal(diagnostics.filter((record) => record.action === "defer").length, 1);
  assert.equal(diagnostics.filter((record) => record.action === "flush").length, 2);
}

// Semantic barriers synchronously publish the latest value and cancel the
// scheduled callback, so completion cannot be stranded or duplicated.
{
  const clock = new FakeClock();
  const rendered = [];
  const scheduler = createLatestWinsRenderScheduler({
    render: (value, metadata) => rendered.push(`${metadata.reason}:${value}`),
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  scheduler.request("visible-first");
  clock.advance(5);
  scheduler.request("partial");
  scheduler.request("authoritative-end");
  assert.equal(scheduler.flushNow("text_end"), true);
  assert.deepEqual(rendered, ["immediate:visible-first", "text_end:authoritative-end"]);
  assert.equal(clock.timers.size, 0);
  clock.advance(100);
  assert.equal(rendered.length, 2, "the canceled cadence callback must not duplicate completion");
}

// Cancellation resets first-output eligibility for a new stream and never
// publishes the canceled owner.
{
  const clock = new FakeClock();
  const rendered = [];
  const scheduler = createLatestWinsRenderScheduler({
    render: (value) => rendered.push(value),
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    intervalMs: 32,
  });
  scheduler.request("old-first");
  scheduler.request("old-pending");
  scheduler.cancel();
  assert.equal(scheduler.pending(), false);
  assert.equal(clock.timers.size, 0);
  scheduler.request("new-first");
  assert.deepEqual(rendered, ["old-first", "new-first"]);
}

assert.throws(() => createLatestWinsRenderScheduler(), /render is required/);
assert.throws(() => createLatestWinsRenderScheduler({ render() {}, intervalMs: 0 }), /positive number/);

console.log("stream-render-scheduler.test.mjs passed");
