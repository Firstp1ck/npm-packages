#!/usr/bin/env node
// Browser-runtime validation of the WebUI Natural Conversation voice loop.
//
// What is REAL here: headless Chrome (real browser engine), the real served
// index.html/app.js/voice-conversation.mjs, the real pi-webui server, the real
// SSE event stream (/api/events), and the real JSONL RPC protocol against the
// tests/fixtures/fake-pi.mjs stub. What is MOCKED: the Web Speech ENGINES
// (SpeechRecognition + speechSynthesis are replaced at the window boundary
// before page load because headless Chrome has no microphone and its native
// speechSynthesis never fires utterance onend) and the agent event scripts
// (fake-pi emits scripted agent/message/tool events when FAKE_PI_VOICE_SCRIPTS=1).
// Physical microphone/speaker hardware therefore remains MANUAL validation.
//
// KNOWN SERVER GAP (discovered by this validation, 2026-07-02): the server's
// static allowlist (normalizeStaticPath in bin/pi-webui.mjs) does not include
// voice-conversation.mjs, so app.js's dynamic import 404s and the browser voice
// loop can never start against an unpatched server. This driver records that as
// an explicit check and then serves the REAL on-disk public/voice-conversation.mjs
// bytes via request interception so the rest of the loop can still be validated.
// Once the allowlist is fixed the interception becomes a no-op safety net and
// the "server serves /voice-conversation.mjs" check flips to PASS.
//
// Usage (no dependencies are added to this package; puppeteer-core is resolved
// from an external directory):
//   mkdir -p /some/scratch/puppeteer-env && cd /some/scratch/puppeteer-env
//   npm init -y && npm install puppeteer-core
//   PI_WEBUI_PUPPETEER_DIR=/some/scratch/puppeteer-env \
//   PI_WEBUI_CHROME=/usr/bin/google-chrome-unstable \
//   VOICE_VALIDATION_WORK_DIR=/some/scratch/voice-run-1 \
//   node dev/scripts/voice-browser-validation.mjs
//
// Environment:
//   PI_WEBUI_PUPPETEER_DIR   directory containing node_modules/puppeteer-core (required
//                            unless puppeteer-core resolves from the cwd)
//   PI_WEBUI_CHROME          Chrome executable (default /usr/bin/google-chrome-unstable)
//   VOICE_VALIDATION_WORK_DIR   work directory for server cwd/settings/log/screenshots
//                               (default: a fresh mkdtemp under the OS tmpdir)
// Exit code 0 only if every scenario check passed.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = path.join(root, "bin", "pi-webui.mjs");
const fixture = path.join(root, "tests", "fixtures", "fake-pi.mjs");
const chromePath = process.env.PI_WEBUI_CHROME || "/usr/bin/google-chrome-unstable";
const port = 30000 + Math.floor(Math.random() * 20000);
const baseUrl = `http://127.0.0.1:${port}`;

function loadPuppeteer() {
  const candidates = [];
  if (process.env.PI_WEBUI_PUPPETEER_DIR) candidates.push(path.join(process.env.PI_WEBUI_PUPPETEER_DIR, "resolve-anchor.js"));
  candidates.push(path.join(process.cwd(), "resolve-anchor.js"));
  for (const anchor of candidates) {
    try {
      return createRequire(anchor)("puppeteer-core");
    } catch {
      // Try the next anchor.
    }
  }
  console.error("puppeteer-core could not be resolved. Set PI_WEBUI_PUPPETEER_DIR to a directory containing node_modules/puppeteer-core.");
  process.exit(2);
}

const puppeteer = loadPuppeteer();

const workDir = process.env.VOICE_VALIDATION_WORK_DIR
  ? path.resolve(process.env.VOICE_VALIDATION_WORK_DIR)
  : await mkdtemp(path.join(tmpdir(), "pi-webui-voice-validation-"));
await mkdir(workDir, { recursive: true });
const screenshotDir = path.join(workDir, "screenshots");
await mkdir(screenshotDir, { recursive: true });
const settingsFile = path.join(workDir, "webui-settings.json");
const logFile = path.join(workDir, `fake-pi-log-${Date.now()}.jsonl`);

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(fn, { timeoutMs = 10_000, intervalMs = 100, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() >= deadline) throw new Error(`timeout (${timeoutMs}ms) waiting for ${label}`);
    await delay(intervalMs);
  }
}

