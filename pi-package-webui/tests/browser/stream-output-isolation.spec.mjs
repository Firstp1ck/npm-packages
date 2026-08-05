import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const deltaCount = 1_000;
const expectedIndexes = Array.from({ length: deltaCount }, (_, index) => index);
const expectedFinalText = expectedIndexes.map((index) => {
  const digit = String(index % 10);
  if (index === 0) return `ISOLATION-TEXT-BEGIN ${digit}`;
  if (index === deltaCount - 1) return `${digit} ISOLATION-TEXT-TAIL`;
  return digit;
}).join("");

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let child;
let baseURL;
let tempRoot;
let logRoot;
let logFile;
let output = "";

async function serverApi(pathname, { method = "GET", data } = {}) {
  const response = await fetch(`${baseURL}${pathname}`, {
    method,
    headers: data === undefined ? undefined : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${method} ${pathname} should succeed: ${payload.error || output}`);
  return payload;
}

async function activeTabId(page) {
  return page.locator("#tabBar [role=\"tab\"][aria-selected=\"true\"]").evaluate((node) => node.closest("[data-tab-id]")?.dataset.tabId || "");
}

async function fixtureLogEntries(runId) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* Ignore only the concurrently appended trailing row. */ }
  }
  return entries.filter((entry) => entry.isolationRunId === runId);
}

async function waitForFixtureLog(runId, predicate) {
  let matching = [];
  await expect.poll(async () => {
    matching = await fixtureLogEntries(runId);
    return predicate(matching);
  }).toBe(true);
  return matching;
}

async function waitForPhase(runId, phase) {
  return waitForFixtureLog(runId, (entries) => entries.some((entry) => entry.direction === "isolation-phase" && entry.isolationPhase === phase));
}

async function assertFixtureContract(runId, mode, scenario = "standard") {
  const entries = await waitForPhase(runId, scenario === "abort" ? "abort-ready" : "settled");
  const textDeltas = entries.filter((entry) => entry.isolationPhase === "raw" && entry.type === "message_update" && entry.assistantMessageEventType === "text_delta");
  const expectedCount = scenario === "abort" ? 500 : deltaCount;
  assert.equal(textDeltas.length, expectedCount, `${mode}/${scenario} fixture must emit the expected non-empty text deltas`);
  assert.deepEqual(textDeltas.map((entry) => entry.isolationDeltaIndex), expectedIndexes.slice(0, expectedCount));
  assert.ok(entries.some((entry) => entry.direction === "isolation-phase" && entry.isolationPhase === "raw-start"));
  if (scenario !== "abort") assert.ok(entries.some((entry) => entry.direction === "isolation-phase" && entry.isolationPhase === "raw-end"));
}

async function selectPreservedText(page, { modal = false } = {}) {
  const expected = modal ? "Confirm action" : "fake answer";
  const target = modal
    ? page.locator("#confirmationTitle")
    : page.locator(".message.assistant:not(.streaming) .markdown-body", { hasText: expected }).first();
  await expect(target).toContainText(expected);
  const selected = await target.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    }
    return "";
  }, expected);
  assert.equal(selected, expected);
  return expected;
}

async function prepareInteractiveState(page, {
  viewport = { width: 1280, height: 720 },
  modal = false,
  dropdown = false,
  pauseChat = false,
} = {}) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseURL}/?streamIsolationDebug=1`);
  await expect(page.locator("#promptInput")).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.addStyleTag({ content: "#chat > .message { min-height: 10rem; }" });

  if (viewport.width >= 700) {
    const sideScroll = await page.locator("#sidePanel .side-panel-body").evaluate((node) => {
      node.scrollTop = Math.min(120, Math.max(0, node.scrollHeight - node.clientHeight));
      return node.scrollTop;
    });
    assert.ok(sideScroll > 0, `desktop proof requires a real side-panel reader position, got ${sideScroll}`);
  }

  if (pauseChat) {
    const pausedTop = await page.locator("#chat").evaluate((node) => {
      node.style.scrollBehavior = "auto";
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -160, bubbles: true }));
      node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight - 160);
      node.dispatchEvent(new Event("scroll", { bubbles: true }));
      node.style.removeProperty("scroll-behavior");
      return node.scrollTop;
    });
    assert.ok(pausedTop > 0);
  }

  if (modal) {
    await page.locator("#confirmationDialog").evaluate((dialog) => dialog.showModal());
    await page.locator("#confirmationCancelButton").focus();
    await expect(page.locator("#confirmationDialog")).toHaveAttribute("open", "");
  } else if (dropdown) {
    await page.locator("#newTabButton").click();
    await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");
  } else {
    await page.locator("#promptInput").focus();
  }
  return selectPreservedText(page, { modal });
}

