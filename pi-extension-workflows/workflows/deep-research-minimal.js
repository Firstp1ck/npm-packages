export const meta = {
  name: "deep-research-minimal",
  description: "Research, verify, and summarize a topic using staged read-only agents.",
  phases: ["scout", "synthesis"],
  pi: {
    version: 1,
    maxConcurrency: 3,
    maxAgents: 4,
    permissions: { write: false, shell: false, network: false }
  }
}

if (!args || typeof args.topic !== "string" || !args.topic.trim()) {
  throw new TypeError("args.topic must be a non-empty string")
}

const topic = args.topic.trim()
const findings = await phase("scout", () => parallel([
  () => agent(`Find official documentation or primary local source files relevant to: ${topic}. Return paths, short snippets, and gaps. Do not modify files.`, {
    label: "official-docs",
    tools: ["read", "grep", "find", "ls"]
  }),
  () => agent(`Find concrete implementation examples in the current repository relevant to: ${topic}. Return exact paths, symbols, and what each file proves. Do not modify files.`, {
    label: "implementation-evidence",
    tools: ["read", "grep", "find", "ls"]
  }),
  () => agent(`Review local evidence for risks, missing prerequisites, safety constraints, and likely failure modes for: ${topic}. Do not modify files.`, {
    label: "risk-scan",
    tools: ["read", "grep", "find", "ls"]
  })
], { concurrency: 3 }))

return await phase("synthesis", () => agent(
  `Synthesize these independent findings into a concise implementation-ready report for: ${topic}. Include evidence paths, decisions, risks, and next steps.\n\n${JSON.stringify(findings)}`,
  {
    label: "summarize",
    tools: ["read", "grep", "find", "ls"]
  }
))
