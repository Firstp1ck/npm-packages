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
const expectedFinalText = `ISOLATION-TEXT-BEGIN ${Array.from({ length: 250 }, (_, index) => String(index % 10)).join("")}ISOLATION-TEXT-TAIL`;

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
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.isolationRunId === runId);
}

async function waitForFixtureLog(runId, predicate) {
  let matching = [];
  await expect.poll(async () => {
    matching = await fixtureLogEntries(runId);
    return predicate(matching);
  }).toBe(true);
  return matching;
}

async function assertFixtureContract(runId, mode) {
  const entries = await waitForFixtureLog(runId, (items) => items.some((entry) => entry.type === "agent_settled" && entry.isolationPhase === "post-burst"));
  const textDeltas = entries.filter((entry) => entry.isolationPhase === "raw" && entry.type === "message_update" && entry.assistantMessageEventType === "text_delta");
  assert.equal(textDeltas.length, deltaCount, `${mode} fixture must emit exactly 1,000 raw text deltas`);
  assert.deepEqual(textDeltas.map((entry) => entry.isolationDeltaIndex), Array.from({ length: deltaCount }, (_, index) => index), `${mode} fixture delta indexes must be complete and ordered`);
  const expectedPreBurst = mode === "compact"
    ? ["agent_start", "message_start", "tool_execution_start"]
    : ["agent_start", "tool_execution_start", "message_start"];
  assert.deepEqual(entries.filter((entry) => entry.isolationPhase === "pre-burst").map((entry) => entry.type), expectedPreBurst, `${mode} fixture must expose explicit pre-burst semantic boundaries`);
  assert.deepEqual(entries.filter((entry) => entry.isolationPhase === "post-burst").map((entry) => entry.type), ["tool_execution_end", "message_end", "agent_end", "agent_settled"], `${mode} fixture must expose explicit post-burst semantic boundaries`);
  assert.ok(entries.some((entry) => entry.isolationPhase === "raw" && entry.assistantMessageEventType === "thinking_delta"), `${mode} fixture must exercise thinking output`);
  assert.ok(entries.some((entry) => entry.isolationPhase === "raw" && entry.assistantMessageEventType === "toolcall_delta"), `${mode} fixture must exercise tool-call output`);
  assert.ok(entries.some((entry) => entry.isolationPhase === "raw" && entry.type === "tool_execution_update"), `${mode} fixture must exercise tool-execution updates`);
}

async function selectPreservedText(page, { modal = false } = {}) {
  const expected = modal ? "Confirm action" : "fake answer";
  const output = modal
    ? page.locator("#confirmationTitle")
    : page.locator(".message.assistant:not(.streaming) .markdown-body", { hasText: expected }).first();
  await expect(output).toContainText(expected);
  const selected = await output.evaluate((root, text) => {
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
  assert.equal(selected, expected, "the proof needs a real preserved browser selection");
  return expected;
}

async function prepareInteractiveState(page, { modal = false, pauseChat = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseURL);
  await expect(page.locator("#promptInput")).toBeVisible();
  // Drain the page-show/initial EventSource foreground reconciliation before
  // creating the explicit pre-burst interaction baseline.
  await page.waitForTimeout(1_000);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.addStyleTag({ content: "#chat > .message { min-height: 10rem; }" });

  const sideScroll = await page.locator("#sidePanel .side-panel-body").evaluate((node) => {
    node.scrollTop = Math.min(120, Math.max(0, node.scrollHeight - node.clientHeight));
    return node.scrollTop;
  });
  assert.ok(sideScroll > 0, `the non-chat reader proof needs a real side-panel scroll position, got ${sideScroll}`);

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
    assert.ok(pausedTop > 0, `the compact proof needs a real paused chat position, got ${pausedTop}`);
  }

  if (modal) {
    await page.locator("#confirmationDialog").evaluate((dialog) => dialog.showModal());
    await page.locator("#confirmationCancelButton").focus();
    await expect(page.locator("#confirmationDialog")).toHaveAttribute("open", "");
  } else {
    await page.locator("#newTabButton").click();
    await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#newTabMenu")).toHaveClass(/open/);
  }
  await selectPreservedText(page, { modal });

  // Align the bounded raw window immediately after the independent idle
  // subagent poll so its next 4s semantic refresh cannot overlap the proof.
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      page.off("requestfinished", onFinished);
      resolve();
    }, 4_500);
    const onFinished = (request) => {
      if (!request.url().includes("/api/subagents")) return;
      clearTimeout(timeout);
      page.off("requestfinished", onFinished);
      resolve();
    };
    page.on("requestfinished", onFinished);
  });
}