async function installIsolationInstrumentation(page, { pauseChat = false } = {}) {
  await page.evaluate(({ shouldPauseChat }) => {
    const ledger = window.__piStreamIsolationDebug;
    if (!ledger) throw new Error("stream-isolation debug ledger is unavailable");
    for (const key of Object.keys(ledger.counters)) ledger.counters[key] = 0;
    for (const key of ["receivedIndexes", "appliedIndexes", "records", "unknownEvidence"]) ledger[key].length = 0;

    const identitySelectors = [
      "html", "body", "#tabBar", "#newTabMenu", "#newTabButton", "#widgetArea",
      "#feedbackTray", "#statusBar", "#contextMeterBar", "#gitWorkflowPanel", "#composer",
      "#promptInput", "#abortButton", "#steerButton", "#followUpButton", "#sidePanel", "#fileViewerPane", "#eventLog",
      "#confirmationDialog", "#confirmationCancelButton",
    ];
    const describe = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element) return String(node?.nodeName || "unknown");
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList?.length ? `.${[...element.classList].slice(0, 3).join(".")}` : ""}`;
    };
    const underTranscript = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.("#chat") !== null;
    const allowedFollowMutation = (record) => record.type === "attributes" && record.attributeName === "hidden" && record.target === document.querySelector("#jumpToLatestButton");
    const scrollNodes = [...document.querySelectorAll("*")].filter((node) => {
      if (node.closest?.("#chat")) return false;
      return node === document.scrollingElement || node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth || node.scrollTop !== 0 || node.scrollLeft !== 0;
    });
    if (document.scrollingElement && !scrollNodes.includes(document.scrollingElement)) scrollNodes.push(document.scrollingElement);
    const proof = {
      allowedMutations: { attributes: 0, characterData: 0, childList: 0 },
      allowedFollowMutations: 0,
      forbiddenMutations: { attributes: 0, characterData: 0, childList: 0 },
      forbiddenMutationExamples: [],
      focusEvents: [], focusCalls: [], scrollIntoViewCalls: [], fetchCalls: [], eventSourceConstructions: [],
      activeElement: document.activeElement,
      activeElementDescription: describe(document.activeElement),
      selectionText: window.getSelection()?.toString() || "",
      selectionAnchor: window.getSelection()?.anchorNode || null,
      selectionFocus: window.getSelection()?.focusNode || null,
      identities: identitySelectors.map((selector) => ({ selector, node: document.querySelector(selector) })).filter(({ node }) => node),
      scrolls: scrollNodes.map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft, label: describe(node) })),
      chatTop: document.querySelector("#chat")?.scrollTop || 0,
      pauseChat: shouldPauseChat,
    };
    proof.recordMutations = (records) => {
      for (const record of records) {
        if (underTranscript(record.target)) proof.allowedMutations[record.type] += 1;
        else if (allowedFollowMutation(record)) proof.allowedFollowMutations += 1;
        else {
          proof.forbiddenMutations[record.type] += 1;
          if (proof.forbiddenMutationExamples.length < 20) proof.forbiddenMutationExamples.push(`${record.type}:${describe(record.target)}:${record.attributeName || ""}`);
        }
      }
    };
    proof.originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) { proof.focusCalls.push(describe(this)); return proof.originalFocus.apply(this, args); };
    proof.originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) { proof.scrollIntoViewCalls.push(describe(this)); return proof.originalScrollIntoView?.apply(this, args); };
    proof.originalFetch = window.fetch;
    window.fetch = function (...args) { proof.fetchCalls.push(String(args[0])); return proof.originalFetch.apply(this, args); };
    proof.originalEventSource = window.EventSource;
    window.EventSource = new Proxy(proof.originalEventSource, {
      construct(target, args, receiver) { proof.eventSourceConstructions.push(String(args[0])); return Reflect.construct(target, args, receiver); },
    });
    proof.onFocus = (event) => proof.focusEvents.push(`${event.type}:${describe(event.target)}`);
    document.addEventListener("focusin", proof.onFocus, true);
    document.addEventListener("focusout", proof.onFocus, true);
    proof.observer = new MutationObserver(proof.recordMutations);
    proof.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__streamIsolationProof = proof;
  }, { shouldPauseChat: pauseChat });
}

async function finishIsolationInstrumentation(page) {
  return page.evaluate(() => {
    const proof = window.__streamIsolationProof;
    proof.recordMutations(proof.observer.takeRecords());
    proof.observer.disconnect();
    document.removeEventListener("focusin", proof.onFocus, true);
    document.removeEventListener("focusout", proof.onFocus, true);
    HTMLElement.prototype.focus = proof.originalFocus;
    Element.prototype.scrollIntoView = proof.originalScrollIntoView;
    window.fetch = proof.originalFetch;
    window.EventSource = proof.originalEventSource;
    const identityChanges = proof.identities.filter(({ selector, node }) => document.querySelector(selector) !== node || !node.isConnected).map(({ selector }) => selector);
    const scrollChanges = proof.scrolls.filter(({ node, top, left }) => node.isConnected && (node.scrollTop !== top || node.scrollLeft !== left)).map(({ label, node, top, left }) => ({ label, before: [top, left], after: [node.scrollTop, node.scrollLeft] }));
    const ledger = window.__piStreamIsolationDebug;
    return {
      allowedMutations: proof.allowedMutations,
      allowedFollowMutations: proof.allowedFollowMutations,
      forbiddenMutations: proof.forbiddenMutations,
      forbiddenMutationExamples: proof.forbiddenMutationExamples,
      focusEvents: proof.focusEvents,
      focusCalls: proof.focusCalls,
      scrollIntoViewCalls: proof.scrollIntoViewCalls,
      fetchCalls: proof.fetchCalls,
      eventSourceConstructions: proof.eventSourceConstructions,
      activeElementChanged: document.activeElement !== proof.activeElement,
      activeElementBefore: proof.activeElementDescription,
      activeElementAfter: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id || ""}` : "none",
      identityChanges,
      scrollChanges,
      chatTopBefore: proof.chatTop,
      chatTopAfter: document.querySelector("#chat")?.scrollTop || 0,
      pauseChat: proof.pauseChat,
      selectionBefore: proof.selectionText,
      selectionAfter: window.getSelection()?.toString() || "",
      selectionNodesConnected: proof.selectionAnchor?.isConnected === true && proof.selectionFocus?.isConnected === true,
      debug: {
        counters: { ...ledger.counters },
        receivedIndexes: [...ledger.receivedIndexes],
        appliedIndexes: [...ledger.appliedIndexes],
      },
    };
  });
}

