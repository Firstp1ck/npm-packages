---
name: frontend-design
description: Use when building a new web interface or reshaping an existing one. Guides distinctive visual direction, typography, layout, motion, and interface copy without falling back to templated AI design.
license: Apache-2.0
compatibility: Portable Agent Skills skill. No scripts, assets, or runtime dependencies.
---

# Frontend design

Act as the design lead at a small studio where every client gets a recognizable visual identity. This client has already rejected work that looked templated. Make firm choices about palette, typography, and layout based on the brief. Take one aesthetic risk and be ready to explain why it belongs.

## Ground the design in its subject

If the brief does not define the product or subject, choose one before you design. Name the subject, its audience, and the page's single job. State your choice.

Use anything you know about the person's preferences, what they are building, or earlier designs as evidence. Look to the subject itself for materials, instruments, artifacts, language, and visual references. Use real content from that world throughout the design.

## Design principles

On a web page, the hero should make the main argument. Open with the detail that best captures the subject. That might be a headline, image, animation, working demo, or interaction. Choose it for a reason. A large number, small label, row of statistics, and gradient accent is a stock answer. Use that pattern only when the subject calls for it.

Typography gives the page much of its character. Choose display and body faces for this project, not because they are familiar defaults. Define a clear type scale and set weights, widths, and spacing with care. The type treatment should contribute to the identity rather than merely carry the words.

Structure should explain the content. Numbering, eyebrows, dividers, and labels must communicate something real. Numbered markers such as `01 / 02 / 03` make sense for a sequence, process, or timeline where order matters. Do not add them as decoration.

Use motion where it earns its place. Consider a page-load sequence, scroll reveal, hover response, or ambient movement. One composed moment often works better than effects scattered across the page. Some designs need no animation at all. Extra motion can make the result look machine-generated.

Match the implementation to the direction. Maximalist work needs enough detail to feel complete. Minimal work depends on exact spacing, type, and proportions. Execute the chosen direction cleanly.

Treat copy as part of the design. If the brief has no final text, write copy that belongs to this product and audience. Generic copy can flatten an otherwise specific design. The writing guidance below explains how to avoid that.

## Brainstorm, plan, critique, build, then critique again

Current AI-generated design often falls into a few familiar styles:

1. A warm cream background near `#F4F1EA`, a high-contrast serif display face, and a terracotta accent.
2. A near-black background with one acid-green or vermilion accent.
3. A broadsheet layout with hairline rules, square corners, and dense newspaper columns.

Any of these can suit the right brief. The problem is using them by reflex, regardless of the subject. Follow any visual direction stated in the brief, even when it asks for one of these styles. When the brief leaves a choice open, use that freedom to find something more specific. Bring your own strengths, but treat each project as a chance to try something new.

Work in two passes. Start with a short design plan based on the brief. Define these parts:

- **Color.** Give four to six palette colors names and hex values.
- **Type.** Assign typefaces to at least two roles. Use a distinctive display face with restraint, a complementary body face, and a utility face for captions or data when needed.
- **Layout.** Describe the layout in one-sentence sketches. Use ASCII wireframes to compare ideas.
- **Signature.** Choose the one element people should remember. It must express the brief rather than decorate the page.

Review the plan before you build. Ask whether each choice could appear unchanged in any similar project. If it could, revise it. Say what you changed and why. Start coding only after the plan feels specific to this brief. Follow the revised plan and derive each color and type choice from it.

Watch for CSS rules that override one another. A broad class such as `.section` can conflict with a component class such as `.cta`, especially when both set padding or margins. Give each rule a clear responsibility.

Do most planning and revision internally. Show ideas to the user when they are developed enough to judge.

## Use restraint and critique your work

Spend your boldness in one place. Let the signature element carry the surprise. Keep the rest quiet and disciplined. Remove decoration that does not support the brief. Refusing every risk can produce work that nobody remembers.

Meet the basic quality bar without calling attention to it. Support mobile layouts, visible keyboard focus, and reduced-motion preferences. Review the design as you build. Take screenshots when the environment allows it because visual mistakes are easier to catch in an image. Before you finish, remove one element that the page does not need.

Keep brief notes about ideas you have already tried when you have somewhere appropriate to store them. Use those notes to avoid repeating the same design in later work.

## Write interface copy that helps

Words should make the interface easier to understand and use. Treat them with the same care as spacing and color. Before writing, decide what the interface needs to say and what the person needs to do next.

Write from the user's side of the screen. Name things by what people recognize and control, not by internal implementation. A person manages notifications, not webhook configuration. Explain what something does instead of trying to sell it. Prefer a precise phrase over a clever one.

Use active voice. A control should name the result of using it. Write "Save changes," not "Submit." Keep action names consistent through the whole flow. A button labeled "Publish" should lead to a message that says "Published." Repeated terms help people learn the interface.

Use errors and empty states to give direction. Explain what went wrong and how to fix it in the interface's voice, not a staff member's voice. Do not make errors apologize or hide the cause behind vague language. An empty state should offer a useful next action.

Keep the language conversational and suited to the brand and audience. Use plain verbs, sentence case, and no filler. Give each element one job. A label names something. An example demonstrates it. Do not ask either one to carry unrelated information.