async function installIsolationInstrumentation(page, { pauseChat = false } = {}) {
  await page.evaluate(({ shouldPauseChat }) => {
    const identitySelectors = [
      "html", "body", "#tabBar", "#newTabMenu", "#newTabButton", "#widgetArea",
      "#feedbackTray", "#statusBar", "#contextMeterBar", "#gitWorkflowPanel", "#composer",
      "#promptInput", "#abortButton", "#sidePanel", "#fileViewerPane", "#eventLog",
      "#confirmationDialog", "#confirmationCancelButton",
    ];
    const scrollSelectors = ["#sidePanel .side-panel-body", "#fileTreeRoot", "#eventLog", "#fileViewerEditor", "#widgetArea"];
    const describe = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element) return String(node?.nodeName || "unknown");
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList?.length ? `.${[...element.classList].slice(0, 3).join(".")}` : ""}`;
    };
    const underTranscript = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.("#chat") !== null;
    };
    const allowedFollowMutation = (record) => record.type === "attributes"
      && record.attributeName === "hidden"
      && record.target === document.querySelector("#jumpToLatestButton");
    const proof = {
      allowedMutations: { attributes: 0, characterData: 0, childList: 0 },
      allowedFollowMutations: 0,
      forbiddenMutations: { attributes: 0, characterData: 0, childList: 0 },
      forbiddenMutationExamples: [],
      focusEvents: [],
      activeElement: document.activeElement,
      activeElementDescription: describe(document.activeElement),
      selectionText: window.getSelection()?.toString() || "",
      selectionAnchor: window.getSelection()?.anchorNode || null,
      selectionFocus: window.getSelection()?.focusNode || null,
      identities: identitySelectors.map((selector) => ({ selector, node: document.querySelector(selector) })),
      scrolls: scrollSelectors.map((selector) => ({ selector, node: document.querySelector(selector), top: document.querySelector(selector)?.scrollTop || 0, left: document.querySelector(selector)?.scrollLeft || 0 })),
      chatTop: document.querySelector("#chat")?.scrollTop || 0,
      pauseChat: shouldPauseChat,
    };
    const recordMutations = (records) => {
      for (const record of records) {
        if (underTranscript(record.target)) {
          proof.allowedMutations[record.type] += 1;
          continue;
        }
        if (allowedFollowMutation(record)) {
          proof.allowedFollowMutations += 1;
          continue;
        }
        proof.forbiddenMutations[record.type] += 1;
        if (proof.forbiddenMutationExamples.length < 20) {
          proof.forbiddenMutationExamples.push(`${record.type}:${describe(record.target)}:${record.attributeName || ""}`);
        }
      }
    };
    proof.observer = new MutationObserver(recordMutations);
    proof.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    proof.recordMutations = recordMutations;
    proof.onFocus = (event) => proof.focusEvents.push(`${event.type}:${describe(event.target)}`);
    document.addEventListener("focusin", proof.onFocus, true);
    document.addEventListener("focusout", proof.onFocus, true);
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
    const identityChanges = proof.identities.filter(({ selector, node }) => document.querySelector(selector) !== node || !node?.isConnected).map(({ selector }) => selector);
    const scrollChanges = proof.scrolls.filter(({ node, top, left }) => node && (node.scrollTop !== top || node.scrollLeft !== left)).map(({ selector, node, top, left }) => ({ selector, before: [top, left], after: [node.scrollTop, node.scrollLeft] }));
    const activeElementChanged = document.activeElement !== proof.activeElement;
    const selectionText = window.getSelection()?.toString() || "";
    const selectionNodesConnected = proof.selectionAnchor?.isConnected === true && proof.selectionFocus?.isConnected === true;
    return {
      allowedMutations: proof.allowedMutations,
      allowedFollowMutations: proof.allowedFollowMutations,
      forbiddenMutations: proof.forbiddenMutations,
      forbiddenMutationExamples: proof.forbiddenMutationExamples,
      focusEvents: proof.focusEvents,
      activeElementChanged,
      activeElementBefore: proof.activeElementDescription,
      activeElementAfter: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id || ""}` : "none",
      identityChanges,
      scrollChanges,
      chatTopBefore: proof.chatTop,
      chatTopAfter: document.querySelector("#chat")?.scrollTop || 0,
      pauseChat: proof.pauseChat,
      selectionBefore: proof.selectionText,
      selectionAfter: selectionText,
      selectionNodesConnected,
    };
  });
}