function isIndependentPollRequest(value) {
  try {
    return ["/api/tabs", "/api/state", "/api/subagents"].includes(new URL(String(value), baseURL).pathname);
  } catch {
    return false;
  }
}

async function holdIndependentPollResponses(page) {
  const held = [];
  const matcher = /\/api\/(?:tabs|state|subagents)(?:\?|$)/;
  const handler = (route) => { held.push(route); };
  await page.route(matcher, handler);
  return async () => {
    await page.unroute(matcher, handler);
    await Promise.allSettled(held.splice(0).map((route) => route.continue()));
  };
}

function assertIsolationMetrics(metrics, networkRequests, surface, expectedSelection, expectedIndexCount = deltaCount) {
  assert.deepEqual(metrics.forbiddenMutations, { attributes: 0, characterData: 0, childList: 0 }, `${surface}: ${metrics.forbiddenMutationExamples.join(", ")}`);
  assert.deepEqual(metrics.focusEvents, []);
  assert.deepEqual(metrics.focusCalls, []);
  assert.deepEqual(metrics.scrollIntoViewCalls, []);
  assert.deepEqual(metrics.fetchCalls.filter((url) => !isIndependentPollRequest(url)), [], `${surface}: raw deltas initiated fetch calls`);
  assert.deepEqual(metrics.eventSourceConstructions, []);
  assert.equal(metrics.activeElementChanged, false, `${surface}: active element changed from ${metrics.activeElementBefore} to ${metrics.activeElementAfter}`);
  assert.deepEqual(metrics.identityChanges, []);
  assert.deepEqual(metrics.scrollChanges, []);
  if (metrics.pauseChat) assert.equal(metrics.chatTopAfter, metrics.chatTopBefore);
  assert.equal(metrics.selectionBefore, expectedSelection);
  assert.equal(metrics.selectionAfter, expectedSelection);
  assert.equal(metrics.selectionNodesConnected, true);
  const deltaTriggeredRequests = networkRequests.filter((request) => !isIndependentPollRequest(request.split(" ").slice(1).join(" ")));
  assert.deepEqual(deltaTriggeredRequests, [], `${surface}: raw deltas initiated page requests`);
  assert.ok(Object.values(metrics.allowedMutations).some((count) => count > 0));
  assert.deepEqual(metrics.debug.receivedIndexes, expectedIndexes.slice(0, expectedIndexCount), `${surface}: browser receipt indexes must be complete`);
  assert.deepEqual(metrics.debug.appliedIndexes, expectedIndexes.slice(0, expectedIndexCount), `${surface}: browser application indexes must be complete`);
  assert.ok(metrics.debug.counters.sinkCalls <= 16, `${surface}: controller should batch transcript sinks, got ${metrics.debug.counters.sinkCalls}`);
  assert.ok(metrics.debug.counters.highWaterPendingCount <= 8, `${surface}: pending high-water should remain bounded, got ${metrics.debug.counters.highWaterPendingCount}`);
  assert.equal(metrics.debug.counters.overflows, 0, `${surface}: normal proof must not overflow the bounded accumulator`);
}

