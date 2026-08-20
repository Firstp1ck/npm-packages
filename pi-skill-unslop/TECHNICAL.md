# Technical reference: Unslop

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill that rewrites prose to remove AI writing patterns and restore a human voice. It covers 31 numbered patterns across content, language, style, communication artifacts, filler, jargon, and plain speech.

## Install

```bash
pi install npm:@firstpick/pi-skill-unslop
```

## Scope and side effects

The skill is guidance only. It ships no scripts, tools, or dependencies, and loading it does not change any file. Edits happen when you ask Pi to apply them, through the same file tools it always uses.

The `description` field tells agents to apply the skill to all written output. If you only want it on request, say so in the prompt or narrow the trigger in your own copy of `skills/unslop/SKILL.md`.

## Two rules that override common house styles

Pattern 13 bans em dashes and every substitute for them, including parentheses, en dashes, and hyphen-as-dash. Pattern 19 replaces curly quotes with straight quotes. Both are absolute in the skill text. If your style guide requires either, state the exception in your request, because the skill will otherwise rewrite around it.

## Keeping exact strings intact

Nothing in the skill distinguishes prose from a literal. Commands, version pins, error strings, and quoted user text can all be reworded if they sit in a sentence the skill decides to rewrite. Name what must stay byte for byte:

```text
User: Unslop docs/install.md. Do not touch anything inside fenced code blocks, and keep the exact text of the two error messages I quoted.
Agent: Rewrites the prose, reports the patterns it removed, and leaves the fenced blocks and quoted errors unchanged.
```

## Example view

```text
User: Unslop this release note. It currently reads: "This pivotal release underscores our commitment to a seamless developer experience, delivering not just faster builds, but a more intuitive workflow."
Agent: Proposes "Builds are 40% faster. The config file moved to the repo root." and flags that the 40% figure needs a real measurement or should be cut.
```

Notice the second half of the reply. When a claim has no number behind it, pattern 27 asks you to supply one or drop the sentence, so the skill will surface gaps rather than invent figures.

## Compatibility

Portable Agent Skills-style skill, so the `skills/unslop/SKILL.md` file works in any agent that reads that format. No runtime, network access, or toolchain is required.

## Attribution

The pattern list comes from the `unslop` skill in [cursor/plugins](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md), MIT licensed, copyright 2026 Lauren Tan. See [pstack/LICENSE](https://github.com/cursor/plugins/blob/main/pstack/LICENSE) upstream. This package is MIT as well, and [LICENSE](LICENSE) carries both copyright notices.