async function readLog() {
  try {
    const text = await readFile(logFile, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function transcriptCommands(entries) {
  return entries.filter((entry) => entry.direction === "command" && (entry.type === "prompt" || entry.type === "steer"));
}

// --- boot the real pi-webui server against the scripted fake-pi fixture ------
const serverEnv = {
  ...process.env,
  PI_WEBUI_SETTINGS_FILE: settingsFile,
  FAKE_PI_LOG_FILE: logFile,
  FAKE_PI_VOICE_SCRIPTS: "1",
};
const server = spawn(process.execPath, [serverScript, "--cwd", workDir, "--host", "127.0.0.1", "--port", String(port), "--pi", fixture], {
  stdio: ["ignore", "pipe", "pipe"],
  env: serverEnv,
});
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});
console.log(`server pid=${server.pid} port=${port} workDir=${workDir}`);

let browser = null;
let failed = false;

async function shutdown() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Browser already gone.
    }
    browser = null;
  }
  if (server.exitCode === null && !server.killed) {
    server.kill("SIGTERM");
    const gone = await Promise.race([new Promise((resolve) => server.once("exit", () => resolve(true))), delay(4000).then(() => false)]);
    if (!gone) server.kill("SIGKILL");
  }
}

try {
  // Health wait (all HTTP requests carry timeouts).
  await waitFor(
    async () => {
      if (server.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (!response.ok) return false;
        const body = await response.json();
        return body?.ok === true && body?.piRunning === true;
      } catch {
        return false;
      }
    },
    { timeoutMs: 30_000, intervalMs: 250, label: "server /api/health piRunning" },
  );
  console.log("server healthy (piRunning=true)");

  // --- check the voice module is actually served (integration gap detector) ---
  let voiceModuleStatus = 0;
  try {
    const response = await fetch(`${baseUrl}/voice-conversation.mjs?v=1`, { signal: AbortSignal.timeout(3000) });
    voiceModuleStatus = response.status;
    await response.arrayBuffer();
  } catch {
    voiceModuleStatus = 0;
  }
  check(
    "S0 server serves /voice-conversation.mjs (required for the browser voice loop)",
    voiceModuleStatus === 200,
    voiceModuleStatus === 200
      ? "HTTP 200"
      : `HTTP ${voiceModuleStatus || "error"} — normalizeStaticPath allowlist in bin/pi-webui.mjs is missing voice-conversation.mjs; driver falls back to serving the real on-disk module via request interception`,
  );

  // --- launch headless Chrome ------------------------------------------------
  const launchBase = { executablePath: chromePath, headless: "new" };
  try {
    browser = await puppeteer.launch(launchBase);
  } catch (error) {
    console.warn(`plain launch failed (${error?.message || error}); retrying with --no-sandbox flags`);
    browser = await puppeteer.launch({ ...launchBase, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console.error: ${message.text()}`);
  });

  // Workaround for the S0 serving gap: fulfill the voice module request with
  // the REAL public/voice-conversation.mjs bytes; every other request goes to
  // the real server untouched.
  const voiceModuleSource = await readFile(path.join(root, "public", "voice-conversation.mjs"), "utf8");
  let voiceModuleInterceptions = 0;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    let pathname = "";
    try {
      pathname = new URL(request.url()).pathname;
    } catch {
      pathname = "";
    }
    if (request.method() === "GET" && pathname === "/voice-conversation.mjs") {
      voiceModuleInterceptions += 1;
      request.respond({ status: 200, contentType: "text/javascript; charset=utf-8", body: voiceModuleSource }).catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  });

  // --- mock Web Speech ENGINES at the window boundary before any page script --
  await page.evaluateOnNewDocument(() => {
    const mocks = { recognitions: [], spoken: [], utterances: [], log: [] };
    window.__voiceMocks = mocks;

    class MockSpeechRecognition {
      constructor() {
        this.running = false;
        this.startCount = 0;
        this.continuous = false;
        this.interimResults = false;
        this.lang = "";
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        mocks.recognitions.push(this);
      }
      start() {
        if (this.running) throw new DOMException("recognition already started", "InvalidStateError");
        this.running = true;
        this.startCount += 1;
        mocks.log.push({ at: Date.now(), event: "recognition.start" });
      }
      stop() {
        this.#end("stop");
      }
      abort() {
        this.#end("abort");
      }
      #end(reason) {
        if (!this.running) return;
        this.running = false;
        mocks.log.push({ at: Date.now(), event: `recognition.${reason}` });
        setTimeout(() => {
          if (typeof this.onend === "function") this.onend({});
        }, 0);
      }
    }
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;

    const lastRecognition = () => {
      const running = [...mocks.recognitions].reverse().find((item) => item.running);
      return running || mocks.recognitions[mocks.recognitions.length - 1] || null;
    };
    const emitResult = (text, isFinal) => {
      const recognition = lastRecognition();
      if (!recognition || typeof recognition.onresult !== "function") return false;
      const result = { 0: { transcript: String(text) }, isFinal: !!isFinal, length: 1 };
      recognition.onresult({ resultIndex: 0, results: [result] });
      return true;
    };
    mocks.emitFinal = (text) => emitResult(text, true);
    mocks.emitInterim = (text) => emitResult(text, false);
    mocks.emitRecognitionError = (code) => {
      const recognition = lastRecognition();
      if (!recognition || typeof recognition.onerror !== "function") return false;
      recognition.onerror({ error: String(code) });
      return true;
    };

    // Headless Chrome ships a native speechSynthesis whose utterances never
    // fire onend, which would deadlock the voice loop in "speaking" forever.
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        paused: false,
        speak(utterance) {
          mocks.spoken.push(utterance.text);
          mocks.utterances.push(utterance);
          mocks.log.push({ at: Date.now(), event: "synthesis.speak", text: utterance.text });
          setTimeout(() => {
            if (typeof utterance.onend === "function") utterance.onend({});
          }, 80);
        },
        cancel() {
          mocks.log.push({ at: Date.now(), event: "synthesis.cancel" });
        },
        getVoices() {
          return [];
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
    window.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
      constructor(text) {
        this.text = String(text ?? "");
        this.onend = null;
        this.onerror = null;
      }
    };
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const chipState = () =>
    page.$eval("#conversationModeChip", (el) => ({ hidden: el.hidden, state: el.getAttribute("data-voice-state"), text: el.textContent || "" })).catch(() => null);
  const emitFinal = (text) => page.evaluate((value) => window.__voiceMocks.emitFinal(value), text);
  const emitInterim = (text) => page.evaluate((value) => window.__voiceMocks.emitInterim(value), text);
  const spokenTexts = () => page.evaluate(() => [...window.__voiceMocks.spoken]);
  const recognitionSnapshot = () =>
    page.evaluate(() => window.__voiceMocks.recognitions.map((item) => ({ running: item.running, startCount: item.startCount })));
  const screenshot = (name) => page.screenshot({ path: path.join(screenshotDir, name) });

  // === Scenario 1: page loads, feature detected, enable via real click path ===
  await waitFor(
    () => page.$eval("#optionsConversationModeButton", (el) => !el.hidden && !el.disabled).catch(() => false),
    { timeoutMs: 25_000, label: "#optionsConversationModeButton visible+enabled" },
  );
  await page.click("#optionsMenuButton");
  await waitFor(
    () => page.$eval("#optionsMenuButton", (el) => el.getAttribute("aria-expanded") === "true").catch(() => false),
    { timeoutMs: 5_000, label: "options menu open" },
  );
  await page.click("#optionsConversationModeButton");
  const enabledChip = await waitFor(
    async () => {
      const chip = await chipState();
      return chip && !chip.hidden && chip.state === "listening" ? chip : false;
    },
    { timeoutMs: 15_000, label: "conversation chip listening" },
  );
  // The browser voice loop starts asynchronously (dynamic module import) after
  // the mode enables, so wait for the mock recognition engine to be running.
  await waitFor(
    () => page.evaluate(() => window.__voiceMocks.recognitions.some((item) => item.running)),
    { timeoutMs: 15_000, label: "mock recognition instance started" },
  );
  const s1Recognitions = await recognitionSnapshot();
  const s1EndVisible = await page.$eval("#conversationModeEndButton", (el) => !el.hidden).catch(() => false);
  check(
    "S1 enable via options menu click: chip listening, recognition started, end button visible",
    enabledChip.state === "listening" && s1Recognitions.some((item) => item.running) && s1EndVisible,
    `path=real-click chip=${JSON.stringify(enabledChip)} recognitions=${JSON.stringify(s1Recognitions)}`,
  );
  await screenshot("s1-enabled.png");

  // Dismiss the options menu again. Its panel stays visible while focus is
  // inside it (.composer-publish-menu:focus-within keeps it open by design),
  // so — like a real user — click elsewhere to move focus away; otherwise the
  // invisible-but-focused panel swallows the later chip clicks.
  const chipClickable = () =>
    page.evaluate(() => {
      const el = document.querySelector("#conversationModeChip");
      if (!el || el.hidden) return false;
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.click(660, 240); // neutral chat-area click, like a user dismissing the menu
  await waitFor(chipClickable, { timeoutMs: 5_000, label: "conversation chip hit-testable after menu dismissed" });

  // === Scenario 2: transcript -> prompt -> scripted answer spoken =============
  await emitInterim("voice test");
  const transcribingChip = await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "transcribing" ? chip : false;
    },
    { timeoutMs: 5_000, label: "chip transcribing on interim result" },
  );
  check("S2a interim transcript shows transcribing chip with partial preview", transcribingChip.text.includes("voice test"), `chip=${JSON.stringify(transcribingChip)}`);
  await screenshot("s2a-transcribing.png");

  await emitFinal("voice test say hello");
  await waitFor(
    async () => transcriptCommands(await readLog()).some((entry) => entry.type === "prompt" && entry.message.includes("voice test say hello")),
    { timeoutMs: 10_000, label: "prompt command logged for final transcript" },
  );
  await waitFor(
    async () => (await spokenTexts()).includes("Okay, this is the spoken answer."),
    { timeoutMs: 10_000, label: "scripted answer spoken via mock TTS" },
  );
  const s2Chip = await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "listening" ? chip : false;
    },
    { timeoutMs: 10_000, label: "chip back to listening after utterance onend" },
  );
  check("S2b final transcript sent as prompt; scripted answer spoken; chip returns to listening", !!s2Chip, `spoken=${JSON.stringify(await spokenTexts())}`);
  await screenshot("s2b-spoken.png");

  // === Scenario 3: question answer -> single silence event ====================
  const silenceMarker = "[Conversation mode: the user stayed silent for 8s";
  const s3LogBefore = (await readLog()).length;
  await emitFinal("voice test question please");
  await waitFor(
    async () => (await spokenTexts()).includes("Should we proceed with the next step?"),
    { timeoutMs: 10_000, label: "question answer spoken" },
  );
  const spokenAfterQuestion = await spokenTexts();
  check("S3a assistant question spoken and ends with '?'", spokenAfterQuestion[spokenAfterQuestion.length - 1].endsWith("?"), `last spoken=${JSON.stringify(spokenAfterQuestion[spokenAfterQuestion.length - 1])}`);
  await waitFor(
    async () => {
      const entries = (await readLog()).slice(s3LogBefore);
      return transcriptCommands(entries).some((entry) => entry.type === "prompt" && entry.message.startsWith(silenceMarker));
    },
    { timeoutMs: 11_000, intervalMs: 250, label: "silence event prompt after 8s of no speech" },
  );
  await delay(3_000);
  const silenceEvents = transcriptCommands(await readLog()).filter((entry) => entry.message.startsWith(silenceMarker));
  check("S3b exactly one silence event fired (none repeated 3s later)", silenceEvents.length === 1, `count=${silenceEvents.length}`);
  await screenshot("s3-silence.png");

  // === Scenario 4: interruption during tool phase is queued ===================
  const s4LogBefore = (await readLog()).length;
  await emitFinal("voice test tool run");
  await waitFor(
    async () => (await readLog()).slice(s4LogBefore).some((entry) => entry.direction === "event" && entry.type === "tool_execution_start"),
    { timeoutMs: 10_000, label: "tool_execution_start emitted" },
  );
  await delay(500); // ~500ms into the 1500ms tool window
  await emitFinal("wait stop that");
  await delay(400); // still inside the tool window (~900ms in)
  const s4During = (await readLog()).slice(s4LogBefore);
  const s4ToolEndSeenDuring = s4During.some((entry) => entry.direction === "event" && entry.type === "tool_execution_end");
  const s4QueuedLeaked = transcriptCommands(s4During).some((entry) => entry.message.includes("wait stop that"));
  const s4ChipDuring = await chipState();
  check(
    "S4a interruption during tool window is queued (no prompt/steer sent; chip interrupting)",
    !s4ToolEndSeenDuring && !s4QueuedLeaked && s4ChipDuring?.state === "interrupting",
    `toolEndSeen=${s4ToolEndSeenDuring} leaked=${s4QueuedLeaked} chip=${s4ChipDuring?.state}`,
  );
  await screenshot("s4a-queued.png");

  await waitFor(
    async () => transcriptCommands((await readLog()).slice(s4LogBefore)).some((entry) => entry.message.includes("wait stop that")),
    { timeoutMs: 10_000, label: "queued interruption flushed after tool phase" },
  );
  const s4Entries = (await readLog()).slice(s4LogBefore);
  const s4ToolEndIndex = s4Entries.findIndex((entry) => entry.direction === "event" && entry.type === "tool_execution_end");
  const s4FlushIndex = s4Entries.findIndex((entry) => entry.direction === "command" && (entry.type === "prompt" || entry.type === "steer") && entry.message.includes("wait stop that"));
  const s4FlushEntry = s4Entries[s4FlushIndex];
  check(
    "S4b queued text delivered after tool_execution_end",
    s4ToolEndIndex !== -1 && s4FlushIndex > s4ToolEndIndex,
    `deliveredAs=${s4FlushEntry?.type} message=${JSON.stringify(s4FlushEntry?.message)}`,
  );
  await waitFor(
    async () => (await readLog()).slice(s4LogBefore).some((entry) => entry.direction === "event" && entry.type === "agent_end"),
    { timeoutMs: 10_000, label: "tool flow agent_end" },
  );
  await delay(500);
  const s4Spoken = await spokenTexts();
  const s4ToolAnswerSpoken = s4Spoken.includes("The tool has finished.");
  // Observation only: with a scripted fixture agent_end always follows, so the
  // controller (queue already flushed at tool end) speaks the fetched answer.
  console.log(`S4 observation: queued flush deliveredAs=${s4FlushEntry?.type}; "The tool has finished." spoken=${s4ToolAnswerSpoken}`);
  await screenshot("s4b-flushed.png");
  await waitFor(
    async () => {
      const chip = await chipState();
      return chip && (chip.state === "listening" || chip.state === "answering");
    },
    { timeoutMs: 10_000, label: "voice loop settled after tool flow" },
  );

  // === Scenario 5: interruption while final text is streaming -> steer ========
  const s5LogBefore = (await readLog()).length;
  await emitFinal("voice test slow start");
  await waitFor(
    async () => (await readLog()).slice(s5LogBefore).some((entry) => entry.direction === "event" && entry.type === "message_start"),
    { timeoutMs: 10_000, label: "slow flow streaming started" },
  );
  await delay(800); // mid-stream (deltas continue for ~2.5s)
  await emitFinal("actually never mind");
  await waitFor(
    async () =>
      transcriptCommands((await readLog()).slice(s5LogBefore)).some(
        (entry) => entry.type === "steer" && entry.message.includes("[Voice interruption:") && entry.message.includes("actually never mind"),
      ),
    { timeoutMs: 10_000, label: "steer command with voice interruption prefix" },
  );
  const s5Entries = (await readLog()).slice(s5LogBefore);
  const s5SteerIndex = s5Entries.findIndex((entry) => entry.direction === "command" && entry.type === "steer" && entry.message.includes("actually never mind"));
  const s5AgentEndIndex = s5Entries.findIndex((entry) => entry.direction === "event" && entry.type === "agent_end");
  check(
    "S5 mid-stream interruption sent as steer with [Voice interruption:] prefix while streaming",
    s5SteerIndex !== -1 && (s5AgentEndIndex === -1 || s5SteerIndex < s5AgentEndIndex),
    `steerIndex=${s5SteerIndex} agentEndIndex=${s5AgentEndIndex} message=${JSON.stringify(s5Entries[s5SteerIndex]?.message)}`,
  );
  await screenshot("s5-interrupt.png");
  await waitFor(
    async () => (await readLog()).slice(s5LogBefore).some((entry) => entry.direction === "event" && entry.type === "agent_end"),
    { timeoutMs: 10_000, label: "slow flow agent_end" },
  );
  await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "listening";
    },
    { timeoutMs: 10_000, label: "listening again after slow flow" },
  );

  // === Scenario 6: pause / resume via chip click ===============================
  await page.click("#conversationModeChip");
  await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "paused";
    },
    { timeoutMs: 5_000, label: "chip paused after click" },
  );
  const s6PausedRecognitions = await recognitionSnapshot();
  const s6LogBefore = transcriptCommands(await readLog()).length;
  await emitFinal("this transcript must be dropped while paused");
  await delay(1_200);
  const s6LogAfter = transcriptCommands(await readLog()).length;
  check(
    "S6a chip click pauses: recognition aborted and paused transcripts are dropped",
    s6PausedRecognitions.every((item) => !item.running) && s6LogAfter === s6LogBefore,
    `recognitions=${JSON.stringify(s6PausedRecognitions)} newTranscriptCommands=${s6LogAfter - s6LogBefore}`,
  );
  await screenshot("s6a-paused.png");
  await page.click("#conversationModeChip");
  await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "listening";
    },
    { timeoutMs: 5_000, label: "chip listening after resume click" },
  );
  const s6ResumedRecognitions = await recognitionSnapshot();
  check("S6b chip click resumes listening (recognition restarted)", s6ResumedRecognitions.some((item) => item.running), `recognitions=${JSON.stringify(s6ResumedRecognitions)}`);
  await screenshot("s6b-resumed.png");

  // === Scenario 7: microphone permission denied ================================
  const s7Before = await recognitionSnapshot();
  await page.evaluate(() => window.__voiceMocks.emitRecognitionError("not-allowed"));
  await waitFor(
    async () => {
      const chip = await chipState();
      return chip && chip.state === "error";
    },
    { timeoutMs: 5_000, label: "chip error after not-allowed" },
  );
  await delay(600); // give any (wrong) auto-restart a chance to happen
  const s7After = await recognitionSnapshot();
  const s7NoRestart = s7After.every((item, index) => !item.running && item.startCount === s7Before[index]?.startCount);
  const s7ErrorShown = await page.$eval("#eventLog", (el) => (el.textContent || "").includes("Microphone access was denied")).catch(() => false);
  check("S7 not-allowed: chip error, recognition not restarted, visible error message", s7NoRestart && s7ErrorShown, `recognitions=${JSON.stringify(s7After)} errorShown=${s7ErrorShown}`);
  await screenshot("s7-error.png");

  // === Scenario 8: end conversation ============================================
  const s8LogBefore = (await readLog()).length;
  await page.click("#conversationModeEndButton");
  await waitFor(
    async () =>
      (await readLog())
        .slice(s8LogBefore)
        .some((entry) => entry.direction === "command" && entry.type === "prompt" && /^\/(talk|voice|conversation)\s+off/.test(entry.message || "")),
    { timeoutMs: 10_000, label: "'/talk off' RPC prompt from conversation-mode disable" },
  );
  await waitFor(
    async () => {
      const chip = await chipState();
      const endHidden = await page.$eval("#conversationModeEndButton", (el) => el.hidden).catch(() => true);
      return chip?.hidden === true && endHidden === true;
    },
    { timeoutMs: 10_000, label: "chip and end button hidden after disable" },
  );
  const s8Recognitions = await recognitionSnapshot();
  check("S8 end conversation: /talk off sent, chip+end button hidden, recognition stopped", s8Recognitions.every((item) => !item.running), `recognitions=${JSON.stringify(s8Recognitions)}`);
  await screenshot("s8-ended.png");

  console.log(`voice module interception count: ${voiceModuleInterceptions}`);
  if (pageErrors.length) console.warn(`page errors observed (informational): ${JSON.stringify(pageErrors.slice(0, 10))}`);
} catch (error) {
  failed = true;
  check("driver completed without unexpected errors", false, error?.message || String(error));
} finally {
  await shutdown();
}

const summary = {
  when: new Date().toISOString(),
  port,
  workDir,
  logFile,
  chrome: chromePath,
  checks,
  passed: !failed && checks.every((item) => item.pass),
};
await writeFile(path.join(workDir, "voice-browser-validation-results.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nresults: ${summary.passed ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks.filter((item) => item.pass).length}/${checks.length})`);
console.log(`results json: ${path.join(workDir, "voice-browser-validation-results.json")}`);
process.exit(summary.passed ? 0 : 1);
