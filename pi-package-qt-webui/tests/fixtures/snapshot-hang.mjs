// Trusted worker seam for deadline and queue tests. No filesystem or provider access.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
