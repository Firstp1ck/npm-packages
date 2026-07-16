import assert from "node:assert/strict";
import test from "node:test";
import { nativeExportDownloadPayload } from "../lib/native-export-payload.mjs";

const exportedPath = "/private/server/session-export.html";
const download = {
  fileName: "session-export.html",
  url: "/api/native-download/opaque-token",
  openUrl: "http://localhost/api/native-download/opaque-token?open=1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

test("localhost export responses include the absolute server path", () => {
  const payload = nativeExportDownloadPayload({ localRequest: true, exportedPath, download, responseData: { path: exportedPath } });
  assert.equal(payload.serverPath, exportedPath);
  assert.equal(payload.result.path, exportedPath);
  assert.match(payload.message, /Saved to: \/private\/server\/session-export\.html/);
});

test("remote no-path exports disclose only the opaque download response", () => {
  const payload = nativeExportDownloadPayload({ localRequest: false, exportedPath, download, responseData: { path: exportedPath } });
  assert.equal("serverPath" in payload, false);
  assert.equal("result" in payload, false);
  assert.doesNotMatch(payload.message, /private|serverPath|Saved to/);
  assert.equal(payload.download.url, "/api/native-download/opaque-token");
});
