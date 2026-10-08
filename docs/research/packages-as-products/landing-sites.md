# Landing sites: how the best product and library sites sell

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A item 2, and input for
Track D (sites) and Track E (hosting). Written 2026-10-08.

**Method.** Every homepage below was loaded in headless Chromium 1243 (Playwright 1.63) at 1440×900,
scrolled to the bottom to trigger lazy loads, and measured over CDP (`encodedDataLength`, so bytes on
the wire). The probe also recorded the H1, the hero subhead, H2s in order, loaded fonts, theme
toggles, video, canvas and iframe counts, and whether the CSS has a `prefers-reduced-motion` rule.
Page copy was read with WebFetch. The probe script and the hero and full-page screenshots are in
`/work/tmp/research/336-landing/` (scratch, not kept). Earlier work this file builds on, and does not
repeat:

- [docs/ui-research/cursor-demo.md](../../ui-research/cursor-demo.md): frame-by-frame teardown of
  cursor.com's hero replica (how it is scripted, gated and weighed).
- [docs/ui-research/landing-replicas.md](../../ui-research/landing-replicas.md): 15 heroes classified
  by technique (DOM replica, video, screenshot, canvas art).
- [docs/ui-research/replay-tools.md](../../ui-research/replay-tools.md): libraries for scripted
  replays, with sizes and licences.
- [Plan 155](../../../plans/155-site-demo-replica.md): the approved replica build for the Fregat hero.

Claims the copy below may and may not make come from
[fregat-platform.md](fregat-platform.md) ("What a landing page must not claim yet") and
[performance-evidence.md](performance-evidence.md). Where an outline below needs a number, it names
the number that evidence file supports, or says the number is missing.

---

## 1. Patterns ranked by impact

Ranked by how much each would change what a visitor understands in the first ten seconds, for a
project with no users, no logos and no download yet.

### 1. The first screen shows the product, and the product is in the HTML

The tools in our category draw their app as DOM in the hero: Cursor, Zed, Linear, Devin, Windsurf.
Each ships the first frame in the server HTML, so the picture is complete before any script runs.
Libraries do the same with the real thing: tldraw puts a live canvas beside its six-line `App.tsx`;
CodeMirror and Lexical put a working editor directly under the headline; ghostty.org and our
ghostty-webgpu site put a terminal window with the ghost in it. t3code uses one still screenshot
(148 KB of images for the whole page) and still reads as a product.

Nobody embeds their full live app. Fregat's iframe of the whole web app (6.0 MB gz before its 30 s
start gate, Plan 155) is the outlier and is already approved for removal.

**For us:** the Fregat hero is a replica whose editor and terminal panes can become the real
Singapore and ghostty-webgpu on click (option C in section 4). Singapore's hero is the live editor.
ghostty-webgpu keeps its live terminal.

### 2. Every speed claim sits next to its number, its machine and a reproduce link

The sites that sell speed best put the measurement in the hero, not an adjective:

- **Bun**: a tabbed bar chart beside the headline (install, Express, Postgres, WebSockets). Each
  chart says "lower is better", lists versions per bar (`yarn v1.22.22`), has a one-line method
  footnote ("T3-stack app, 25 direct dependencies … Linux x64, EPYC 9R14 … medians of 3"), a
  **reproduce** link into `oven-sh/bun/tree/main/bench/…`, a **"replay in real time"** toggle that
  animates the bars at true speed, and an accessible table with the same data plus peak RAM.
- **Biome**: "~35x faster than Prettier when formatting 171,127 lines of code in 2,104 files with an
  Intel Core i7 1270P", linked to its benchmark repository.
- **Astro**: a bar chart of "% of real-world sites with good Core Web Vitals" (Astro 71%, WordPress
  48%, Gatsby 45%, Next.js 35%, Nuxt 28%), credited to HTTP Archive and the Chrome UX Report with a
  dataset link.

The rest say "blazing fast" (Vite), "Think in milliseconds" (Raycast), "world's fastest IDE" (Zed)
or nothing. That works for products with millions of users. It does not work for us, and Plan 336's
decision 2 already forbids it.

**For us:** copy Bun's chart block exactly: tabs per scenario, bars with versions, a method line, a
reproduce link, an accessible table, and a "replay in real time" toggle. ghostty-webgpu has the data
for it today. Singapore and Fregat need Track B's measurements first.

### 3. A headline that names the category, then one sentence that names the difference

The strongest headlines name what the thing is in plain words, and the subhead carries the
difference:

| Site                  | H1                                                           | Subhead                                                                                                |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Bun                   | Bun is a fast JavaScript runtime & toolkit. All in one.      | Runtime, package manager, test runner and bundler in a single binary.                                  |
| Cursor                | Cursor is your coding agent for building ambitious software. | (none; demo follows)                                                                                   |
| Zed                   | Your last next editor                                        | Zed is a minimal code editor crafted for speed and collaboration with humans and AI.                   |
| Linear                | The product development system for teams and agents          | Purpose-built for planning and building products. Designed for the AI era.                             |
| t3code                | The open-source control plane for coding agents.             | Orchestrate Claude Code, Codex, … from one surface. Bring your own subscription. Fork the whole thing. |
| opencode              | The open source AI coding agent                              | Free models included or connect any model from any provider, including Claude, GPT, Gemini and more.   |
| tldraw                | Build infinite canvas apps in React with the tldraw SDK      | Make whiteboards, diagrams, and canvas tools with tldraw's high-performance web canvas.                |
| Biome                 | One toolchain for your web project                           | Format, lint, and more in a fraction of a second.                                                      |
| Vite                  | The Build Tool for the Web                                   | Vite is a blazing fast frontend build tool …                                                           |
| Astro                 | The web framework for content-driven websites                | Astro powers the world's fastest marketing sites, blogs, e-commerce websites, and more.                |
| CodeMirror            | Extensible Code Editor                                       | CodeMirror is a code editor component for the web.                                                     |
| ghostty-webgpu (ours) | An unofficial Ghostty for the web.                           | libghostty-vt compiled to WebAssembly and drawn by a damage-aware WebGPU renderer.                     |
| Fregat (ours, today)  | cursor, built right, from scratch                            | chat first, with diffs, search and the full editor in the same window.                                 |

