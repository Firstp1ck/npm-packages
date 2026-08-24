import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_DRIVES_PICKER_PATH,
  WINDOWS_DRIVE_DISCOVERY_MAX_OUTPUT,
  WINDOWS_DRIVE_DISCOVERY_TIMEOUT_MS,
  createWindowsDriveRootDiscovery,
  isWindowsDriveRoot,
  mergeWindowsDriveRoots,
  normalizeWindowsDriveRoot,
  parseWindowsDriveRoots,
  windowsDriveRootsFromKnownPaths,
  windowsDrivesPickerData,
} from "../lib/windows-drive-roots.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(normalizeWindowsDriveRoot("c:\\"), "C:\\");
assert.equal(normalizeWindowsDriveRoot("d:/"), "D:\\");
assert.equal(isWindowsDriveRoot("Z:\\"), true);
for (const invalid of ["C:", "C:project", "C:\\project", " C:\\", "C:\\\\", "\\\\server\\share\\", "/"] ) {
  assert.equal(normalizeWindowsDriveRoot(invalid), null, `${JSON.stringify(invalid)} must not be accepted as a drive root`);
}

assert.deepEqual(
  parseWindowsDriveRoots("D:\\\r\nc:/\r\ninvalid\r\nd:\\\r\n Z:\\\r\n"),
  ["C:\\", "D:\\"],
  "PowerShell output should be parsed strictly, normalized, deduplicated, and sorted",
);
assert.deepEqual(
  windowsDriveRootsFromKnownPaths(["d:\\project", "C:/Users/test", "e:", "e:relative", "/home/test", null]),
  ["C:\\", "D:\\", "E:\\"],
  "known absolute paths and system drive designators should provide fallback roots",
);
assert.deepEqual(mergeWindowsDriveRoots(["z:/", "C:\\"], ["c:/", "D:\\"]), ["C:\\", "D:\\", "Z:\\"]);

const virtualData = windowsDrivesPickerData(["D:\\", "c:/", "bad"], [{ label: "Tab", cwd: "C:\\repo" }]);
assert.deepEqual(virtualData, {
  cwd: "",
  displayCwd: "This PC",
  parent: null,
  roots: [{ label: "Tab", cwd: "C:\\repo" }],
  directories: [
    { name: "C:\\", cwd: "C:\\", displayCwd: "C:\\", hidden: false },
    { name: "D:\\", cwd: "D:\\", displayCwd: "D:\\", hidden: false },
  ],
  truncated: false,
  selectable: false,
});
assert.equal(WINDOWS_DRIVES_PICKER_PATH, "::pi-webui-windows-drives::");

let currentTime = 1_000;
const commandCalls = [];
const discover = createWindowsDriveRootDiscovery({
  now: () => currentTime,
  cacheTtlMs: 100,
  runCommand: async (...args) => {
    commandCalls.push(args);
    return { exitCode: 0, timedOut: false, stdoutTruncated: false, stdout: "D:\\\r\nC:/\r\nmalformed\r\n" };
  },
});

assert.deepEqual(await discover({ cwd: "C:\\repo", knownPaths: ["E:\\work"] }), ["C:\\", "D:\\", "E:\\"]);
assert.equal(commandCalls.length, 1);
assert.equal(commandCalls[0][0], "powershell.exe");
assert.deepEqual(commandCalls[0][1].slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
assert.match(commandCalls[0][1][4], /\[System\.IO\.DriveInfo\]::GetDrives\(\)/);
assert.match(commandCalls[0][1][4], /\.IsReady/);
assert.deepEqual(commandCalls[0][2], {
  cwd: "C:\\repo",
  timeoutMs: WINDOWS_DRIVE_DISCOVERY_TIMEOUT_MS,
  maxOutputLength: WINDOWS_DRIVE_DISCOVERY_MAX_OUTPUT,
  utf8Output: true,
});

assert.deepEqual(
  await discover({ cwd: "C:\\other", knownPaths: ["F:"] }),
  ["C:\\", "D:\\", "F:\\"],
  "cached discovery should merge fresh known roots without rerunning PowerShell",
);
assert.equal(commandCalls.length, 1);
currentTime += 101;
await discover({ cwd: "C:\\other" });
assert.equal(commandCalls.length, 2, "expired discovery should rerun PowerShell");

let releaseConcurrent;
let concurrentCalls = 0;
const concurrent = createWindowsDriveRootDiscovery({
  runCommand: async () => {
    concurrentCalls += 1;
    await new Promise((resolve) => { releaseConcurrent = resolve; });
    return { exitCode: 0, timedOut: false, stdoutTruncated: false, stdout: "G:\\\n" };
  },
});
const firstConcurrent = concurrent({ knownPaths: ["C:\\repo"] });
const secondConcurrent = concurrent({ knownPaths: ["D:\\repo"] });
releaseConcurrent();
assert.deepEqual(await firstConcurrent, ["C:\\", "G:\\"]);
assert.deepEqual(await secondConcurrent, ["D:\\", "G:\\"]);
assert.equal(concurrentCalls, 1, "concurrent picker requests should share one PowerShell process");

for (const failedResult of [
  { exitCode: 1, timedOut: false, stdout: "Z:\\\n" },
  { exitCode: undefined, timedOut: true, stdout: "Z:\\\n" },
  { exitCode: 0, timedOut: false, stdoutTruncated: true, stdout: "Z:\\\n" },
]) {
  const failedDiscovery = createWindowsDriveRootDiscovery({ runCommand: async () => failedResult });
  assert.deepEqual(await failedDiscovery({ knownPaths: ["C:\\repo", "D:"] }), ["C:\\", "D:\\"]);
}
const throwingDiscovery = createWindowsDriveRootDiscovery({ runCommand: async () => { throw new Error("unavailable"); } });
assert.deepEqual(await throwingDiscovery({ knownPaths: ["C:\\repo"] }), ["C:\\"]);

const serverSource = await readFile(join(root, "bin", "pi-webui.mjs"), "utf8");
assert.match(serverSource, /platform\(\) === "win32" && viewPath === WINDOWS_DRIVES_PICKER_PATH[\s\S]*return getWindowsDrivesPickerData\(activeCwd\)/, "the sentinel must be intercepted only on Windows before cwd resolution");
assert.match(serverSource, /platform\(\) === "win32" && isWindowsDriveRoot\(cwd\)[\s\S]*\? WINDOWS_DRIVES_PICKER_PATH/, "Windows drive roots should route Parent to the virtual picker");
assert.match(serverSource, /windowsDrivesPickerData\(driveRoots, pathPickerRoots\(activeCwd, activeCwd\)\)/, "the server should return the tested non-selectable virtual payload");
assert.match(
  serverSource,
  /function windowsDriveDiscoveryCwd\(\) \{[\s\S]*process\.env\.SystemRoot \|\| process\.env\.WINDIR \|\| path\.dirname\(process\.execPath\)[\s\S]*cwd: windowsDriveDiscoveryCwd\(\)/,
  "drive discovery should launch from a stable Windows system or executable directory rather than the active drive",
);
assert.doesNotMatch(
  serverSource,
  /discoverWindowsDriveRoots\(\{\s*cwd: activeCwd/,
  "a removable active cwd must not be used as the PowerShell process cwd",
);

console.log("windows-drive-roots.test.mjs passed");
