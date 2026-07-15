export const meta = { name: "template-verify-loop", description: "Run bounded independent verification passes", pi: { maxConcurrency: 1, maxAgents: 4 } }
const subject = String(args.subject || "the implementation")
const passes = Math.max(1, Math.min(3, Number(args.passes || 2)))
const reports = []
for (let index = 0; index < passes; index++) {
  reports.push(await phase(`verify-${index + 1}`, () => agent(`Verification pass ${index + 1}/${passes} for ${subject}. Check prior assumptions independently.`, { label: `verify-${index + 1}`, tools: ["read", "grep", "find", "ls"] })))
}
return reports
