# Plan 155: The site demo becomes an animated replica

## Status and authorization

- Status: PROPOSED — research done 2026-09-25 (findings and proposed phases below). Owner questions answered
  2026-09-26; the phone layout waits on Plan 143. Nothing here authorizes implementation.
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
- Does the replica use physical mode's feel ([physical feel](../docs/physical-feel.md)) to show it off?

## Research findings (2026-09-25)

Read from `origin/main` (9f3438258). The only open PR that touches this file, `lane/L1`, changes one
link in the last open question. Probes were headless Chromium 1243 (Playwright 1.63), run through
the wave-heavy wrapper. Their scripts, screenshots and downloaded chunks are in
`/work/tmp/research/155/`, which is scratch. Write-ups:

- [docs/ui-research/cursor-demo.md](../docs/ui-research/cursor-demo.md): the cursor.com teardown
- [docs/ui-research/landing-replicas.md](../docs/ui-research/landing-replicas.md): 15 other
  landing pages, measured
- [docs/ui-research/replay-tools.md](../docs/ui-research/replay-tools.md): libraries and tools for
  scripted replays, with sizes and licences

### Today's hero, measured

- **Embedded, it does not start in headless Chromium.** On both the live GitHub Pages site
  (`https://shaullavo.github.io/fregat/`) and a local copy of today's build, the iframe gives up
  after 30 s. `apps/web/src/demo-entry.ts:29` then replaces a working app with "The demo could not
  start". Loaded directly at `/fregat/demo/index.html`, the same build renders the garden
  workspace. The readiness gate (`demo-entry.ts:51-58`) needs the editor, a terminal canvas, the
  wallpaper image and `document.fonts.status === 'loaded'`, and one of those never passes inside
  the frame. This is **not confirmed in a headed browser**. Also on the live site: a 404 for
  `/fregat/demo/fonts/nerd/NerdFontsSymbolsOnly`, and four 501 responses.
- **Weight before the 30 s gate:** 196 files, 18 MB raw and **6.0 MB gzipped**. JavaScript is 162
  files, 13.5 MB raw and 3.2 MB gzipped. These are gzip sizes of the files the page requested,
  measured from disk. The whole build (`apps/site/dist/demo`, 18:58 today) is 66 MB on disk, with
  609 chunks at 60 MB raw and 8.6 MB gz (`bundle-stats.json`). The plan's 31 MB figure is out of
  date.
- **Upkeep:** 14 commits touched `apps/web/src/demo/` in the 11 days from its first commit
  (62db0266f, 2026-09-14) to today. Ten were feature work elsewhere that had to keep the mock
  backend in step (Plans 126, 142 and 165, git scoping, undo history, wallpapers, split views). `site.yml` rebuilds the site on every push under
  `apps/web/**` or `packages/**`, at 2–4 min a run.

### 1. cursor.com's demo

Full notes are in [cursor-demo.md](../docs/ui-research/cursor-demo.md).

- **Built as:** server-rendered React DOM with Tailwind theme tokens. No canvas and no video. The
  first frame is in the 125 KB-gz HTML document.
- **Scripted as:** data plus small players. Agents are records (title, mode, messages, open files,
  diff summary). Stories are step lists (`{ kind: 'pause', ms }`, `{ kind: 'message', … }`).
  There are named start and end states (`HERO_DEMO_CONTENT` / `HERO_DEMO_END_CONTENT`). Playback
  is `setTimeout` chains, and `requestAnimationFrame` calls stop after about 8 s.
- **Story:** two agents working in parallel finish on their own, about 2 s and 6 s in. One opens
  a plan with a multiple-choice question, and a CLI window streams its answer. The story settles
  by about 10 s and does not loop. A moving element-inspector highlight carries on as ambient
  motion.
- **Weight:** the chunks that mention the demo come to 269 KB gz (an upper bound), on top of React
  and Next. The whole page is 6.9 MB on the wire, including a 1.46 MB PNG wallpaper.
- **Interactive:** partly. `pointerdown` on the demo skips to the end state, and the CLI composer's
  slash menu works. A click on a sidebar row did not change the transcript.
- **Off-screen:** an IntersectionObserver `isPlaying` context. The CLI starts streaming only once
  it is 15% visible. Scrolled away, the hero made 22 mutations in 5 s.
- **Reduced motion:** jumps to `HERO_DEMO_END_CONTENT`. The ambient loops keep running (344
  mutations in 12 s, against 881 without reduced motion).

### 2. What else exists

Details in [landing-replicas.md](../docs/ui-research/landing-replicas.md) and
[replay-tools.md](../docs/ui-research/replay-tools.md).

