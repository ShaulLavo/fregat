# Plan 155: The site demo becomes an animated replica

## Status and authorization

- Status: PLACEHOLDER — the owner wants it; the research that turns it into phases has not
  started. Nothing here authorizes implementation.
- Priority: P3. The site is not live.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Origin: the UI library survey
  ([docs/ui-research/brainless.md](../docs/ui-research/brainless.md)).

## Outcome

The site hero stops running the real app. It shows an animated copy of the fregat workbench, the
way cursor.com's hero shows an animated copy of Cursor's UI rather than Cursor itself. The copy
plays a scripted story (files, editor, terminal, agents), loads in kilobytes instead of megabytes,
loops, pauses off-screen and holds a final frame under reduced motion.

## What exists today

- `apps/site` is Astro 5 with no React and no Tailwind: one page (`src/pages/index.astro`), one
  component, hand-written `styles/global.css`, deployed to GitHub Pages at `/fregat`.
- The hero (`#demo-frame`, `index.astro:84`) is an iframe of the whole web app built in
  `--mode demo`. `scripts/build-site.ts` builds `apps/web/demo.html` against the MSW handlers in
  `apps/web/src/demo/` (a simulated workspace, orchestration and terminal). The output is 31 MB,
  26 MB of it JS in 455 assets, plus the ghostty wasm and a service worker.
- The `#agents` section already fakes two sessions ("claude code", "codex") as static `<ol>`
  markup, which is a hand-made, low-fidelity replica.
- `index.astro:14` has a leftover `console.log('dsdsd')`.

## Research phase (turns this placeholder into phases)

1. **Tear down cursor.com's demo.** How it is built (DOM, canvas or video), how its timeline is
   scripted, what story it tells, how much it weighs, whether any of it is interactive, and how it
   behaves off-screen and under reduced motion.
2. **Survey what else exists.** brainless is one good find: MIT, dependency-free HTML replicas of
   the Claude Code, Codex and Grok terminal screens, and a fit for the agent panes. More is
   needed: other products' landing-page replicas and any libraries or tools for scripted UI
   replays. Write each find up in `docs/ui-research/`, like the rest of the survey.
3. **Choose the build.** Candidates so far:
   - Astro markup plus one small vanilla player script. This was option B in `brainless.md`:
     no React on the site, the components are small enough to own.
   - React islands with `@astrojs/react`, about 45 KB gz.
   - Render the real `packages/ui` primitives to static HTML at build time and animate that. This
     is the only option where the replica cannot drift from the app's look, and the research
     should say what it costs.
4. **Write the script.** Decide which story the hero tells and what each pane does, in order.
5. **Decide what happens to the real demo:** kept behind a "try it live" click, moved to its own
   page, or dropped along with `apps/web/src/demo/` and the demo build.

## Open questions

- Keep the live demo at all? It costs a whole MSW backend kept in step with the app.
- How does the replica keep up when the app's look changes: shared tokens from `packages/ui`,
  real primitives rendered at build time, or accepted drift with a periodic refresh?
- Does the replica use physical mode's feel ([Plan 154](154-physical-mode.md)) to show it off?
