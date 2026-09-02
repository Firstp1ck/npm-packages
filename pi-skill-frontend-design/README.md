# Frontend design

Give a new or existing web interface a visual direction that comes from its subject instead of a familiar AI template.

## Helpful when

- You are building a landing page, product interface, portfolio, or other web UI from a loose brief.
- An existing design works but looks generic, overdecorated, or disconnected from its content.
- You need firm choices for typography, palette, layout, motion, and interface copy before writing code.

## What to share with Pi

- The product, audience, and single job of the page.
- Existing UI code, brand rules, content, screenshots, and technical constraints.
- Anything that must stay, plus the parts where Pi may take a real design risk.

## Try asking

> Redesign this independent cinema homepage. Keep the booking flow and existing content, avoid the usual cream-and-serif treatment, and make the film schedule the element people remember.

## What you'll get

- A compact plan for color, type, layout, and one signature element.
- Visual choices tied to the brief rather than reusable design defaults.
- A self-critique before implementation, with generic choices revised or removed.
- UI work that accounts for mobile layouts, keyboard focus, reduced motion, and useful interface copy.

## Keep in mind

When the brief leaves the subject unclear, the skill chooses a concrete subject, audience, and page goal before designing. State fixed brand requirements and accessibility constraints up front if Pi must not fill those gaps.

The package contains instructions only. It does not add executable scripts or dependencies. Screenshot capture, browser testing, and code changes still depend on the tools available in your Pi session.

## Install

```bash
pi install npm:@firstpick/pi-skill-frontend-design
```

Pi can load the skill automatically for matching frontend work. You can also invoke it directly with `/skill:frontend-design` when skill commands are enabled.

## Source and license

Adapted from Anthropic's [`frontend-design` skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design). Licensed under the [Apache License 2.0](LICENSE).

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for activation, workflow, compatibility, safety, and limitations.