- **The editor and agent products draw their app as DOM**: Cursor, Zed, Linear and Devin/Windsurf.
  Others use video (opencode's hero loop is 10.4 MB), screenshots (Conductor, Kiro, t3code) or
  WebGL art (Raycast, Warp). **None embeds the live app.**
- **t3code's marketing site** (`references/t3code/apps/marketing`, 7a12aff4) is Astro with no
  framework, like ours. It gates all its CSS motion with one 95-line module
  (`src/lib/homeMotion.ts`): IntersectionObserver, `visibilityState` and reduced motion write
  `--home-motion-state`, and the CSS reads that as `animation-play-state`. This is the pattern to
  copy.
- **rrweb** (MIT) is the only replay that cannot drift from the app. I measured a snapshot of the
  real demo app: the full snapshot is 576 KB raw / **93 KB gz** before any story, and the replayer
  adds 62 KB gz. The terminal (WebGPU canvas) and the minimap canvases come out blank. It works as
  a fallback, and it is not what we want.
- **Pieces worth borrowing:** `@shikijs/magic-move` (MIT, about 20 KB raw, tokens computable at
  build time) for the edit landing in the editor, and brainless's TUI markup (already surveyed)
  for the terminal pane. **typed.js 3 and TypeIt are GPL-3.0.** GSAP's licence is proprietary.
  Motion goes against the owner's CSS-first rule.

### 3. The build

**Recommendation: Astro markup plus one small vanilla player (option A). Style it with the app's
own tokens, and render the chrome from the real `packages/ui` primitives at build time: option C,
with no React shipped.** A and C are not rivals: C costs nothing at runtime, so it is A with the
drift-prone half removed.

What C was measured to cost (throwaway probe, `/work/tmp/research/155/ssr/`):

- `renderToStaticMarkup` renders `ToolPane`, `PaneBar`, `ListRow`, `Badge`, `Spinner`,
  `InputGroup` and `Button` from `packages/ui/src` with no providers, in 8.7 ms, to 10 KB of HTML.
  Astro does the same for any React component given no `client:*` directive, so the page ships
  zero React.
- CSS: compiling `globals.css` with its `@source` lines removed, over only the 139 classes that
  HTML uses, gives **54.6 KB raw / 9.3 KB gz**. Of that, 6.6 KB gz is theme, palette and base
  styles, and 2.7 KB gz is utilities. The whole app's CSS is 174 KB / 30 KB gz. The fonts are
  Inter latin (48 KB) and JetBrains Mono latin (40 KB).
- **What it does not cover:** the panes' content. The file tree (`@pierre/trees` in a shadow
  root), the editor (Singapore), the terminal (ghostty-webgpu canvas) and the chat timeline
  (query- and store-bound features in `apps/web`) cannot be rendered outside the app. Their
  content is hand-built markup under real chrome and real tokens: an editor through Astro
  `<Code>`, the terminal from brainless ports.
- **Build cost:** the site gains `@astrojs/react`, `react`, `react-dom`, `tailwindcss` and
  `@tailwindcss/vite` as build dependencies, plus `@workspace/ui`. `globals.css` cannot be
  imported as it is, because its `@source` globs (`globals.css:11-14`) scan all of `apps/**`. It
  needs one split: theme, palette and utilities in a file the site imports, and the `@source`
  lines left in the app's entry.

Option B (React islands) is rejected. It ships React (about 45 KB gz) to animate markup that
needs about 150 lines of vanilla JS, and it buys nothing C does not.

**Budget:** under 40 KB gz for the hero, not counting fonts and the wallpaper. That is HTML about
12 KB, CSS about 10 KB, player and script about 4 KB, and magic-move about 8 KB if it earns its
place. Against 6.0 MB gz today, that is about 150× less.

### 4. The script

Authored at the stage's current 1360×840 and scaled with `--demo-scale` as the iframe is now. It
uses the garden fixture (`apps/web/src/demo/seed.ts`), so the files match the screenshot and the
README. **The first frame is the static HTML**, so it is what a visitor with no JS sees. **The
held end frame is what reduced motion and a pointerdown show.** Only one region is busy at a time,
except beat 7, where the parallel agent is the point.