function assertIsolationMetrics(metrics, networkRequests, surface, expectedSelection) {
  assert.deepEqual(metrics.forbiddenMutations, { attributes: 0, characterData: 0, childList: 0 }, `${surface}: non-transcript mutations must be zero; ${metrics.forbiddenMutationExamples.join(", ")}`);
  assert.deepEqual(metrics.focusEvents, [], `${surface}: raw deltas must not dispatch focus changes`);
  assert.equal(metrics.activeElementChanged, false, `${surface}: active element changed from ${metrics.activeElementBefore} to ${metrics.activeElementAfter}`);
  assert.deepEqual(metrics.identityChanges, [], `${surface}: unrelated roots or controls were replaced`);
  assert.deepEqual(metrics.scrollChanges, [], `${surface}: non-chat scroll positions changed`);
  if (metrics.pauseChat) assert.equal(metrics.chatTopAfter, metrics.chatTopBefore, `${surface}: paused chat reader position changed`);
  assert.equal(metrics.selectionBefore, expectedSelection, `${surface}: preserved selection baseline is missing`);
  assert.equal(metrics.selectionAfter, expectedSelection, `${surface}: preserved selection changed during raw deltas`);
  assert.equal(metrics.selectionNodesConnected, true, `${surface}: selected settled transcript nodes were replaced`);
  assert.deepEqual(networkRequests, [], `${surface}: raw deltas initiated HTTP/RPC requests`);
  assert.ok(Object.values(metrics.allowedMutations).some((count) => count > 0), `${surface}: the proof must observe real transcript mutations`);
}