async function startFixture(page, mode, scenario = "standard") {
  const tabId = await activeTabId(page);
  const response = await serverApi(`/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    method: "POST",
    data: { message: `fixture stream isolation ${mode} ${scenario}`, requestId: `stream-isolation-${mode}-${scenario}-${Date.now()}` },
  });
  assert.equal(response.data?.deltaCount, deltaCount);
  assert.equal(response.data?.finalText, expectedFinalText);
  await waitForPhase(response.data.runId, "ready");
  await expect(page.locator("#abortButton")).toBeVisible();
  await expect(page.locator(".message.toolExecution").last()).toContainText("read");
  // The fixture does not start raw output until the test sends an explicit
  // steer. Drain independent lifecycle/subagent polls first so the observed
  // window contains only the requested raw stream.
  const waitForRequestPath = (pathname) => new Promise((resolve) => {
    const timer = setTimeout(() => { page.off("requestfinished", onFinished); resolve(); }, 6_000);
    const onFinished = (request) => {
      if (new URL(request.url()).pathname !== pathname) return;
      clearTimeout(timer); page.off("requestfinished", onFinished); resolve();
    };
    page.on("requestfinished", onFinished);
  });
  await Promise.all([waitForRequestPath("/api/tabs"), waitForRequestPath("/api/subagents")]);
  // The optional-feature ready card owns an independent auto-dismiss timer.
  // Synchronize on its semantic end state so it cannot be mistaken for a
  // stream-delta-caused chrome mutation in the observed window.
  await expect(page.locator("#optionalFeatureMigrationSurface")).toBeHidden();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { tabId, runId: response.data.runId };
}

async function continueFixture(tabId, runId) {
  await serverApi(`/api/steer?tab=${encodeURIComponent(tabId)}`, {
    method: "POST",
    data: { message: `fixture stream isolation continue ${runId}` },
  });
}

async function waitForRawDrain(page, runId, expectedCount = deltaCount) {
  await waitForPhase(runId, expectedCount === deltaCount ? "raw-end" : "abort-ready");
  await expect.poll(() => page.evaluate(() => window.__piStreamIsolationDebug?.appliedIndexes?.length || 0)).toBe(expectedCount);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForSettlement(page, tabId) {
  await expect.poll(async () => (await serverApi(`/api/state?tab=${encodeURIComponent(tabId)}`)).data?.isStreaming).toBe(false);
  const settled = page.locator(".message.assistant:not(.streaming) .markdown-body", { hasText: "ISOLATION-TEXT-TAIL" }).last();
  await expect(settled).toContainText("ISOLATION-TEXT-BEGIN");
  assert.equal((await settled.textContent()).trim(), expectedFinalText);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-stream-isolation-"));
  logRoot = await mkdtemp(join(tmpdir(), "pi-webui-stream-isolation-log-"));
  logFile = join(logRoot, "fake-pi.jsonl");
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_WEBUI_RPC_SUPERVISOR: "0", PI_CODING_AGENT_DIR: join(tempRoot, "agent"), PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"), FAKE_PI_LOG_FILE: logFile, FAKE_PI_STREAM_ISOLATION: "1" },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
});

test.afterAll(async () => {
  if (child?.exitCode === null) { const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); await exited; }
  await Promise.all([rm(tempRoot, { recursive: true, force: true }), rm(logRoot, { recursive: true, force: true })]);
});

async function runIsolationCase(page, { mode, viewport, modal = false, dropdown = false, pauseChat = false, label }) {
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: mode === "compact" ? "compact-v1" : "normal" } });
  const expectedSelection = await prepareInteractiveState(page, { viewport, modal, dropdown, pauseChat });
  const { tabId, runId } = await startFixture(page, mode);
  const releaseIndependentPolls = await holdIndependentPollResponses(page);
  const networkRequests = [];
  const onRequest = (request) => networkRequests.push(`${request.method()} ${request.url()}`);
  page.on("request", onRequest);
  await installIsolationInstrumentation(page, { pauseChat });
  await continueFixture(tabId, runId);
  await waitForPhase(runId, "raw-start");
  await waitForPhase(runId, "text-complete");
  if (mode === "normal") {
    await expect(page.locator(".message.assistant.streaming .streaming-markdown").last()).toContainText("ISOLATION-TEXT-TAIL");
  } else {
    await expect(page.locator(".message.compact-live-output .compact-live-text").last()).toContainText("ISOLATION-TEXT-TAIL");
  }
  await waitForRawDrain(page, runId);
  if (mode === "normal") {
    await expect(page.locator(".message.toolExecution").last()).toContainText("ISOLATION-TOOL-UPDATE-COMPLETE");
  } else {
    await expect(page.locator(".compact-tool-shell")).toHaveCount(0);
    await expect(page.locator("#chat")).not.toContainText("ISOLATION-TOOL-UPDATE-COMPLETE");
  }
  const metrics = await finishIsolationInstrumentation(page);
  page.off("request", onRequest);
  await releaseIndependentPolls();
  console.log(`stream-output-isolation raw metrics ${JSON.stringify({
    mode,
    label,
    ...metrics,
    debug: {
      counters: metrics.debug.counters,
      receivedCount: metrics.debug.receivedIndexes.length,
      appliedCount: metrics.debug.appliedIndexes.length,
    },
    networkRequests,
  })}`);
  assertIsolationMetrics(metrics, networkRequests, label, expectedSelection);
  if (mode === "compact") {
    await waitForPhase(runId, "tool-complete");
    await expect(page.locator(".compact-tool-shell .compact-tool-status").last()).toHaveText("done");
  }
  await waitForSettlement(page, tabId);
  await assertFixtureContract(runId, mode);
}

test("desktop normal stream output isolation", async ({ page }) => runIsolationCase(page, { mode: "normal", viewport: { width: 1280, height: 720 }, dropdown: true, label: "desktop-normal" }));
test("desktop compact isolation preserves paused reader and modal", async ({ page }) => runIsolationCase(page, { mode: "compact", viewport: { width: 1280, height: 720 }, modal: true, pauseChat: true, label: "desktop-compact" }));
test("mobile 390x844 normal isolation", async ({ page }) => runIsolationCase(page, { mode: "normal", viewport: { width: 390, height: 844 }, label: "mobile-390" }));
test("mobile 320x568 compact isolation", async ({ page }) => runIsolationCase(page, { mode: "compact", viewport: { width: 320, height: 568 }, pauseChat: true, label: "mobile-320" }));

test("abort flushes and preserves the partial text tail before lifecycle chrome settles", async ({ page }) => {
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: "normal" } });
  const expectedSelection = await prepareInteractiveState(page, { viewport: { width: 1280, height: 720 } });
  const { tabId, runId } = await startFixture(page, "normal", "abort");
  const indicator = await page.locator(".run-indicator-message").elementHandle();
  const releaseIndependentPolls = await holdIndependentPollResponses(page);
  const requests = [];
  const onRequest = (request) => requests.push(`${request.method()} ${request.url()}`);
  page.on("request", onRequest);
  await installIsolationInstrumentation(page);
  await continueFixture(tabId, runId);
  await waitForRawDrain(page, runId, 500);
  await expect(page.locator(".message.assistant.streaming .streaming-markdown").last()).toContainText("ISOLATION-TEXT-BEGIN");
  const metrics = await finishIsolationInstrumentation(page);
  page.off("request", onRequest);
  await releaseIndependentPolls();
  assertIsolationMetrics(metrics, requests, "abort-partial", expectedSelection, 500);
  const barriersBeforeAbort = await page.evaluate(() => window.__piStreamIsolationDebug?.counters?.barriers || 0);
  assert.equal(await indicator.evaluate((node) => node.isConnected), true, "wording updates must retain the run-indicator node");
  const abortButton = page.locator("#abortButton");
  await abortButton.hover();
  await page.mouse.down();
  await page.waitForTimeout(3_200);
  await page.mouse.up();
  await expect.poll(async () => (await serverApi(`/api/state?tab=${encodeURIComponent(tabId)}`)).data?.isStreaming).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__piStreamIsolationDebug?.counters?.barriers || 0)).toBeGreaterThan(barriersBeforeAbort);
  await expect(page.locator("#abortButton")).toBeHidden();
  await assertFixtureContract(runId, "normal", "abort");
});

test("retry compaction reconnect and settlement retain lifecycle control identity", async ({ page }) => {
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: "normal" } });
  const expectedSelection = await prepareInteractiveState(page, { viewport: { width: 1280, height: 720 } });
  const { tabId, runId } = await startFixture(page, "normal", "lifecycle");
  const indicator = await page.locator(".run-indicator-message").elementHandle();
  const abort = await page.locator("#abortButton").elementHandle();
  const steer = await page.locator("#steerButton").elementHandle();
  const followUp = await page.locator("#followUpButton").elementHandle();
  const releaseIndependentPolls = await holdIndependentPollResponses(page);
  const requests = [];
  const onRequest = (request) => requests.push(`${request.method()} ${request.url()}`);
  page.on("request", onRequest);
  await installIsolationInstrumentation(page);
  await continueFixture(tabId, runId);
  await waitForRawDrain(page, runId);
  const metrics = await finishIsolationInstrumentation(page);
  page.off("request", onRequest);
  await releaseIndependentPolls();
  assertIsolationMetrics(metrics, requests, "lifecycle-raw", expectedSelection);
  const barriersBeforeLifecycle = await page.evaluate(() => window.__piStreamIsolationDebug?.counters?.barriers || 0);
  await continueFixture(tabId, runId);
  await waitForPhase(runId, "lifecycle-complete");
  await expect.poll(() => page.evaluate(() => window.__piStreamIsolationDebug?.counters?.barriers || 0)).toBeGreaterThanOrEqual(barriersBeforeLifecycle + 4);
  assert.equal(await indicator.evaluate((node) => node.isConnected), true);
  assert.equal(await abort.evaluate((node) => node.isConnected && !node.hidden), true);
  assert.equal(await steer.evaluate((node) => node.isConnected && !node.hidden && !node.disabled), true);
  assert.equal(await followUp.evaluate((node) => node.isConnected && !node.hidden && !node.disabled), true);
  await waitForSettlement(page, tabId);
  await expect(page.locator("#abortButton")).toBeHidden();
  await expect(page.locator("#steerButton")).toBeHidden();
  await expect(page.locator("#followUpButton")).toBeHidden();
  assert.equal(await steer.evaluate((node) => node.isConnected), true, "Steer must retain node identity through settlement");
  assert.equal(await followUp.evaluate((node) => node.isConnected), true, "Follow-up must retain node identity through settlement");
});
