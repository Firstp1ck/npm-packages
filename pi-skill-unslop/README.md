# Unslop

Strip the tells that make writing read as AI generated, and put a human voice back in.

## Helpful when

- A README, changelog, or blog post reads smooth but says nothing.
- A PR description is full of "crucial", "seamlessly", and "not just X, but Y".
- You pasted model output somewhere public and want it to sound like a person wrote it.

## What to share with Pi

- The file, message, or block of text to edit
- Who reads it and what you want them to do after reading
- Any house style you have to keep, such as sentence case headings or a banned-word list

## Try asking

> Unslop this README. Keep every command and version number exact, drop the marketing tone, and make the intro sound like I wrote it at my desk instead of a launch page.

## What you'll get

- A rewrite with the same meaning and fewer words
- A short list of what changed and why, such as "cut 6 em dashes" or "named the source instead of 'experts say'"
- Concrete replacements for vague claims, so "significantly faster" becomes the measured number or gets cut

## Keep in mind

The skill edits prose, not code. It leaves identifiers, commands, and quoted material alone, and you should say so explicitly when a block must stay byte for byte.

Two rules are stricter than most style guides. It bans em dashes outright, including the parentheses and en dashes people reach for instead, and it asks for straight quotes over curly ones. Tell Pi upfront if your house style disagrees.

It also adds opinions and first person on purpose. That is the point, but it means the output is a draft to approve rather than a mechanical find and replace.

## Install

```bash
pi install npm:@firstpick/pi-skill-unslop
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-unslop/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