Formula: **[Name] is a [category] for [who or what]**, or the category alone, then a subhead with
the two or three facts that make it different. Today's Fregat H1 defines itself by a competitor and
asks the visitor to trust "built right". The t3code subhead is the closest model for us: it names
the agents and the subscription rule in one breath.

### 4. Bring-your-own and privacy get one section with the mechanism, not a slogan

The sites that explain this well show **how** it works:

- **t3code, "Bring your own sub"**: "T3 Code doesn't resell tokens." Then a table of each harness and
  its login command (`claude auth login`, `codex login`, `opencode auth`, …) and three short lines:
  "No keys resold. No quota caps." / "Switch models mid-thread." / "More harnesses shipping weekly."
- **opencode, "Built for privacy first"**: "OpenCode does not store any of your code or context
  data, so that it can operate in privacy sensitive environments." One sentence, one link to the
  details. Its feature list also names the subscriptions it accepts ("Log in with OpenAI to use your
  ChatGPT Plus or Pro account").
- **Warp, "Open at every layer"**: four short cards: any agent, any model, your compute or ours,
  data lives where you want.
- Cursor, Zed, Raycast and Linear leave privacy to footer links. Cursor's model choice is a picker
  inside the demo.

**For us:** one section that says Fregat runs on your machine, talks to Claude Code and Codex through
their own logins, and proxies nothing, followed by the two login commands in a table. Claude Code and
Codex only; Cursor and opencode are planned (fregat-platform.md, item 4).

### 5. One primary action, with a copyable command, in the hero

Libraries put the install command in the hero with a copy button and package-manager tabs (Bun,
Vite, Astro, tldraw, opencode, xterm.js, our ghostty-webgpu). Products put one download button and
one quieter secondary link (Zed: "Download now" and "Clone source"; t3code: "Download for macOS" and
"Steal our code (legally)"). Bun adds the next step under the command ("Then follow the quickstart").
Every page in the survey repeats the action in a closing section.

**For us:** Fregat has no download, and the site must not imply one. The primary action is
"Run it from source" with a copyable three-line block. The secondary action is GitHub. Singapore and
ghostty-webgpu lead with `npm install`.

### 6. Show that the project ships: a release pill, a changelog block, a version in the header

With no users to quote, a visible shipping rhythm is the strongest substitute for social proof.

- Bun: "NEW Bun v1.4.2 released →" above the H1, and a release card mid-page with the headline fixes
  and "Read the release notes".
- Cursor and Linear: a "Changelog" block with four dated entries and "View all".
- Astro and Biome: an announcement badge above the H1 ("Astro 7.3 Available now!").
- Vite and Biome: a version picker in the header. Our ghostty-webgpu site already has `v0.3.20`
  next to the wordmark.

**For us:** every site gets a version and a "latest release" line that the build reads from the
package's `package.json` and changelog (Track G). Fregat's landing page gets a short changelog
block once release notes exist.

### 7. Social proof, in the forms a new project can honestly have

| Form                                       | Who                                                                | Available to us now?             |
| ------------------------------------------ | ------------------------------------------------------------------ | -------------------------------- |
| Logo wall ("Trusted by…")                  | Cursor, Linear, Bun, Vite, Biome, tldraw, Warp                     | No                               |
| Named quotes from known people             | Cursor, Linear, Vite, Raycast, Bun (video cards)                   | No                               |
| Tweet carousel                             | t3code ("Tolerated by over 400,000 devs")                          | No                               |
| Counts: stars, npm downloads, contributors | opencode, Vite, tldraw, t3code                                     | Later; small numbers hurt        |
| "Real-world uses" list                     | xterm.js (~90 projects)                                            | ghostty-webgpu: "Used in Fregat" |
| Built-on and built-by credits              | Zed (GPUI, tree-sitter, ACP cards), ghostty-webgpu (libghostty-vt) | Yes                              |
| Sponsors                                   | CodeMirror, Astro, Biome                                           | No                               |

**For us:** skip logos, quotes and counts until they exist. Use the family as proof instead: Fregat
links to the Singapore and ghostty-webgpu sites and their benchmarks, the way Zed links GPUI and
tree-sitter. Add a "Used by" line to the libraries when the first outside user appears.

### 8. Motion is gated, and reduced motion gets the final frame

Every surveyed site except CodeMirror has a `prefers-reduced-motion` rule. The careful ones also stop
off-screen work: Cursor drives its story from an IntersectionObserver context and jumps to a named
end state under reduced motion; t3code's marketing site writes one CSS variable from
IntersectionObserver, `visibilitychange` and reduced motion and lets CSS read it as
`animation-play-state` (`references/t3code/apps/marketing/src/lib/homeMotion.ts`). Linear and Devin
keep their replicas nearly still (Linear: 69 mutations in 4 s). A story that settles into a held
frame reads as the product; constant motion reads as an ad.

### 9. Page weight: the libraries are light, the products are heavy, and video is the cost

| Site                  | Wire total | Largest part                       |
| --------------------- | ---------- | ---------------------------------- |
| t3.codes              | 270 KB     | images 148 KB (one screenshot)     |
| xtermjs.org           | 466 KB     | fonts 247 KB                       |
| astro.build           | 489 KB     | fonts 191 KB, images 187 KB        |
| biomejs.dev           | 510 KB     | images 245 KB                      |
| ghostty.org           | 575 KB     | fonts 306 KB                       |
| lexical.dev           | 683 KB     | script 491 KB (live editors)       |
| codemirror.net        | 684 KB     | script 578 KB (one eager bundle)   |
| ghostty-webgpu (ours) | 737 KB     | wasm 337 KB, fonts 279 KB          |
| bun.com               | 1.9 MB     | one 727 KB WebM (HMR demo)         |
| vite.dev              | 2.7 MB     | images 1.7 MB, Rive runtime 234 KB |
| tanstack.com          | 4.2 MB     | 1.5 MB hero MP4                    |
| oxc.rs                | 4.5 MB     | images 3.6 MB                      |
| linear.app            | 5.6 MB     | script 1.6 MB, images 1.6 MB       |
| ampcode.com           | 5.6 MB     | 607 requests                       |
| cursor.com            | 6.6 MB     | script 2.9 MB, images 2.3 MB       |
| tailwindcss.com       | 6.6 MB     | images 4.3 MB                      |
| tldraw.dev            | 7.3 MB     | images 3.6 MB, fonts 1.7 MB        |
| zed.dev               | 8.0 MB     | 4.4 MB of HLS video segments       |
| opencode.ai           | 10.6 MB    | one 10.1 MB MP4                    |
| warp.dev              | 30 MB      | 27 MB of images                    |
| raycast.com           | 42 MB      | 40.5 MB of images                  |

Two things follow. A live demo is not what makes a page heavy: Lexical and CodeMirror run real
editors under 700 KB, and our ghostty-webgpu runs a real terminal at 737 KB. Video and large raster
art are. Plan 336's "Lighthouse performance 95+ on mobile" target puts us with the top rows.

**Budgets for us:** Fregat under 400 KB before interaction (the replica is under 40 KB gz by Plan
155's estimate; the rest is fonts and the wallpaper). Singapore under 500 KB including the live
editor's first load. ghostty-webgpu stays where it is.

### 10. Type, colour and dark mode

- **Two families, one of them mono**, is the norm: Linear (Inter Variable plus Berkeley Mono), Zed
  (its own serif-italic display face plus Zed Mono), Bun (Archivo plus Martian Mono), t3code (DM Sans
  plus JetBrains Mono), Biome (Geist plus JetBrains Mono), ghostty-webgpu (Bricolage Grotesque plus
  JetBrains Mono). One distinctive display face is what makes a page recognisable: Zed's italic serif
  H1, Bun's condensed heavy H1 with one word in pink, t3code's tight-tracked grotesque.
- **Products default dark** (Linear, Warp, Raycast, t3code, Ghostty, opencode). **Libraries default
  light** (CodeMirror, Bun, tldraw, Biome, Astro, xterm.js). Theme toggles are on Cursor, Zed, Biome,
  Lexical, TanStack and Tailwind, mostly docs-heavy sites. Starlight gives docs a toggle for free.
- **Self-hosted fonts.** Today's Fregat site loads JetBrains Mono from Google Fonts; every fast site
  above self-hosts with `preload`. ghostty-webgpu already does.

### 11. Docs are one click from the hero and the header

Bun, Vite, Astro, Biome and tldraw put "Docs" (or "Get started", which goes to the quick start) in
the header and the hero. Bun's mid-page "A minute with Bun" walks five steps, each linking its docs
page. CodeMirror's 21 feature entries each link to the reference, guide or an example; that grid is
the docs index. Ghostty's docs home opens with "Zero configuration required" and Download / Build
from source. Vite publishes `/llms.txt`.

**For us:** every feature card links the docs page that proves it. Each docs site serves `llms.txt`.

### 12. Voice

Specific and slightly dry wins over grand: Bun's "The fastest install in every situation you
actually hit."; Biome's "Format code like Prettier, save time"; t3code's "If you don't like
something, fork it." Our ghostty-webgpu facts ("Only what changed is drawn.") already read this way.
The lowercase house style on today's Fregat site goes (Plan 336, decision 1).

---

## 2. Per-site notes

Sizes are wire bytes from the probe, 2026-10-08.

**cursor.com** (6.6 MB). H1 "Cursor is your coding agent for building ambitious software.", no
subhead, three CTAs (download, get started, request a demo). Hero: two overlapping DOM windows
(desktop app and CLI) over a wallpaper, scripted story of parallel agents finishing, end state under
reduced motion, `pointerdown` skips to the end (full teardown in cursor-demo.md). Order: logos;
"Agents turn ideas into code"; "Works autonomously, runs in parallel"; "In every tool, at every
step" (terminal, Slack, PR review); named testimonials (Jensen Huang, Karpathy, Patrick Collison,
shadcn, Greg Brockman); "Stay on the frontier" with a model picker; a four-entry changelog; recent
posts; "Try Cursor now." Five-column footer plus certifications. Light default with a toggle. Fonts:
CursorGothic, Berkeley Mono, EB Garamond. Models are shown as a picker inside the demo, privacy only
in the footer.

**zed.dev** (8.0 MB, 4.4 MB of it HLS video). Italic serif H1 "Your last next editor", subhead
"minimal code editor crafted for speed and collaboration with humans and AI.", buttons with keyboard
hints ("Download now D", "Clone source C"), "Available for macOS, Linux, and Windows". Three pillars
(Fast, Agentic, Collaborative), each one line, then a large DOM replica of the editor with an agent
thread and a "Watch Demo" button that opens a video. Then logos, "Zed Just Works", "Open Source",
"AI that works the way you code", extensions, "Built with ultimate care", blog posts. Speed is only
"Written from scratch in Rust to efficiently leverage multiple CPU cores and your GPU." No benchmark
numbers. (WebFetch got a different variant on the same day headed "Zed Industries" with product cards
for Delta and Zed, so the homepage is being A/B tested or rotated.) The closest product to ours; the
lesson is the three-pillar line under the hero and a replica with a "watch the video" escape hatch.

**ghostty.org** (575 KB). No H1 in the DOM. A terminal window titled "Ghostty" with the animated
ASCII ghost (text frames swapped in DOM, no canvas), then one sentence: "Ghostty is a fast,
feature-rich, and cross-platform terminal emulator that uses platform-native UI and GPU
acceleration." and two buttons, Download and Documentation. That is the whole page. Next.js with
MDX docs; the frames come from a `video-to-terminal` tool. The docs home (640 KB) opens with "Zero
configuration required", Download, Build from Source, then featured docs. The lesson: one striking
object, one sentence, two buttons, and everything else in docs.

**linear.app** (5.6 MB). Dark. H1 "The product development system for teams and agents", subhead
"Purpose-built for planning and building products. Designed for the AI era.", no signup button in
the hero, only a "New Loops →" pill. Large DOM replica of an issue with an agent pane (model chip
"Opus 5", "Thinking…"). Then logos; "A new species of product tool." with three numbered pillars
(Fig 0.1–0.3); four feature sections (Intake, Planning, AI, Build), each a replica plus toggles and
"Learn more"; a changelog block; three named quotes; "Linear powers over 40,000 product teams";
closing "Built for the future. Available today." Inter Variable plus Berkeley Mono. Speed is a value
("Designed for speed"), not a number.

**bun.com** (1.9 MB). The best proof-of-speed page in the survey; see pattern 2. Order: announcement
bar; release pill; H1 with "fast" in pink; install block with OS tabs, "View install script ↗",
"Then follow the quickstart"; benchmark tabs; "Used by" logos; "Four tools, designed together";
"A minute with Bun" (five steps, each with a docs link, plus an animated terminal replay captioned
"Output abridged from Bun v1.4.2"); latest release card; "Bun in production" (four video
testimonials); "The fastest install in every situation you actually hit" (six mini charts, each with
a speedup badge and RAM); memory charts on a square-root scale; batteries-included code tabs;
frontend HMR video (727 KB WebM, the page's largest asset); Bun vs Node.js vs Deno comparison table
("Show all 23 rows"); closing install. Light, Archivo plus Martian Mono.

**warp.dev** (30 MB). Now sells "Open infrastructure for cloud software factories"; the terminal is
one of three products near the bottom. Useful for one section only: "Open at every layer" (any agent,
any model, your compute or ours, data lives where you want) and an FAQ that answers "bring your own
model or harness (e.g. claude code or codex)". Canvas art hero, 27 MB of images. Not a model for
weight or focus.

**raycast.com** (42 MB, 40.5 MB images). H1 "Your shortcut to everything.", WebGL art hero, no
download button until the bottom. Four pillars on a keyboard graphic ("Fast. Think in
milliseconds." / "Reliable. 99.8% crash-free rate."), extension grid, AI demo, 24-name testimonial
wall, community counts (37k Slack, 90k X). Lesson: a single hard number ("99.8% crash-free") in a
pillar beats an adjective. Otherwise too heavy to copy.

**vite.dev** (2.7 MB). H1 "The Build Tool for the Web", "By VoidZero" badge, Get Started and GitHub,
install tabs. Rive animations (234 KB runtime plus about 100–160 KB per `.riv` file) for the masthead
and feature cards. Logos, two feature grids, framework logos, "80k+ stars / 80m+ weekly downloads"
with nine community quotes, "Free & open source" (MIT), closing CTA. Header carries a version menu
and an LLM note ("Are you an LLM? View /llms.txt"). Speed only as adjectives. oxc.rs and voidzero.dev
share this template and Rive approach.

**biomejs.dev** (510 KB, Starlight-based site with custom landing). H1 "One toolchain for your web
project", subhead "Format, lint, and more in a fraction of a second." Each tool gets a section with a
before/after code demo, a measured claim (the ~35x line above), and install tabs ending in the
command for that tool. Six-card feature grid, "Try Biome" (install, editor integration), 15 logos with
"View all users", contributor avatars, sponsors. Theme, language and version selectors in the header.
A good model for a library landing that sits on a docs site.

**t3.codes** (270 KB). The lightest page in the survey and the closest pitch to Fregat's. Dark. H1
"The open-source control plane for coding agents.", harness logos floating around it, "Download for
macOS" (OS-detected) and "Steal our code (legally)", phone store links, then one large screenshot of
the app (thread beside a PR diff). Sections: tweet carousel ("Tolerated by over 400,000 devs"),
"Bring your own sub" (login command per harness), "One button to commit, push, and make a PR." (a
mock PR card), "If you don't like something, fork it." (terminal with three commands, "MIT licensed ·
24k+ stars"), closing "Your agents deserve better than a terminal." Astro, no framework, motion gated
by `homeMotion.ts`. No docs links at all.

**t3.chat** (1.7 MB). The homepage is the app (a chat composer with suggested prompts). Not a
landing page; it shows that for a hosted app the app itself can be the pitch. Not applicable to a
local-first tool.

**opencode.ai** (10.6 MB, 10.1 MB of it one MP4). H1 "The open source AI coding agent", subhead on
models and providers, install tabs (curl, npm, bun, brew, paru, yay), hero video. "What is OpenCode?"
with seven one-line features that name subscriptions it accepts; a stats block (208K stars, 950
contributors, 16M monthly devs); "Built for privacy first"; an eight-question FAQ ("Can I use my
existing AI subscriptions with OpenCode?"); a paid-models promo; a waitlist. IBM Plex Mono throughout.
Lesson: the FAQ titles alone answer the bring-your-own questions a visitor arrives with.

**tldraw.dev** (7.3 MB). H1 "Build infinite canvas apps in React with the tldraw SDK", `npm create
tldraw` with a copy button, "or Build with a starter kit". Hero is code on the left (`App.tsx`, 14
lines) and the **live SDK canvas** on the right, drawable at once. Then logos, "Why tldraw?",
case studies, "What's inside" (six features, each "Learn more"), community stats (50.8K stars,
512.6K weekly npm downloads), starter kits, one testimonial. "Docs" in the header goes to
`/quick-start`. The code-plus-live-result hero is the pattern for Singapore.

**codemirror.net** (684 KB). The model the owner named for Singapore. One column about 720 px wide,
white, Merriweather headings over Source Sans Pro. Header: logo, Examples, Documentation, Try,
Discuss, Code, Version 5. H1 "Extensible Code Editor", one paragraph, a three-line live JavaScript
editor, the caption "This is a CodeMirror field, configured for editing JavaScript code." Then
Features (21 entries in a three-column grid, each one sentence, each linking the reference, the guide
or an example such as the "million lines" speed demo), About (licence, funding expectation, browser
support, forum and tracker), Language Support (20 parser packages as links), Sponsors in three
tiers, and a two-link footer. No hero image, no motion, no reduced-motion rule needed. Site source is
in `references/codemirror-website` (a Node script, markdown-it and mold templates, `builddocs` for
the reference). **The live editor is not cheap in bytes:** `codemirror.js` is one shared, unminified
1.6 MB bundle, 504 KB gzipped, loaded with `defer` on every page, and the editor `<div>` is empty
until it runs. CodeMirror is cheap in design, not in weight; Singapore can do better (section 3).

**lexical.dev** (683 KB, Docusaurus). H1 area "A text editor framework that does things differently."
with Get Started, a live rich-text editor under it, three pillars (Reliable, Accessible, Fast), then
four live demo editors, each an H2 ("Notion-like block editor", "Compact chat input", "Rich input
field", "AI agent editor") with "Open in StackBlitz". The lesson for Singapore: show several small
configurations of the same editor, each one runnable elsewhere.

**xtermjs.org** (466 KB). Logo, "Build terminals in the browser", `npm install @xterm/xterm` with
copy, a live terminal demo (three canvases), "Getting Started" (a dozen lines of HTML), and
"Real-world uses": about 90 projects starting with VS Code, ending "And much more…" linked to
GitHub's dependents page. No benchmarks, no feature list. ghostty-webgpu already outclasses it on the
landing page; its docs site is the thing to beat.

**astro.build** (489 KB). Release badge, H1 "The web framework for content-driven websites", Get
Started, `npm create astro@latest`. "What is Astro?" with three pillars; "Astro Islands" with the
measured Core Web Vitals chart; "Zero Lock-in" with framework logos and a live product-card demo;
"Fully Featured" (14 cards, each linking a docs page); themes; agencies; closing CTA; sponsors;
newsletter. MIT footer.

**tailwindcss.com** (6.6 MB), **tanstack.com** (4.2 MB, a 1.5 MB hero MP4), **ampcode.com** (5.6 MB,
607 requests, four videos): checked for comparison. Tailwind's hero shows code and its rendered
result side by side, the same pattern as tldraw. Amp's "Make More of Your ChatGPT Subscription"
section is another bring-your-own-subscription pitch.

**Our sites today.** `shaullavo.github.io/fregat/`: H1 "cursor, built right, from scratch",
lowercase, nav of in-page anchors, the live-app iframe as hero (Plan 155 measured it at 6.0 MB gz and
failing to start when embedded in headless Chromium), panes styled like the app, "the name" section
with a technical drawing of the Fregat stage, clone-and-run block. `…/fregat/ghostty-webgpu/` (737
KB): H1 "An unofficial Ghostty for the web.", install with copy, a live terminal window with Ghost,
Matrix and Shell tabs and the active renderer shown, a code sample, three facts, a "Measured" table
that currently renders "Measurements in progress" (`SHOW_MEASUREMENTS`), and an "In progress" list.
It follows most of the patterns above already.

---

## 3. Proposed outlines

### 3.1 Fregat (`apps/site`)

Dark default (it is a product), the app's own tokens and fonts self-hosted, sentence case. Budget:
under 400 KB on the wire before interaction, Lighthouse mobile 95+. Copy must stay inside
fregat-platform.md section 4 and performance-evidence.md: no download, no "native Mac app", no
"any agent", no platform latency numbers, no "typing lands within one 120 Hz frame" until Track B
measures it.

1. **Header.** Wordmark (the six-tank icon), then Singapore, ghostty-webgpu, Docs (the README's
   getting-started until a docs site exists), GitHub. A version and "latest release" pill when Track
   G produces release notes.
2. **Hero.**
   - H1 candidates for Track B, category first:
     "Fregat is a local workbench for Claude Code and Codex." /
     "One window for your agents, your editor and your terminals." /
     "The coding-agent workbench that runs on your machine."
   - Subhead names the three differences in one sentence: it runs on your machine, it runs the
     agents on the plans you already pay for, and the editor and terminal are our own and fast.
   - Primary action: "Run it from source", which reveals or scrolls to the three-line block with a
     copy button. Secondary: GitHub. A small line under them: "Linux and macOS. No account."
   - The replica (section 4, option C): first frame in HTML, scripted story that settles, editor
     and terminal panes upgrade to the real libraries on click with the caption "The editor and the
     terminal in this picture are real. Click and type."
3. **Three pillars, one line each** (Zed's pattern), under the replica: Fast, Yours, Everywhere.
   Each line carries one fact and links to its section.
4. **Your agents, your plans.** "Fregat runs Claude Code and Codex with your own logins. It
   proxies nothing and resells nothing." A two-row table of harness and login command
   (`claude auth login`, `codex login`), each with its own permission mode, side by side. Planned
   harnesses listed as planned (fregat-platform.md item 4).
5. **Work keeps going.** The three platform stories ranked first in fregat-platform.md: close any
   window and nothing stops; terminals survive a server restart (Linux verified, macOS qualifier);
   updates wait for running agents. Each with a small replica or a short recorded scenario
   (`server-restart`, `terminal-offline-host`).
6. **One window.** Chat, diff, editor, search, terminal and git in one workspace; the agent's diff
   opens inside the conversation. Uses replica panels, not screenshots.
7. **Every machine you own.** One small server per machine, many clients: browser, a desktop window,
   a terminal client, a phone through your tailnet (with the qualifier). One diagram, no numbers.
8. **Built from our own parts.** Three cards in the Zed "related projects" style: Singapore,
   ghostty-webgpu, hotkeys (plus tree-sitter-x as a line). Each card shows its one strongest
   measured number from performance-evidence.md with a link to that project's benchmark page, then
   links to its site and docs. This is where Fregat's speed claim lives: as proof from the parts.
9. **Planned.** A short list, each item named plainly and linked to its plan (Plan 336 decision 3).
10. **The name.** Keep a compact version of today's Fregat section and the stage drawing. It is the
    one distinctive thing on the current site.
11. **Try it.** Prerequisites and the clone-and-run block, repeated.
12. **Footer.** Columns: Fregat (GitHub, Docs, Changelog), Parts (Singapore, ghostty-webgpu,
    hotkeys), Project (Licence, Security, Contributing). Revision and commit stamped at build.

Phone layout: Plan 155's owner answer stands. The phone hero waits on Plan 143's phone shell; until
then narrow screens show the replica's final frame as a still.

### 3.2 Singapore (`editor/site`)

"The most simple website in the universe, CodeMirror style, mostly docs." Light default with a dark
toggle (Starlight provides it), one column about 760 px on the home page, no hero art, no motion
except the editor itself. Budget: under 500 KB on the wire, including the editor's first load.

**Home page** (custom Astro page inside the Starlight site, the Biome arrangement):

1. **Header.** Wordmark, Docs, Examples, Benchmarks, Changelog, GitHub, npm version.
2. **H1 and one paragraph.** Candidate: "Singapore: a fast code editor for the web." Paragraph: a
   modular editor component built on a persistent piece table, with parsing, highlighting and
   language servers in workers so typing stays on a free main thread. Track B owns the final words
   and the "modern Monaco" framing.
3. **The live editor,** right under the paragraph, about 12 lines of TypeScript, with diagnostics
   and hover working. Caption in CodeMirror's style: "This is a Singapore editor, configured for
   TypeScript." Below it, two small buttons: **"Open a 1,000,000-line file"** (generated in the page,
   no download, the CodeMirror "million" example) and **"Show the source"** (the config that built
   this editor, tldraw-style).
4. **Install.** `npm install @singapore-editor/editor` with package-manager tabs, then a ten-line
   usage sample, type-checked in CI (Plan 336 decision 6).
5. **Why Singapore.** Three or four facts, each with its proof link: the piece table and stable
   anchors (Concepts page), workers keep the main thread free (the input-latency doc), large files
   (the benchmark page, once Track B has the Monaco and CodeMirror comparison), CSS Custom Highlight
   API paint. No "faster than Monaco" until the comparison exists (performance-evidence.md).
6. **Features grid** (CodeMirror's 21-entry grid): one sentence each, each linking its guide or
   reference page: tree-sitter, LSP, diff, minimap, find, gutters, markdown, spellcheck, React and
   Solid bindings, themes, large files, undo history.
7. **Packages.** A list of the published packages with one line each, like CodeMirror's language
   list. Then the tree-sitter languages that ship.
8. **Planned.** Collaborative editing following Weidner's approach, linked to its plan.
9. **About and footer.** MIT, part of Fregat, issues go to the fregat repository, link to
   ghostty-webgpu and Fregat.

**Docs** (Starlight, shared look with ghostty-webgpu, own accent): Getting started; Guides (themes,
languages and tree-sitter, LSP, React, Solid, large files, decorations, plugins); API reference
generated from TypeScript; Concepts from `editor/ARCHITECTURE.md` and `editor/docs/`; Benchmarks;
Changelog. Every guide opens with a small live editor showing the result, Lexical-style, lazy-loaded.

**How to embed the live editor cheaply.** CodeMirror loads 504 KB gz eagerly and shows an empty box
until it runs. Do better:

1. **Render the first frame at build time.** The Astro page renders the sample as static,
   highlighted HTML with the editor's own class names, gutter widths and line height, so the box is
   complete and correctly sized with no JavaScript (Plan 336, "works without JavaScript for
   reading"). Highlighting at build time can come from Singapore's own tree-sitter path run in Node,
   or Shiki as a fallback; use the same theme tokens so the swap is invisible.
2. **Load the editor when it matters.** An Astro island with `client:visible` (the editor is near the
   top, so this is close to page load), or a stricter "upgrade on first `pointerdown`/`focus`" for
   docs-page examples further down. Preload the module on `pointerenter` so the click feels instant.
3. **Ship the smallest configuration.** Core editor plus one language. Workers (tree-sitter,
   TypeScript LSP) start after the first paint and only on the home page demo. The example app's
   main chunk is 354 KB gz today with everything in it (`editor/examples/app/dist`), and its
   TypeScript LSP worker alone is 980 KB gz, so the minimal configuration's size is unmeasured and is
   the first thing the site lane must measure. If LSP does not fit the budget, hover and diagnostics
   load on first hover or first edit.
4. **The million-line button generates text in the page** and reports the time to open, which turns
   the demo into a measurement the visitor runs themselves.
5. **One shared, hashed editor bundle** across home and docs pages, cached immutable, so the second
   page costs nothing.

### 3.3 ghostty-webgpu (`ghostty-webgpu/site`): keep, then improve

The owner likes it, and it already follows most of section 1. Changes, in order of value:

1. **Turn "Measured" on, and make it Bun's chart.** Today it renders "Measurements in progress".
   Show one tab per scenario (byte parse, burst logs at N terminals, scroll, latency), WebGL against
   xterm.js WebGL like for like (owner rule), version per bar, one method line, a link to
   `docs/benchmarks.md`, and an accessible table. performance-evidence.md item 7 ("0 dropped frames
   at 17 terminals streaming logs where xterm.js WebGL drops 12–13") is the strongest single row once
   re-run on the current build; that file also flags that the current pitch line overstates "every
   scenario". Move the block directly under the terminal window.
2. **Add the docs section** (Plan 336 D3) with Starlight at `/docs`, and point the header's Docs link
   there instead of `docs/integration.md` on GitHub. Include "Migrating from xterm.js" with an API
   mapping table; that page is the conversion path for xterm.js's ~90 listed users.
3. **A "replay in real time" toggle** beside the chart, or a side-by-side "xterm.js / ghostty-webgpu"
   tab in the live window running the same byte stream. This is the strongest possible proof and the
   most effort; schedule it after the chart.
4. **"Used in Fregat"** line with a link, as the first real-world use.
5. **Header:** keep the version badge; add a changelog link and a link back to Fregat.
6. **Open Graph image, sitemap, 404 page,** and a footer that links Singapore and Fregat.
7. **Typography and colour stay.** Bricolage Grotesque plus JetBrains Mono on a light page with a dark
   terminal is distinctive; use it as the shared docs look's base for both libraries, with accents per
   project.

### 3.4 hotkeys

A single page under the Fregat site (Plan 336 D4): H1, one paragraph, install, a live "press a
shortcut" box that shows the formatted chord as you type it (the recording feature is the demo),
three code samples, a link to the API reference.

---

## 4. Hero demo options for Fregat, effort against effect

| Rank | Option                                                                     | Effort                   | Effect     | Weight                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------- | ------------------------ | ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **C. Replica plus real parts on click**                                    | M+ (B plus about 2 days) | Highest    | B, plus the libraries only after a click                               | B's replica, with the editor pane and terminal pane swapping in a real Singapore editor and a real ghostty-webgpu terminal (the ghost frames already exist) when the visitor clicks or focuses them. Caption: "The editor and the terminal in this picture are real." No competitor can do this, because their parts are not separate libraries; it turns "every layer is ours" into something the visitor touches. Hydration follows the Singapore embed rules in 3.2. |
| 2    | **B. DOM replica with a scripted player** (Plan 155 as approved)           | M (Plan 155 phases 1–3)  | High       | under 40 KB gz plus fonts and wallpaper (Plan 155 estimate)            | Real `packages/ui` chrome rendered at build time, hand-built pane content, about 150 lines of player, t3code's gating, Cursor's named end state, `pointerdown` jumps to the end. Story as decided: one Claude turn end to end, Codex finishing in parallel. Ship B first; C layers on it.                                                                                                                                                                               |
| 3    | **A. One still screenshot**, WebP/AVIF at 2x, with three labelled callouts | XS (hours)               | Medium     | about 150 KB                                                           | What t3code ships, and it is the lightest page in the survey. The right stopgap while B is built, and the reduced-motion and no-JS fallback of B anyway. Drifts with every UI change.                                                                                                                                                                                                                                                                                   |
| 4    | **D. Short looping video** (AV1/WebM, muted, poster frame)                 | S–M                      | Medium     | 1–10 MB (opencode 10.1 MB, TanStack 1.5 MB, Augment 192 KB unreadable) | Easy to make from the `agent:browser` scenarios, keep as a "Watch the full demo" button like Zed, not the hero. Text is unreadable on phones, weight breaks the budget, drifts.                                                                                                                                                                                                                                                                                         |
| 5    | **E. rrweb replay of the real app**                                        | M                        | Medium–low | about 155 KB gz (93 KB snapshot plus 62 KB replayer, Plan 155)         | Cannot drift in look, but the WebGPU terminal and minimap canvases come out blank, which hides the two parts we most want to show.                                                                                                                                                                                                                                                                                                                                      |
| 6    | **F. A real browser-only build of the server**                             | XL, its own future plan  | Highest    | megabytes                                                              | Owner's long-term answer (Plan 155, question 1). Lives on its own "Try it" page when it exists, never in the hero.                                                                                                                                                                                                                                                                                                                                                      |
| —    | The current live-app iframe                                                | —                        | Negative   | 6.0 MB gz, fails to start embedded                                     | Deletion already decided (Plan 155, owner answer 1b).                                                                                                                                                                                                                                                                                                                                                                                                                   |

Two cheap extras that raise B and C: an **"Allow once" press** in the story (the one pointer moment
Plan 155 identified, using the physical-feel spring if it has shipped), and the **slash menu working
in the composer** (Cursor's only interactive piece, and it reads as "this is real").

---

## 5. Hosting notes (Track E)

### Where the platform is in October 2026

- Cloudflare acquired The Astro Technology Company on 2026-01-16; Astro stays MIT and
  multi-platform. Astro 6 moved its dev server onto the Vite Environments API so `astro dev` can run
  in workerd. Our sites are on Astro 7.3.5 (`apps/site/package.json`, `ghostty-webgpu/site`).
- **Astro's Cloudflare guide now deploys to Workers with static assets, not Pages**, and Cloudflare
  says "Cloudflare recommends using Cloudflare Workers for new projects." Pages is not deprecated.
- **A static Astro site needs no adapter.** `@astrojs/cloudflare` is only for on-demand rendering.
  None of our sites needs it.

Minimal config per site (`wrangler.jsonc` beside `astro.config`):

```jsonc
{
  "name": "singapore-site",
  "compatibility_date": "2026-10-08",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
  },
}
```

Build and deploy: `astro build && wrangler deploy`. Local check of the built output under the real
runtime: `astro build && wrangler dev`.

### Workers or Pages

Plan 336 decision 7 says Pages. The two are equivalent for static sites in what we need, with these
differences from Cloudflare's own compatibility table:

| Need                                         | Workers static assets                                                     | Pages                               |
| -------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `_redirects`, `_headers`                     | Yes, native                                                               | Yes                                 |
| Preview URL per upload                       | Yes (version URLs, on `workers.dev` only)                                 | Yes                                 |
| Stable per-branch preview alias              | Partial: `--preview-alias` at upload; "Custom Branch Aliases" coming soon | Yes, `<branch>.<project>.pages.dev` |
| Custom domain whose DNS is not on Cloudflare | No                                                                        | Yes                                 |
| Cloudflare's direction                       | Recommended for new projects                                              | Supported                           |

**Recommendation:** Workers static assets, one Worker per site, deployed from GitHub Actions with
`cloudflare/wrangler-action`. Main runs `wrangler deploy`; each PR runs
`wrangler versions upload --preview-alias pr-<number>` and comments the URL
`pr-<number>-<worker>.<subdomain>.workers.dev` on the PR (this per-PR workflow is our inference from
the docs, not a documented recipe; check the 63-character alias-plus-name limit). If the coordinator
wants Plan 336's wording kept, Pages with `wrangler pages deploy dist --project-name <site>
--branch <branch>` gives branch previews with less setup; either choice is reversible. Version URLs
are public by default; Cloudflare Access can gate them if previews should be private.

**Domains.** Workers custom domains require the zone's nameservers on Cloudflare. Register the
domains with Cloudflare Registrar, or move their DNS there, before Track E. Apex plus `www` redirect
per domain.

### Changes to the repository

1. Remove `base: '/fregat'` from `apps/site/astro.config.mjs` and `base: '/ghostty-webgpu'` from
   `ghostty-webgpu/site/astro.config.ts`; set `site` to each real domain. The ghostty site uses
   relative asset paths (`favicon.svg`, `fonts/…`), so it moves cleanly; the Fregat site builds URLs
   from `import.meta.env.BASE_URL` and needs a check.
2. Replace `.github/workflows/site.yml` (one job that assembles three sites into one Pages artifact)
   with one job per site, each with its own path filter. Drop the `apps/web/**` and `packages/**`
   triggers once the demo build is deleted (Plan 155); the Fregat site then rebuilds only when its
   own files or `packages/ui` tokens change.
3. Add `@astrojs/sitemap`, a `404.astro`, an Open Graph image per page, and `public/_headers`:
   - `/_astro/*` and hashed `fonts/*`: `Cache-Control: public, max-age=31536000, immutable`.
   - Everything else: Cloudflare's default revalidation.
   - No COOP/COEP: SharedArrayBuffer was removed from our designs, so cross-origin isolation is not
     needed and would block embeds.
4. Self-host fonts on the Fregat site (it loads JetBrains Mono from Google Fonts today) and preload
   the one or two faces the first screen uses, as the ghostty site does.
5. Turn on Astro's CSP support (stable since Astro 6) so inline scripts are hashed.
6. Analytics, if wanted, is an owner decision; Cloudflare Web Analytics is cookieless and needs no
   banner.

### Redirects from GitHub Pages

GitHub Pages cannot send HTTP redirects, so the old URLs need a stub site that redirects in HTML.
Five old origins serve today (all checked 2026-10-08):

| Old URL                                      | Status | Serves from                                 |
| -------------------------------------------- | ------ | ------------------------------------------- |
| `shaullavo.github.io/fregat/`                | 200    | fregat's `site.yml`                         |
| `shaullavo.github.io/fregat/editor/`         | 200    | fregat's `site.yml` (Singapore example app) |
| `shaullavo.github.io/fregat/ghostty-webgpu/` | 200    | fregat's `site.yml`                         |
| `shaullavo.github.io/ghostty-webgpu/`        | 200    | the ghostty-webgpu mirror's own Pages       |
| `shaullavo.github.io/singapore/`             | 200    | the singapore mirror's own Pages            |

The last two are published from the read-only mirror repositories, so the redirect stub has to reach
them through the mirror sync or their Pages settings; Track E must check how each mirror publishes
before switching anything off.

The stub, generated by a small script:

- For every known path, an `index.html` with `<link rel="canonical" href="NEW">`,
  `<meta http-equiv="refresh" content="0; url=NEW">` and a one-line script that calls
  `location.replace` with the new origin plus the old path's remainder, search and hash, so deep
  links survive. Google treats an immediate meta refresh like a permanent redirect.
- A `404.html` with the same script for paths the stub does not list.
- A visible link to the new URL for people without JavaScript.

Keep the stubs for a few months (Plan 336 E3), then disable Pages on all three repositories. On the
new domains, `_redirects` covers any renamed paths (2,000 static and 100 dynamic rules, 301/302/
303/307/308, splats with `:splat`; redirects run before assets and headers).

---

## Checklist for Track D and Track E

- [ ] Fregat H1 names the category; the subhead carries local, your own agents and our own parts.
- [ ] Every speed claim on every site sits beside its number, machine, versions, method line and a
      reproduce link, Bun-style, with an accessible table.
- [ ] Fregat hero: ship Plan 155's replica (option B), with the still screenshot (A) as the no-JS
      and reduced-motion frame, then add the real-parts upgrade on click (C).
- [ ] Fregat has a "Your agents, your plans" section with the login commands table and the
      "proxies nothing" sentence.
- [ ] Fregat's speed proof comes from the parts' benchmark pages; no platform latency numbers.
- [ ] Singapore home follows the CodeMirror outline in 3.2; the live editor's first frame is
      rendered at build time; the minimal editor bundle is measured before the page is built.
- [ ] ghostty-webgpu: Measured block turned on as a Bun-style chart under the terminal, docs at
      `/docs`, xterm.js migration page, "Used in Fregat".
- [ ] Each site: version and latest-release line, Docs in header and hero, `llms.txt`, OG image,
      sitemap, 404, self-hosted fonts, reduced motion respected, off-screen motion paused.
- [ ] Budgets: Fregat under 400 KB before interaction, Singapore under 500 KB, ghostty-webgpu no
      heavier than today; Lighthouse mobile 95+.
- [ ] Hosting: Workers static assets (or Pages, coordinator's call), one per site, PR previews from
      GitHub Actions, domains on Cloudflare DNS, `_headers` for immutable assets.
- [ ] GitHub Pages: redirect stubs on all five old URLs, including both mirrors, then Pages off.

## Sources

- Sites surveyed: [cursor.com](https://cursor.com), [zed.dev](https://zed.dev),
  [warp.dev](https://www.warp.dev), [ghostty.org](https://ghostty.org),
  [ghostty.org/docs](https://ghostty.org/docs), [linear.app](https://linear.app),
  [bun.com](https://bun.com), [vite.dev](https://vite.dev), [biomejs.dev](https://biomejs.dev),
  [raycast.com](https://www.raycast.com), [t3.chat](https://t3.chat), [t3.codes](https://t3.codes),
  [opencode.ai](https://opencode.ai), [tldraw.dev](https://tldraw.dev),
  [codemirror.net](https://codemirror.net), [lexical.dev](https://lexical.dev),
  [xtermjs.org](https://xtermjs.org), [astro.build](https://astro.build), [oxc.rs](https://oxc.rs),
  [tanstack.com](https://tanstack.com), [voidzero.dev](https://voidzero.dev),
  [ampcode.com](https://ampcode.com), [tailwindcss.com](https://tailwindcss.com).
- [ghostty-org/website](https://github.com/ghostty-org/website) (stack and frame tooling).
- CodeMirror site source: `references/codemirror-website` (84be9d7, 2026-04-15).
- t3code marketing site: `references/t3code/apps/marketing/src/lib/homeMotion.ts`.
- [Astro: Deploy to Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare/).
- [Cloudflare: Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).
- [Cloudflare: Workers static assets redirects](https://developers.cloudflare.com/workers/static-assets/redirects/).
- [Cloudflare: Workers version URLs and previews](https://developers.cloudflare.com/workers/configuration/previews/).
- [InfoWorld: Astro web framework maker merges with Cloudflare](https://www.infoworld.com/article/4118245/astro-web-framework-maker-merges-with-cloudflare.html).
