import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const sentinel = process.argv[2];
await delay(900);
await writeFile(sentinel, "orphaned descendant survived\n", "utf8");
