# cursor.com's hero demo: teardown

For [Plan 155](../../plans/155-site-demo-replica.md), 2026-09-25. Measured against the live
`https://cursor.com/` (deployment `dpl_25ZiZH3Puy4JARfynVpaJVNjVHRX`) in headless Chromium 1440×900
(Playwright 1.63). Byte counts are CDP `encodedDataLength`, meaning bytes on the wire. The probe
scripts and screenshots are in `/work/tmp/research/155/`, which is scratch and not kept.

## How it is built

**DOM, rendered on the server, with no canvas and no video.** The hero is ordinary React markup
styled with Tailwind theme tokens (`bg-theme-product-editor`, `text-theme-text-sec`,
`agent-sidebar__row`). The page ships the first frame already in the HTML: the document is 627 KB
raw, 125 KB gzipped and 72 KB on the wire. The DOM holds six demo roots
(`[data-demo-desktop-content]`), with 484 elements in the hero section. The page has no `<canvas>`,
and its only `<video>` is the 22-px animated logo. Each root carries a screen-reader description
("This element contains an interactive demo for sighted users…"). The site is Next.js with
Turbopack, compiled by the React Compiler (the chunks contain `react.memo_cache_sentinel` caches).

**Two overlapping windows over a painted wallpaper:**

- _Cursor Desktop_: an agent sidebar (`In progress` / `Ready for review` groups), a chat transcript
  (prompt, `Read about-acme.md`, `Thought 6s`, file cards with `+52 −0`, a summary) and a browser
  preview of `localhost:3000` showing "Acme Labs", the site the agent just built. An
  element-inspector highlight (`Tagline · span`, `IntroParagraph · p`, `CTAButton · button`) walks
  across that preview.
- _Cursor CLI_: a terminal window, bottom right, with a prompt, "Thinking", a streamed answer and a
  working composer (`/ for commands · @ for files`).

## The story, measured frame by frame

Screenshots every 0.5–1.5 s:

| t     | What moves                                                                                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 s   | Two agents run under "In progress": _Build Landing Page_ ("Reading docs") and _Plan Mission Control_ ("Generating plan"). The CLI shows a long prompt and `Thinking 4 tokens`.                                                               |
| ~2 s  | _Build Landing Page_ finishes. Its transcript fills in (reads, thought, two file cards, summary) and it moves to "Ready for review". The CLI starts streaming its answer.                                                                    |
| ~6 s  | _Plan Mission Control_ finishes. The view switches to it: a plan document (`feature-prd.md`, "Mission Control Interface"), a "Build" button and a multiple-choice **Questions** card. The composer mode chip changes from _Agent_ to _Plan_. |
| ~10 s | The view returns to _Build Landing Page_. The CLI answer is complete.                                                                                                                                                                        |
| after | Ambient motion only: the inspector highlight keeps moving across the preview. The story does not loop.                                                                                                                                       |

DOM mutations inside the hero section, cumulative every 0.5 s:
`36, 161, 345, 487, 555, 571, 571, 571, 577, 641, 657, 673, 706, 730, 730, 730, 730, 815, 871, …`.
Most of the work lands in the first 2 s, with a second burst around 8 s. Instrumented
`requestAnimationFrame` calls stop growing after about 8 s (194 in total), so frames are not
driven by rAF. The story runs on `setTimeout` chains and CSS transitions.

What it tells: **agents working in parallel, finishing on their own, with the result visible
(a built page, a plan with questions)**. There is no typing and no cursor sprite. The one thing
typed out is the CLI's answer, and it is streamed rather than typed.

## How the timeline is scripted

The demo is **data plus small players**. There is no general timeline engine. From the shipped
chunks (downloaded from the same deployment and read minified):

- **Agents are records.** A chunk of 94 KB raw / 27 KB gz holds objects such as
  `{ id: 'product-planning-demo', title: 'Plan Mission Control', repoName: 'acme-saas', defaultMode: 'plan', questions: [...], messages: [...], openFileIds: [...], activeFileId: 'browser-preview', diffSummary: { added: 70, removed: 0 } }`.
