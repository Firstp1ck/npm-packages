export const meta = { name: "template-audit", description: "Audit a repository with parallel read-only reviewers", pi: { maxConcurrency: 3, maxAgents: 4 } }
const topic = String(args.topic || "the current repository")
const findings = await phase("audit", () => parallel([
  () => agent(`Inspect implementation risks for ${topic}`, { label: "implementation", tools: ["read", "grep", "find", "ls"] }),
  () => agent(`Inspect tests and coverage gaps for ${topic}`, { label: "tests", tools: ["read", "grep", "find", "ls"] }),
  () => agent(`Inspect security boundaries for ${topic}`, { label: "security", tools: ["read", "grep", "find", "ls"] })
], { concurrency: 3 }))
return await agent(`Synthesize this audit:\n${JSON.stringify(findings)}`, { label: "synthesis", tools: ["read"] })
