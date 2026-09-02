# Technical reference: Frontend design

Advanced user information for the `frontend-design` skill.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Activation

Pi loads the skill automatically when a request involves building or substantially redesigning a web interface. The description names visual direction, typography, layout, motion, and interface copy so requests in those areas can trigger it.

To load it explicitly, enable skill commands in Pi and use:

```text
/skill:frontend-design <your brief>
```

## Inputs

The skill works best with:

- a named product or subject;
- the intended audience and the page's single job;
- real copy, images, data, and domain references;
- existing code and design constraints;
- brand, accessibility, browser, and responsive requirements; and
- screenshots or a running preview when visual inspection tools are available.

If the brief omits the subject, audience, or page goal, the skill chooses them and states the choice before designing.

## Workflow

The skill first grounds the direction in the subject's materials, artifacts, language, and content. It then plans four parts before implementation:

1. Four to six named colors with hex values.
2. Typefaces assigned to display, body, and optional utility roles.
3. A layout concept described in short prose and ASCII wireframes.
4. One signature element that expresses the brief.

Before coding, it checks whether each choice could appear unchanged in a similar project. Generic choices must be revised and explained. The implementation follows the revised plan, then receives another visual critique.

The quality floor includes mobile layouts, visible keyboard focus, and reduced-motion support. These instructions guide implementation but do not replace browser, accessibility, or usability testing.

## Compatibility

- Pi packages that support the `pi.skills` manifest.
- Other Agent Skills-compatible tools that can load a directory containing `SKILL.md`.
- Frontend work in any framework or in plain HTML and CSS.

The package has no runtime dependencies, helper scripts, settings, or network requirements. Its results still depend on the model and tools available in the host environment.

## Safety and privacy

The package itself executes no code. During a design task, the agent may inspect source files, screenshots, or a local preview when the host provides those tools. Normal tool permissions and confirmation rules still apply.

Review generated code before release. In particular, verify keyboard behavior, contrast, responsive layouts, reduced motion, final copy, and any third-party font or image licenses.

## Limitations

- The skill does not generate brand requirements when the brief declares them fixed.
- A screenshot can expose visual problems but cannot prove accessibility or behavior in every viewport.
- The examples of common AI design defaults describe current habits and may need revision as those habits change.
- The skill improves design direction. It cannot guarantee that every model or implementation will execute the plan well.
