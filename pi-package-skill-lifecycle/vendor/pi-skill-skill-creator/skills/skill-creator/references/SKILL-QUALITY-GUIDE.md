# Skill Quality Guide

A generated skill is good when it makes the agent follow a predictable process with the least necessary context.

## Authoring quality gate

Before considering a draft ready for review, check these levers:

1. **Invocation mode**
   - Use model invocation when the agent or another skill should discover the skill automatically.
   - Use user invocation (`disable-model-invocation: true`) when only the human should intentionally call it.
   - For model-invoked skills, the description is a routing trigger, not a summary paragraph.

2. **Description discipline**
   - Front-load the leading word or domain that should trigger the skill.
   - Keep one trigger per branch; remove synonym-only duplicates.
   - Avoid broad catch-alls such as "general", "misc", or "helps with anything".

3. **Information hierarchy**
   - Keep ordered actions in `SKILL.md`.
   - Keep only reference needed by every invocation inline.
   - Move branch-specific or long-form reference to `references/*.md` and link it with a clear context pointer.

4. **Completion criteria**
   - Every workflow step should end with a checkable completion criterion.
   - Prefer observable criteria: files inspected, tests run, output written, risks reported.
   - Avoid vague endings such as "make sure it works" unless backed by a concrete check.

5. **Pruning pass**
   - Remove no-ops: lines that do not change behavior versus the default agent behavior.
   - Remove duplication: one meaning should have one source of truth.
   - Remove sediment: stale context from the source trajectory.
   - Split or disclose reference when the top-level skill sprawls.

## Review checklist

- [ ] Invocation mode is deliberate and encoded in frontmatter.
- [ ] Description has concrete triggers and no broad catch-all wording.
- [ ] Trigger branches are explicit, with should-trigger and should-not-trigger examples.
- [ ] Workflow steps include completion criteria.
- [ ] Long or branch-specific reference is disclosed under `references/`.
- [ ] No no-op, duplicated, stale, private, or secret material remains.
- [ ] Verification proves the generated skill can be reviewed safely before enablement.
