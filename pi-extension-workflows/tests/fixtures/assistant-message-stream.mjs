if (process.argv.includes("final-stop")) {
  process.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "concise final answer" }],
      usage: { input: 2, output: 3 },
      stopReason: "stop",
    },
  })}\n`);
  process.exit(0);
}

if (process.argv.includes("final-error")) {
  process.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "partial provider failure" }],
      usage: { input: 2, output: 1 },
      stopReason: "error",
      errorMessage: "provider failed",
    },
  })}\n`);
  process.exit(0);
}

if (process.argv.includes("no-newline-budget")) {
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "trailing partial" }],
      usage: { input: 2, output: 1 },
    },
  }));
  process.exit(0);
}

const messages = [
  { text: "partial turn one", usage: { input: 2, output: 3 } },
  { text: "partial turn two", usage: { input: 2, output: 3 } },
  { text: "partial turn three", usage: { input: 2, output: 3 } },
];

let index = 0;
const timer = setInterval(() => {
  const message = messages[index++ % messages.length];
  process.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: message.text }],
      usage: message.usage,
    },
  })}\n`);
}, 20);

timer.unref?.();
setInterval(() => {}, 1_000);
