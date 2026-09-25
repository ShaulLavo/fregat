# Scripted UI replays: tools and libraries

Survey for [Plan 155](../../plans/155-site-demo-replica.md), 2026-09-25. What exists for playing a
scripted copy of an app on a landing page. Sizes are measured: the file served by jsDelivr for the
version shown, `gzip -9`. Licences come from the npm registry. Activity comes from the GitHub API
(`pushed_at`).

The hero has four panes (files, editor, terminal, agents), and each pane has a different best tool.
So the survey is grouped by what a tool can drive.

## Whole-page replays

| Tool                                                   | Licence                                                | Weight                                                      | What it does                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [rrweb](https://github.com/rrweb-io/rrweb) 2.1.6       | MIT                                                    | `@rrweb/replay` 62 KB gz (min), `rrweb-player` UI +29 KB gz | Records a real page as a DOM snapshot plus mutation events, and rebuilds it in a sandboxed iframe on replay. 20k stars, active.                             |
| [reelscript](https://github.com/trevin-lee/reelscript) | MIT                                                    | output is MP4/GIF                                           | TypeScript timeline (`goto`, `moveTo`, `click`, `type`, `terminal.run`, `say`) drives Playwright, with timers and rAF virtualised for determinism. 0 stars. |
| [aidemo](https://github.com/tandryukha/aidemo)         | MIT                                                    | output is MP4/GIF                                           | `storyboard.json` of Playwright actions plus narration, rendered to video. Built for coding agents to author. Re-renders in CI.                             |
| [Remotion](https://www.remotion.dev) 4.0.529           | own licence (a company licence above a size threshold) | `@remotion/player` 26 KB gz plus React                      | Videos written as React compositions. The player can run them live in the page.                                                                             |
| Arcade, Storylane, Navattic, Supademo                  | SaaS                                                   | their hosted embed                                          | Capture a real app's DOM into hosted click-through demos. Hosted, tracked, per-seat pricing.                                                                |

**rrweb is the only drift-proof whole-page option that stays DOM.** Record the real demo build
driven by a Playwright script, then replay the events on the site. The look can never drift: a
re-record picks up every change. It fails on our app in two places, measured in
[plan 155's findings](../../plans/155-site-demo-replica.md#research-findings-2026-09-25):

- the terminal is a WebGPU canvas (ghostty-webgpu), which rrweb records only as sampled image
  frames (`recordCanvas`), so the terminal pane becomes a slideshow or goes blank;
- the snapshot carries every stylesheet the app has loaded, inlined into the first event. On the
  garden demo that first event alone is 576 KB raw / 93 KB gz, before any story.

The video tools (reelscript, aidemo, VHS below) are the video option. A few hundred KB to a few MB
of H.264 buys pixel fidelity and a CI re-render. The cost is text you cannot select, blur on HiDPI
unless the file is large, and no final-frame handling under reduced motion beyond a poster image.

## Terminal panes

| Tool                                                                     | Licence    | Weight                           | Notes                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [asciinema-player](https://github.com/asciinema/asciinema-player) 3.17.0 | Apache-2.0 | 65 KB gz                         | Plays `.cast` recordings (timed ANSI output) in its own VT. Real captures of `claude` or `codex` would play verbatim. Active.                   |
| [svg-term-cli](https://github.com/marionebl/svg-term-cli) 2.1.1          | MIT        | **0 KB JS**, the SVG is the file | Converts a `.cast` into one animated SVG (CSS keyframes). Loops on its own. Last push 2024-05. A static `<img>`, so play state cannot be gated. |
| [VHS](https://github.com/charmbracelet/vhs)                              | MIT        | output is GIF/MP4/WebM           | `.tape` scripts (`Type`, `Sleep`, `Enter`) drive a real terminal. 21k stars, active. A video, so the text cannot be selected.                   |
| [brainless](brainless.md)                                                | MIT        | about 0 once ported              | Hand-tuned HTML copies of the Claude Code and Codex TUIs, checked against real tmux captures. Already surveyed.                                 |
| Magic UI [Terminal](https://magicui.design/docs/components/terminal)     | MIT        | React + `motion`                 | Typed lines with a staggered reveal. Its shape (children animate in sequence) is all we would take.                                             |

## Editor panes

| Tool                                                            | Licence            | Weight                                     | Notes                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro `<Code>` (Shiki at build time)                            | MIT                | 0 KB JS                                    | Already in Astro 5. Tokens become inline-styled spans at build time.                                                                                                                                                                                |
| [`@shikijs/magic-move`](https://github.com/shikijs/shiki) 4.4.3 | MIT                | `core.mjs` 8 KB + `renderer.mjs` 12 KB raw | Animates one highlighted snippet into the next, with tokens that move, fade and enter. Tokens can be computed at build time, so Shiki itself never ships. The old `shiki-magic-move` repo is archived; the package now lives in the Shiki monorepo. |
| typed.js 3.0.0, TypeIt 8.8.7                                    | **GPL-3.0** (both) | 3–5 KB gz                                  | Typewriter effects. The licence rules them out for an MIT site, and typing a string is ten lines of code anyway.                                                                                                                                    |

The strongest editor effect is the agent's edit landing: a diff appearing in the open file, which
magic-move does in one call. Typing, a moving cursor and a scrolling editor are plain DOM work.

## Timeline engines

| Tool                                                      | Licence                                | Weight                                                                 | Notes                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web Animations API + CSS                                  | platform                               | 0 KB                                                                   | `element.animate()` returns a controllable `Animation`; CSS keyframes pause through `animation-play-state`.                                                  |
| [Motion](https://motion.dev) 13.4.4                       | MIT                                    | full UMD 49 KB gz; a smaller `motion/mini` entry exists (not measured) | `animate([...sequence])` timelines. The owner's rule is CSS first and Motion only where CSS cannot do the job ([README](README.md#decisions-for-the-owner)). |
| [GSAP](https://gsap.com) 3.15.0                           | "standard no-charge" licence (not OSI) | 28 KB gz                                                               | The strongest timeline API (labels, nesting, `seek`). Free, but the licence is proprietary.                                                                  |
| [Theatre.js](https://github.com/theatre-js/theatre) 0.7.2 | core Apache-2.0, studio AGPL-3.0       | core 50 KB gz                                                          | Keyframe editor for 3D and DOM. Last push 2024-08.                                                                                                           |
| lottie-web 5.13.0, Rive canvas-lite 2.43.1                | MIT                                    | 46 KB gz, 94 KB gz (+wasm)                                             | Designer-authored vector animation. Text and code become shapes, so neither fits a UI replica.                                                               |

## What the landing pages we compared do

The same pattern shows up twice in code we can read:

- **cursor.com** is a DOM replica driven by data. Full teardown in [cursor-demo.md](cursor-demo.md).
  Agents and scripts are plain objects (`{ steps: [{ kind: 'pause', ms }, { kind: 'message', … }] }`),
  playback is a `setTimeout` chain, and an `isPlaying` context carries the IntersectionObserver
  verdict down to every pane.
- **t3code's marketing site** (`references/t3code/apps/marketing`, 7a12aff4) is Astro with no
  framework, like ours. Its hero is a still screenshot (`app-desktop.webp`). All its motion is CSS
  keyframes, and one 95-line module (`src/lib/homeMotion.ts`) gates it: it writes
  `--home-motion-state: running | paused` from an IntersectionObserver, `document.visibilityState`
  and `prefers-reduced-motion`, and the CSS reads that variable as `animation-play-state`.

The other products' pages are covered in [landing-replicas.md](landing-replicas.md).

## Verdict for the site

No library covers all four panes. The build that fits is our own player of about 150 lines, run
over the Web Animations API and CSS, with t3code's play-state gating and Cursor's data-shaped
script. Two pieces are worth borrowing:

1. **`@shikijs/magic-move`** (MIT, about 20 KB raw) for the editor's diff landing, with tokens
   precomputed at build time. Optional, and the first thing to drop if the size budget is tight.
2. **brainless's TUI markup** for the terminal pane, ported to `.astro`, as brainless.md already
   recommends.

rrweb is the fallback if drift turns out to matter more than weight. The measurements in the plan
say what it would cost.