| t (s)     | Pane           | What happens                                                                                                                                                                                                  |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | all            | First frame: `garden.ts` open, `src/` expanded, terminal at `garden main ❯`. The agent pane shows two sessions: _claude code_ idle, _codex_ running ("why does the tree typecheck fail on a clean checkout"). |
| 0.6–2.4   | agent (claude) | Prompt typed: "space the lavender wider and add a test for it". Send.                                                                                                                                         |
| 2.6–5.0   | agent, files   | Streamed tool rows `Read src/plants.ts`, `Read tests/garden.test.ts`. Each row marks its file in the tree as it lands.                                                                                        |
| 5.0–7.0   | agent          | Approval card "Edit src/plants.ts". One pointer press on **Allow once**, and the card settles to its receipt ("Allowed once").                                                                                |
| 7.0–9.5   | editor, files  | Tab switches to `plants.ts`. The edit lands (`spacing: 45` → `60`, diff-added tint). The tab gets its modified dot and the git count becomes 1.                                                               |
| 9.5–11.5  | editor, files  | Second edit: a three-line test appears in `tests/garden.test.ts`. Git count 2.                                                                                                                                |
| 11.5–15.0 | terminal       | The agent runs `bun test`. Output streams: three ✓ lines, then `3 passed · 0 failed`.                                                                                                                         |
| 13.0–15.0 | agent (codex)  | In parallel, codex finishes: its dot turns success, last line "found: zustand declared, never installed".                                                                                                     |
| 15.0–18.0 | agent (claude) | Final answer streams: "Lavender now sits 60 cm apart, and a test pins it. 3 passed." Turn receipt `4 steps · +5 −1`.                                                                                          |
| 18.0–24.0 | all            | Hold the end frame.                                                                                                                                                                                           |
| 24.0–25.0 | all            | Cross-fade to the first frame and loop.                                                                                                                                                                       |

The agent's output streams in chunks. Only the user's prompt is typed. The loop runs only while
the stage is intersecting and the tab is visible.

### 5. The real demo

**Recommendation: take it off the landing page in the same change that ships the replica. Keep it
as its own page (`/fregat/demo/`) behind a plain "try it live" link, with no iframe and no
preload.** Deleting it is the owner's call (Owner question 1). What this rests on: it costs 6 MB
gz to show a first frame, it fails to start when embedded in headless Chromium, and in 11 days it
needed a mock-backend update in ten feature commits. It is still the only
way to touch fregat without cloning.

### Open questions, answered

- **Keep the live demo?** See 5 and Owner question 1.
- **Keeping up with the app's look.** Recommendation: shared tokens and the real chrome primitives
  at build time (3). That leaves pane content as the only surface that can drift. Accept that
  drift, and refresh the replica when a pane's structure changes. A side-by-side screenshot of the
  replica's end frame against the app's is enough of a check.
- **Physical mode.** Recommendation: not in the first version. The story has one pointer press
  (Allow once). If [physical feel](../docs/physical-feel.md) has shipped by then, that press can use its
  spring token, which is one class. Sound stays off: the page must not make noise unasked.

### Owner questions

1. **The live demo, once the replica ships.**
   (a) Its own page behind a "try it live" link (recommended).
   (b) Delete it: `apps/web/src/demo/`, `demo-entry.ts`, `demo.html`, `demo-preview-plugin.ts`,
   the vite `demo` mode, the second build in `scripts/build-site.ts`, and `site.yml`'s
   `apps/web/**` trigger.
   (c) Keep it as the hero behind a click-to-load.
   Decided 2026-09-26: owner — (b) delete it. Long term, a real browser-only build of the server
   replaces it; that is its own future plan, not a revived mock backend.
2. **Which story.** (a) The table in 4: one Claude turn end to end, with codex finishing in
   parallel (recommended, and it matches "claude code and codex inside"). (b) Cursor's shape: only
   agents finishing, no editor or terminal beats. (c) An editor-first story: Singapore editing,
   search, git, with agents secondary.
   Decided 2026-09-26: owner — (a).
3. **Phones.** The 1360×840 stage scaled to a 390 px phone is about 0.29×, which is unreadable.
   (a) On narrow screens show only the agent pane at native size, playing the same script
   (recommended). (b) Scale the whole stage. (c) Show the still first frame.
   Decided 2026-09-26: owner — none yet: the phone hero shows what the app looks like on a phone,
   so it waits on [Plan 143](143-phone-layout.md)'s phone shell and is designed from it.

### Proposed phases

1. **Stage and still frame.** Split `globals.css` so the site can import theme, palette and
   utilities without the app's `@source` globs. Add build-only `@astrojs/react` and Tailwind to
   `apps/site`. Build the replica panes from the real chrome primitives plus hand-built content,
   with the garden fixture moved where the site can read it. The iframe comes out. Remove
   `console.log('dsdsd')` (`index.astro:14`). The caption says "replay" rather than "interactive
   demo".
2. **Player and script.** One vanilla module of about 150 lines: steps `{ at, pane, action }`,
   named start and end states, gating copied from t3code's play-state pattern (IntersectionObserver,
   `visibilitychange`, reduced motion → end frame), `pointerdown` → end frame, and a loop. Then the
   script in 4. magic-move for the edit landing only if it stays within budget.
3. **Agents section.** The brainless Claude and Codex ports replace the static `<ol>` sessions in
   `#agents` (as in [brainless.md](../docs/ui-research/brainless.md)), sharing the player.
4. **The live demo**, as the owner decides in question 1.
