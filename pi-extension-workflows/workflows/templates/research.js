export const meta = { name: "template-research", description: "Research a topic and reconcile independent evidence", pi: { maxConcurrency: 2, maxAgents: 3 } }
const topic = String(args.topic || "")
if (!topic) throw new TypeError("args.topic is required")
const evidence = await parallel([
  () => agent(`Find primary local evidence for ${topic}`, { label: "primary", tools: ["read", "grep", "find", "ls"] }),
  () => agent(`Find contradictory or missing evidence for ${topic}`, { label: "counter", tools: ["read", "grep", "find", "ls"] })
], { concurrency: 2 })
return await agent(`Reconcile evidence for ${topic}:\n${JSON.stringify(evidence)}`, { label: "report", tools: ["read"] })
