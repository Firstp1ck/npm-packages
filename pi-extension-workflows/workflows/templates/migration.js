export const meta = { name: "template-migration", description: "Plan a migration from current code and tests", pi: { maxConcurrency: 2, maxAgents: 3 } }
const target = String(args.target || "the requested target")
const analysis = await parallel([
  () => agent(`Map current implementation relevant to migrating to ${target}`, { label: "current", tools: ["read", "grep", "find", "ls"] }),
  () => agent(`Map compatibility and rollback risks for migrating to ${target}`, { label: "risks", tools: ["read", "grep", "find", "ls"] })
])
return await agent(`Create a staged migration and verification plan for ${target}:\n${JSON.stringify(analysis)}`, { label: "plan", tools: ["read"] })
