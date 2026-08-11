export type WaitForInterval = (milliseconds: number) => Promise<void>;

export function createSerialRequestQueue(intervalMs: number, wait: WaitForInterval) {
	let tail: Promise<void> = Promise.resolve();

	return function enqueue<T>(request: () => Promise<T>): Promise<T> {
		const run = tail.then(async () => {
			try {
				return await request();
			} finally {
				await wait(intervalMs);
			}
		});

		tail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	};
}