async function startFixture(page, mode) {
  const tabId = await activeTabId(page);
  assert.ok(tabId, `${mode} proof requires an active terminal tab`);
  const response = await serverApi(`/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    method: "POST",
    data: { message: `fixture stream isolation ${mode}`, requestId: `stream-isolation-${mode}-${Date.now()}` },
  });
  assert.equal(response.data?.deltaCount, deltaCount);
  assert.equal(response.data?.mode, mode);
  await expect(page.locator("#abortButton")).toBeVisible();
  await expect(page.locator(".message.toolExecution").last()).toContainText("read");
  // The active-run tab poll is lifecycle-owned and scheduled 1.5s after the
  // pre-burst agent boundary. Drain it before opening the raw-only window.
  const waitStartedAt = Date.now();
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      page.off("requestfinished", onFinished);
      resolve();
    }, 1_700);
    const onFinished = (request) => {
      if (Date.now() - waitStartedAt < 1_000 || new URL(request.url()).pathname !== "/api/tabs") return;
      clearTimeout(timeout);
      page.off("requestfinished", onFinished);
      resolve();
    };
    page.on("requestfinished", onFinished);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { tabId, runId: response.data.runId };
}

async function waitForSettlement(page, tabId) {
  await expect.poll(async () => (await serverApi(`/api/state?tab=${encodeURIComponent(tabId)}`)).data?.isStreaming).toBe(false);
  const settled = page.locator(".message.assistant:not(.streaming) .markdown-body", { hasText: "ISOLATION-TEXT-TAIL" }).last();
  await expect(settled).toContainText("ISOLATION-TEXT-BEGIN");
  await expect(settled).toContainText("0123456789");
  assert.equal((await settled.textContent()).trim(), expectedFinalText, "the authoritative transcript must settle the complete, lossless 1,000-delta tail");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-stream-isolation-"));
  // Keep the event ledger outside the watched workspace: appending proof rows
  // must not manufacture workspace-file semantic events during raw output.
  logRoot = await mkdtemp(join(tmpdir(), "pi-webui-stream-isolation-log-"));
  logFile = join(logRoot, "fake-pi.jsonl");
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"),
      FAKE_PI_LOG_FILE: logFile,
      FAKE_PI_STREAM_ISOLATION: "1",
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Poll until the package server and fake Pi fixture are both ready.
    }
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
});

test.afterAll(async () => {
  if (child?.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await Promise.all([
    rm(tempRoot, { recursive: true, force: true }),
    rm(logRoot, { recursive: true, force: true }),
  ]);
});

test("normal stream output isolation", async ({ page }) => {
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: "normal" } });
  await prepareInteractiveState(page);
  const { tabId, runId } = await startFixture(page, "normal");
  await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");

  const networkRequests = [];
  let captureNetwork = true;
  page.on("request", (request) => { if (captureNetwork) networkRequests.push(`${request.method()} ${request.url()}`); });
  await installIsolationInstrumentation(page);

  await expect(page.locator(".message.thinking.streaming .thinking-text").last()).toContainText("ISOLATION-THINKING-PATH");
  await expect(page.locator(".message.assistant.streaming .streaming-markdown").last()).toContainText("ISOLATION-TEXT-TAIL");
  await expect(page.locator(".message.toolCall.streaming").last()).toContainText("isolation.txt");
  await expect(page.locator(".message.toolExecution").last()).toContainText("ISOLATION-TOOL-UPDATE-COMPLETE");
  const metrics = await finishIsolationInstrumentation(page);
  captureNetwork = false;
  console.log(`stream-output-isolation raw metrics ${JSON.stringify({ mode: "normal", ...metrics, networkRequests })}`);

  assertIsolationMetrics(metrics, networkRequests, "normal", "fake answer");
  await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#newTabMenu")).toHaveClass(/open/);
  await waitForSettlement(page, tabId);
  await assertFixtureContract(runId, "normal");
  console.log(`stream-output-isolation metrics ${JSON.stringify({ mode: "normal", ...metrics, networkRequests: networkRequests.length })}`);
});

test("compact stream output isolation preserves paused reader and modal", async ({ page }) => {
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: "compact-v1" } });
  await prepareInteractiveState(page, { modal: true, pauseChat: true });
  const { tabId, runId } = await startFixture(page, "compact");
  await expect(page.locator("#confirmationDialog")).toHaveAttribute("open", "");

  const networkRequests = [];
  let captureNetwork = true;
  page.on("request", (request) => { if (captureNetwork) networkRequests.push(`${request.method()} ${request.url()}`); });
  await installIsolationInstrumentation(page, { pauseChat: true });

  await expect(page.locator(".compact-live-thinking").last()).toContainText("ISOLATION-THINKING-PATH");
  await expect(page.locator(".message.compact-live-output .compact-live-text").last()).toContainText("ISOLATION-TEXT-TAIL");
  await waitForFixtureLog(runId, (entries) => entries.some((entry) => entry.isolationPhase === "raw" && entry.type === "tool_execution_update"));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await finishIsolationInstrumentation(page);
  captureNetwork = false;
  console.log(`stream-output-isolation raw metrics ${JSON.stringify({ mode: "compact", ...metrics, networkRequests })}`);

  assertIsolationMetrics(metrics, networkRequests, "compact", "Confirm action");
  await expect(page.locator("#confirmationDialog")).toHaveAttribute("open", "");
  await waitForSettlement(page, tabId);
  await assertFixtureContract(runId, "compact");
  console.log(`stream-output-isolation metrics ${JSON.stringify({ mode: "compact", ...metrics, networkRequests: networkRequests.length })}`);

  await page.locator("#confirmationDialog").evaluate((dialog) => dialog.close());
  await serverApi("/api/webui-output-mode", { method: "PUT", data: { outputModeDefault: "normal" } });
});
