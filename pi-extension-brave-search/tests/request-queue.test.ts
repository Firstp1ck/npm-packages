import assert from "node:assert/strict";
import test from "node:test";
import { createSerialRequestQueue } from "../request-queue.ts";

function nextTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

test("serializes overlapping requests and waits between them", async () => {
	const waitResolvers: Array<() => void> = [];
	const waits: number[] = [];
	const starts: number[] = [];
	let active = 0;
	let maxActive = 0;
	const requestResolvers: Array<() => void> = [];
	const enqueue = createSerialRequestQueue(1_100, async (milliseconds) => {
		waits.push(milliseconds);
		await new Promise<void>((resolve) => waitResolvers.push(resolve));
	});

	const requests = [1, 2, 3].map((id) =>
		enqueue(async () => {
			starts.push(id);
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise<void>((resolve) => requestResolvers.push(resolve));
			active -= 1;
			return id;
		})
	);

	await nextTurn();
	assert.deepEqual(starts, [1]);
	requestResolvers.shift()?.();
	await nextTurn();
	assert.deepEqual(starts, [1], "the next request must wait for the spacing interval");
	assert.deepEqual(waits, [1_100]);

	waitResolvers.shift()?.();
	await nextTurn();
	assert.deepEqual(starts, [1, 2]);
	requestResolvers.shift()?.();
	await nextTurn();
	waitResolvers.shift()?.();
	await nextTurn();
	assert.deepEqual(starts, [1, 2, 3]);
	requestResolvers.shift()?.();
	await nextTurn();
	waitResolvers.shift()?.();

	assert.deepEqual(await Promise.all(requests), [1, 2, 3]);
	assert.equal(maxActive, 1);
	assert.deepEqual(waits, [1_100, 1_100, 1_100]);
});

test("continues the queue after a failed request", async () => {
	const starts: string[] = [];
	const enqueue = createSerialRequestQueue(1_100, async () => {});
	const failed = enqueue(async () => {
		starts.push("failed");
		throw new Error("request failed");
	});
	const succeeded = enqueue(async () => {
		starts.push("succeeded");
		return "ok";
	});

	await assert.rejects(failed, /request failed/);
	assert.equal(await succeeded, "ok");
	assert.deepEqual(starts, ["failed", "succeeded"]);
});