- **Scripts are step lists.** Another chunk holds about 20 of them, shaped
  `{ triggers: [], steps: [{ kind: 'pause', ms: 250 }, { kind: 'message', content, pending: { state: 'spawning', label: 'Spawning' } }] }`.
  The step kinds seen are `send-message`, `message`, `pause`, `system`, `multiple-choice`,
  `computer-use`, `pull-request` and `outbound-message`. Each hero has two named states,
  `HERO_DEMO_CONTENT` and `HERO_DEMO_END_CONTENT`, plus an `applyEndState(end)` call.
- **One small sequence hook drives the ambient loops.** It takes `[{ state, ms }]` and options
  `{ enabled, loopFrom, restState, wallClockPhase }`, and advances by `setTimeout(next, step.ms)`.
  `wallClockPhase` derives the current step from `Date.now()`, so two copies on a page stay in
  step, and `loopFrom` loops back to an index other than 0.
- **The CLI pane streams its lines in an `async` loop.** The loop starts only once the pane is
  first seen at 15% visibility (IntersectionObserver thresholds `[0.15, 0.35]`) and runs once.

## Off-screen, reduced motion, interaction

- **Off-screen.** An `IntersectionObserver` result reaches the panes through a React context,
  `DemoPlaybackProvider { isPlaying }`. The sequence hook runs only while `enabled` (in view). With
  the page scrolled 4000 px down, the hero made 22 DOM mutations in 5 s. Lower sections animating
  at the same moment made 21,876.
- **Reduced motion.** The hero's controller checks `matchMedia('(prefers-reduced-motion: reduce)')`
  and calls `applyEndState(HERO_DEMO_END_CONTENT)`, which jumps straight to the final frame.
  Measured with `reducedMotion: 'reduce'`: 176 mutations in the first 0.5 s (the end state landing
  at once), then 344 over 12 s against 881 without it. The ambient pieces (inspector highlight,
  view switch) still move, so this is "final frame plus ambient", not a still.
- **Interaction.** A `pointerdown` listener in the capture phase on the demo also calls the end
  state: touching the demo skips the story and hands over a settled UI. The hero section has 17
  buttons and 2 inputs. The CLI composer has a working slash menu (`/model` lists models and
  filters by prefix). A forced click on a sidebar row did not change the transcript text, so the
  sidebar is decorative.

## Weight

| What                                                 | Wire bytes                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Whole page                                           | 6.9 MB: 3.5 MB script, 1.9 MB image, 790 KB font, 75 KB HTML |
| Wallpaper behind the demo (`cursor-wallpaper.png`)   | **1.46 MB** (one PNG)                                        |
| Chunks that mention the demo's names (11 of 79)      | 924 KB raw, **269 KB gz**                                    |
| First-party script chunks (79, `/marketing-static/`) | 2.3 MB on the wire (8.5 MB raw)                              |
| Other scripts (analytics proxy, GTM, Meta, TikTok)   | 1.1 MB on the wire                                           |

The 269 KB is an upper bound for the demo's code, because those chunks also carry other page
content. It still sits on top of React and Next. **Cursor's replica is cheap for Cursor, but it is
not kilobytes.** The part worth copying is the shape, not the stack.

## What to take

1. **Render the first frame into the HTML.** With no JS the hero is still a complete, correct
   picture. For us that means Astro markup.
2. **Data-shaped script with named end states.** A story is a list of steps over a model of the
   panes. `end` is a real state rather than "whatever the last step left", so reduced motion and
   "skip" both jump to it.
3. **Gate on visibility.** Play only while in view, and start the story the first time it is seen,
   not at page load.
4. **Stream the agent, do not type it.** Agents' output streams in chunks, and only the user's
   prompt is typed.
5. **Parallel agents finishing on their own is the pitch.** It matches ours ("claude code and
   codex, side by side").

What not to take: the non-looping story (a visitor who scrolls back finds a static page, which is
fine for them and wrong for us), the 1.46 MB PNG wallpaper, and pulling in the whole app framework
to draw a picture.
