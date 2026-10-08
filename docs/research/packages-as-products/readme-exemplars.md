# README and repository front pages: what the best do

Track A, topic 1 of [Plan 336](../../../plans/336-packages-as-products.md). Collected 2026-10-08 from
the GitHub REST and GraphQL APIs (`repos/<o>/<r>`, `/readme`, `/community/profile`, `.github/`
listings, `usesCustomOpenGraphImage`) and the npm registry (`registry.npmjs.org/<pkg>/latest`).
Raw READMEs were read in full for the first screen and section order; star counts are as of that
date.

Repositories studied (26): Bun, Vite, Biome, Oxc, Zed, Ghostty, Tauri, Astro, tldraw, Excalidraw,
Yjs, Loro, TanStack Query, xterm.js, CodeMirror, Monaco, Lexical, Tiptap, opencode, t3code, uv,
Ruff, Bubble Tea, shadcn/ui, plus Tailwind CSS, Warp and coder/ghostty-web (the closest competitor
to ghostty-webgpu). For the read-only mirror pattern: symfony/console and illuminate/support.

## 1. Patterns the best share, ranked by impact

Ranked by how much each one changes a visitor's first ten seconds, weighted by how many of the
leaders do it.

### 1. One sentence that says what it is, for whom, and the edge, before anything else

Every leader puts a single sentence above the fold that names the category and the advantage. The
best ones are under 15 words and contain one concrete differentiator.

- uv: "An extremely fast Python package and project manager, written in Rust."
- Ruff: "An extremely fast Python linter and code formatter, written in Rust."
- tldraw: "Build infinite canvas apps in React with the tldraw SDK."
- Ghostty: "Fast, native, feature-rich terminal emulator pushing modern features."
- Astro: "The web framework for content-driven websites."
- opencode: "The open source AI coding agent."
- xterm.js (About): "A terminal for the web."

The same sentence is reused as the GitHub About description, the npm `description` and the site's
`<title>`. Astral's projects repeat it verbatim in all three. The weak ones (Biome's About, "A
toolchain for web projects, aimed to provide functionalities to maintain them…") read like
committee prose and are the exception.

The second sentence, when there is one, resolves a tension. Ghostty: "they all force you to choose
between speed, features, or native UIs. Ghostty provides all three." Bun: "a drop-in replacement
for Node.js". ghostty-web: "Migrate from xterm by changing your import". This is the pattern
Fregat needs, because at a glance it looks like another Cursor.

### 2. Proof on the first screen, as a chart or a number with a link

The two repositories that sell speed best (uv, Ruff) put a benchmark bar chart directly under the
pitch, before install. The chart:

- is an SVG with dark and light variants through `<picture>`,
- has a one-line italic caption naming the exact workload ("Linting the CPython codebase from
  scratch", "Installing Trio's dependencies with a warm cache"),
- links to a `BENCHMARKS.md` that states machine, versions and method.

The next tier puts numbers inline with links: Biome ("[fast formatter](benchmark repo)",
"[97% compatibility with Prettier]", "[more than 500 rules]"), uv ("[10-100x faster] than pip"),
Ghostty (in prose: "within a few percentage points" of Alacritty, "something like 100x faster
than Terminal.app"). Nobody serious writes "blazing fast" without a link; Tauri does and it reads as
filler.

Social proof is the third form, used when the project is adopted: "Who's using" lists with logos
or names (Oxc, tldraw, xterm.js "Real-world uses", Excalidraw, Ruff, Bubble Tea "in the wild"),
and Ruff's testimonials section, where every quote carries a number ("pylint takes about 2.5
minutes… ruff… .4 seconds"). We have no adopters yet, so charts and numbers are our only proof.

### 3. A hero visual that shows the thing working

Products and visual libraries show themselves; tools show a chart or a logo.

| Kind                  | Hero                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Product screenshot    | Excalidraw, Monaco, opencode, Warp, shadcn/ui (its OG image), Tiptap (cover), Astro (banner) |
| Animated GIF or video | Bubble Tea (GIF, full width), Loro (GitHub-hosted MP4 that autoplays inline)                 |
| Benchmark chart       | uv, Ruff                                                                                     |
| Logo or wordmark only | Bun, Vite, Oxc, Lexical, Tailwind, Ghostty, Loro, TanStack (generated per-package image)     |
| Nothing               | Zed, CodeMirror, t3code (text only, pushes to the website)                                   |

Two technical habits recur: `<picture>` with `prefers-color-scheme` sources so the logo or chart
fits GitHub's dark and light themes (Vite, Biome, Oxc, Lexical, Tailwind, opencode, Excalidraw,
tldraw, TanStack, uv, Ruff), and absolute image URLs hosted on the project's site or GitHub's
`user-attachments` CDN (Bun, Ghostty, uv, Vite, Oxc, Lexical), so the same README renders on npm
and mirrors. Astro's package README uses `../../.github/assets/banner.jpg`, which breaks outside
GitHub; it is the counter-example.

GitHub renders a video uploaded through the web editor (a `user-attachments` URL on its own line)
as an inline player, as Loro does. That is the only way to get video on a README; GIF remains
the fallback for npm, which does not play video.

### 4. A centered header block: logo, pitch, a short badge row, a link row

The common first-screen layout (Bun, Vite, Oxc, Ghostty, Lexical, tldraw, opencode, Tailwind,
Loro, Excalidraw):

```
          [logo, 60–170 px tall, dark/light]
          One-line pitch
     [npm] [CI] [license] [Discord]           ← 3–5 badges
   Docs · Getting started · Playground · Discord
```

The link row is the most useful element after the pitch: it gets readers to the docs or demo in
one click. Ghostty uses About · Download · Documentation · Contributing · Developing. tldraw uses
Docs · Examples · Starter kits. Lexical adds Playground. Ruff puts `**Docs** | **Playground**`
in bold above the pitch.

Left-aligned plain headers (Zed, uv, Ruff, xterm.js, Monaco, t3code) also read as professional
when the first element below the title is strong (uv's chart, Monaco's screenshot). Centering is a
convention, not a requirement; consistency across our four repositories matters more.

### 5. Badges: few, true and useful

| Badge                   | Used by                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| npm version             | Vite, Biome, Astro, tldraw, Lexical, Tiptap, opencode, Monaco (also `next` tag)  |
| CI status               | Vite, Biome, Oxc, Zed, Tauri, Astro, Lexical, Tiptap, Ruff, Bubble Tea, Tailwind |
| License                 | Oxc, Tauri, Astro, Excalidraw, Ruff, Tiptap, Tailwind                            |
| Discord / chat          | almost everyone                                                                  |
| Downloads               | tldraw, Excalidraw, TanStack, Lexical, Tiptap, Tailwind                          |
| Bundle size (bundlejs)  | TanStack Query                                                                   |
| Benchmark CI (CodSpeed) | Oxc                                                                              |
| "Built with X" endpoint | Zed, Ruff (a badge other repos copy, which spreads the name)                     |

The cleanest-looking repositories use 0–4 badges (Ghostty 0, shadcn/ui 0, Zed 2, Astro 3, uv 3).
The noisiest (Tauri 9 including FOSSA and an "affirmation" badge, Tiptap 8, TanStack with Scarf
pixel and semantic-release) look busy and dated. Badges for numbers that are still small (stars,
downloads) work against a new project; omit them until they flatter.

### 6. Install and first result in under a minute, shown as copyable code

Quick start is short everywhere: one install command, then the smallest program that shows
something.

- Astro, Tauri: one `npm create … @latest` line.
- tldraw: `npm i tldraw` plus an eight-line component.
- xterm.js: install, three lines to open a terminal, two lines to hook up a PTY.
- Bun, uv, opencode, t3code: `curl … | sh` plus package-manager alternatives.
- t3code: "To try it once without installing, run `npx t3@latest`." A zero-commitment trial is
  the strongest form.
- Monaco and Lexical link a playground; Astro links "Open a starter project right in your
  browser". A live demo link counts as the quick start for visual libraries.

Long install matrices (opencode's install-directory precedence, Bun's CPU requirements) come
after the short path, never before it.

### 7. The README is a front door; the docs site does the teaching

Median README length across the 26 is about 125 lines. The ones that read best are 50–150 lines
and link out to docs early and often (Vite 66, Zed 48, Astro 103, tldraw 139, Lexical 130). The
long ones carry something specific: Ruff (454) and uv (326) reuse README sections in their docs
site through `<!-- Begin section -->` markers; Bun (446) is mostly a link index into its docs;
Bubble Tea (402) inlines its tutorial. Yjs (1,457 lines of API reference) is the cautionary
example. A "Read the docs →" link sits within the first screen for Bun, Vite and TanStack.

### 8. A features list of 5–9 bold-lead bullets, each with a link

The standard "why" section is a bullet list where each item starts with a bold noun phrase and
ends with a link into the docs: xterm.js ("**Terminal apps just work**", "**Performant**",
"**Rich Unicode support**", "**Self-contained**", "**Accessible**"), Lexical, tldraw ("**Multiplayer**
— self-hostable real-time collaboration with `@tldraw/sync`"), uv's "Highlights" (every bullet
linked). Emoji-led bullets (Vite, Ruff, Excalidraw) are common but read as older style.

Two other shapes worth copying:

- **Addressing the obvious objection.** t3code: "Wait, what are you selling me? Nothing." xterm.js:
  "What xterm.js is not" (it is not a terminal app, it is not bash). Fregat needs the first kind
  (why this is not another Cursor). Our copy rules forbid "what it is not" phrasing in the app;
  in the README, frame the objection as a question and answer it with what Fregat is and does.
- **Roadmap and status table.** Ghostty's numbered table of its six big goals with ✅/❌, then a
  paragraph per goal. It shows ambition and honesty at once, and fits Decision 3 (planned work
  labeled as planned).

### 9. Comparison tables are rare in READMEs and live where the competitor is named fairly

Leaders mostly compare in docs or blog posts, not in the README. When a README has a table, it
is the challenger's (coder/ghostty-web: "Comparison with xterm.js", with issue links as evidence)
or a platform matrix (Tauri, opencode desktop downloads). A comparison table in our READMEs is
worth it for ghostty-webgpu (against xterm.js and ghostty-web, like for like, linked to the
benchmark page) and Singapore (against Monaco and CodeMirror), provided every cell links proof.

### 10. Community files make the repository look maintained

GitHub's community profile score: Bun, Oxc, Tauri and Astro reach 100%; most others 87%. What the
leaders have:

- **Issue forms in YAML**, not Markdown templates: Vite (bug, docs, feature), Bun (six forms
  including crash and TypeScript bugs), uv, Ruff, Zed (bug, crash), tldraw, shadcn/ui, opencode.
  Vite's bug form requires a reproduction link and `envinfo` output.
- **`config.yml` with `blank_issues_enabled: false`** and contact links that route questions to
  Discussions or Discord and plugin bugs to the right repository (Vite).
- **Pull request template** (Vite's asks what the PR solves, alternatives explored, tests, and
  has an AI-use disclosure section).
- **SECURITY.md** with a contact and response time (Bun: email, acknowledged within 5 days; Yjs
  adds `THREAT_MODEL.md`).
- **AI policy**: Ghostty (`AI_POLICY.md`), TanStack (`AI_POLICY.md`), Vite (in CONTRIBUTING and the
  PR template). Relevant for us, since outside contributors will use agents and our own work is
  agent-written.
- **Discussions on** for most (Bun, Vite, Biome, Oxc, Zed, Ghostty, Tauri, Excalidraw, Loro,
  TanStack, xterm.js, Monaco, Lexical, Tiptap, t3code, Ruff). Ghostty routes all users through
  Discussions first; only vouched contributors open issues, explained in a pinned issue.
- **Pinned issues** that orient visitors: Zed "Top-Ranking Issues", uv "Before posting in the
  issue tracker", Oxc "Plan for 2026 Q3".
- `AGENTS.md` is now near universal (17 of 26), `CODE_OF_CONDUCT.md` common, `FUNDING.yml` common
  for community projects, `ARCHITECTURE.md` at the root for Oxc and Tauri.

### 11. Monorepo front pages list the packages; package READMEs are short and self-contained

- Astro's README has a "Directory" table: package name, npm version badge linking its
  `CHANGELOG.md`. Vite has a "Packages" table. This is the model for `editor/README.md`, which
  fronts 21 packages.
- Package READMEs (what npm shows) are short and stand alone: Vite's `packages/vite/README.md`
  repeats the pitch and links the site; xterm.js addons are Install, Usage, link to the API
  typings; tldraw's package README is hero, install, usage, docs link; Lexical's explains the
  package's role in the system. TanStack generates a per-package hero image
  (`tanstack.com/api/readme/query.png?framework=react`).

### 12. Read-only mirrors say so everywhere and route people to the source

Symfony components and Laravel's Illuminate packages are the reference for mirrors of a monorepo
folder:

- About description begins "[READ ONLY] Subtree split of the Illuminate Support component (see
  laravel/framework)".
- Issues are disabled on the mirror.
- A `close-pull-request` workflow (`superbrothers/close-pull-request@v3` on `pull_request_target`)
  closes any PR with a polite comment pointing to the main repository.
- The README's "Resources" block: Documentation, Contributing, "Report issues and send Pull
  Requests in the main repository".

CodeMirror inverts it: the `dev` repository is the hub and bug tracker, and each package repository
points to the website. Either way, the visitor is never left guessing where to file.

### 13. Repository metadata: About, homepage, topics, social preview

- **About** = the pitch sentence (pattern 1). **Homepage** = the website or docs, never the README
  (uv points to `docs.astral.sh/uv`, Vite to `vite.dev`).
- **Topics** are used by most but not all (Ghostty, Zed, CodeMirror, Lexical, opencode and t3code
  have none or almost none). They help search and cost nothing; 5–10 accurate ones.
- **Custom social preview** (1280×640): Biome, Oxc, tldraw, Yjs, TanStack, opencode, shadcn/ui,
  Bubble Tea, Tauri set one; Bun, Vite, Zed, Ghostty, Astro, uv and Ruff rely on GitHub's
  generated card because their names already carry. An unknown project gains more from a custom
  card, since links get shared in chat and social feeds where the card is all people see.
- **Releases**: every leader publishes GitHub Releases (Vite 726, Ruff 430, Bun 217). A repository
  with zero releases looks unshipped. Our mirrors have none (Track G).

### 14. Tone: confident, specific, first-person plural, honest about limits

- Astral: terse, numeric, no adjectives without a number.
- Ghostty: candid "we" prose, explains trade-offs and its definition of "standard".
- t3code: casual and disarming ("We are very very early in this project. Expect bugs.").
- tldraw keeps a `VOICE.md`: confident, upfront, pragmatic, honest about work in progress, warm
  but efficient. Worth reading before Track B writes copy.
- Sentence case and real prose throughout; nobody among the leaders writes lowercase.

## 2. Per-repository notes

Format: first screen · pitch · badges · proof · quick start · community · metadata · length and
tone.

**oven-sh/bun** (96k stars, 446 lines). Centered logo (170 px), H1 "Bun", three badges (Discord,
stars, a joke "speed: fast" badge linking a benchmark tweet), link row Docs · Discord · Issues ·
Roadmap, then "Read the docs →". "What is Bun?" explains it in four sentences plus commented
one-line commands (`bun test  # run tests`). Install: script, PowerShell, npm, Homebrew, Docker,
then `bun upgrade --canary` (canary on every commit). Rest is a long link index into docs.
Community 100%: six issue forms, SECURITY.md (email, 5-day ack), CODE_OF_CONDUCT, PR template.
About: "Incredibly fast JavaScript runtime, bundler, test runner, and package manager – all in
one". No custom social card. Speed proof lives on the site, not the README.

**vitejs/vite** (83k, 66 lines). Centered dark/light logo, four badges (npm, node version, CI,
Discord), "Vite ⚡ / Next Generation Frontend Tooling", six emoji bullets, two-paragraph
explanation with every term linked, "Read the Docs". Packages table, Contribution, Sponsors image.
Issue forms (bug requires reproduction + envinfo), `config.yml` with blank issues off and contact
links, PR template with AI section, SECURITY in `.github`. The package README on npm is the same
pitch trimmed. About: "Next generation frontend tooling. It's fast!"

**biomejs/biome** (26k, 197 lines). Centered banner SVG with slogan (dark/light, 700 px), five
badges including VS Code and Open VSX, language switcher. Proof is inline and linked: "fast
formatter" → benchmark repo, "97% compatibility with Prettier", "more than 500 rules". Install,
four commented commands, docs links, long tiered sponsors section. Seven issue forms, GOVERNANCE,
RELEASES.md. Custom social card. Weakest part: the About description.

**oxc-project/oxc** (23k, 118 lines). Centered logo, two rows of badges (license, CI, coverage,
CodSpeed; Discord, Playground, Website as badges). Pronunciation, one-line definition, place in
VoidZero's toolchain. "Who's using Oxc?" names Rolldown, Nuxt, Shopify, ByteDance before any
install. Emoji section headings. Community 100%, ARCHITECTURE.md, pinned quarterly plan.

**zed-industries/zed** (91k, 48 lines). Left-aligned, H1, two badges (a custom "Zed" endpoint
badge and CI), one sentence ("a high-performance, multiplayer code editor from the creators of
Atom and Tree-sitter"), then Installation (download link), Developing, Contributing, Licensing,
"we're hiring". No hero image: the site does the selling. The provenance line ("from the creators
of") is its proof. Two issue forms (bug, crash), discussion templates, pinned "Top-Ranking Issues".

**ghostty-org/ghostty** (62k, 226 lines). Centered 128 px logo with name, two-line pitch (app and
`libghostty`), link row About · Download · Documentation · Contributing · Developing. No badges.
About section frames the trade-off it resolves. Roadmap and Status table with six goals and
status marks, then a section per goal with specific technical proof (SIMD parser, per-terminal
threads, xterm conformance audit). Issues are vouched-only; users start in Discussions with
templates; a pinned issue explains why. `AI_POLICY.md`, `HACKING.md`, `PACKAGING.md`. Strongest
model for a serious, candid voice.

**tauri-apps/tauri** (112k, 96 lines). Full-width splash image, nine badges (too many),
Introduction prose, Getting Started (`npm create tauri-app@latest`), feature bullets, platform
support table, partners. Community 100%, ARCHITECTURE.md, RELEASING.md. Custom social card.

**withastro/astro** (63k, 103 lines). Full-width banner, two-line centered pitch, three badges.
Install (`npm create astro@latest`), "Open a starter project right in your browser", Documentation,
Support, Contributing, then a Directory table of every package with an npm version badge linking
its changelog. Package README reuses the banner through a relative path (breaks on npm).
Discussions off; community support lives in a separate repository.

**tldraw/tldraw** (51k, 139 lines). Dark/light hero image, four badges (npm, downloads, Discord,
DeepWiki), H3 pitch, link row Docs · Examples · Starter kits. Feature highlights with bold leads
and links, "Who's using tldraw" (Google, Shopify, BlackRock, Autodesk) before quick start, quick
start of one install plus an eight-line component, starter kits, star history chart at the end.
Has VOICE.md, FAQ.md, TRADEMARKS.md, CLA.md, RELEASES.md. Custom social card.

**excalidraw/excalidraw** (134k, 124 lines). Dark/light cover image, link row, H2 two-line pitch
("Collaborative and end-to-end encrypted"), six badges, a product showcase image with caption,
emoji feature list, then the hosted app's extra features, quick start for the npm package,
"Who's integrating Excalidraw" logos.

**yjs/yjs** (23k, 1,457 lines). Logo as H1, blockquote pitch, short explanation, bullet links to
demos, discussion board, benchmark repo against Automerge, podcasts. Then sponsorship, "Who is
using Yjs", and the full API reference inline. Shows how proof by benchmark repo works, and how
not to put API docs in a README. `THREAT_MODEL.md`, `INCIDENT_RESPONSE.md`.

**loro-dev/loro** (6k, 169 lines). Centered logo, bold pitch "Make your JSON data collaborative
and version-controlled", Trendshift badge, link row, for-the-badge social buttons, an inline MP4
demo, a 1.0 announcement banner, feature groups, example code, DevTools, bindings, blog links.
Good example of video in a README.

**TanStack/query** (50k, 119 lines). Generated hero image (dark/light, per package), downloads,
stars and bundle-size badges, "Become a Sponsor!", H1, four-bullet pitch, "Read the docs →", then
partners and ecosystem links. Package READMEs use the same generated image per framework.
`AI_POLICY.md`, `FUNDING.json`, `.size-limit.json` (size budget in CI). Custom social card.

**xtermjs/xterm.js** (21k, 274 lines). Wordmark as H1, one paragraph naming users (VS Code and its
forks, and others), feature list with bold leads, "What xterm.js is not", Getting Started (install,
three lines, PTY hookup), addons, browser support, API, releases and beta builds, Real-world uses.
No badges. About: "A terminal for the web". npm `homepage` points to the GitHub README, which is
weaker than a docs site. Addon READMEs are minimal: install, usage, link to typings.

**codemirror/dev** (8k, 27 lines). Development hub only: bold link row WEBSITE | DOCS | ISSUES |
FORUM, then how to build. Everything about the product lives on codemirror.net. Works because the
website is excellent; for an unknown project, a README this thin undersells.

**microsoft/monaco-editor** (47k, 123 lines). H1, four badges (npm `latest`, npm `next`, feature
request count, bug count), one sentence ("the fully featured code editor from VS Code"), a
screenshot, "Try it out" in the playground, install, then a Concepts section (models, URIs,
editors, providers, disposables). The Concepts section is a good idea for an editor library.

**facebook/lexical** (24k, 130 lines). Centered dark/light logo, one-line pitch, four badges, link
row Documentation | Getting Started | Playground | …. Features with bold leads (framework
agnostic, accessible, extensible, collaborative via Yjs, typed), Quick Start pointing to vanilla
and StackBlitz, then React install. npm `homepage` missing on the `lexical` package.

**ueberdosis/tiptap** (39k, 141 lines). Cover image, eight badges, explanation, "How does the
Tiptap Editor work?" with bold-lead bullets, Pro extensions, collaboration backend, examples on
CodeSandbox, "Agent skill" section. Commercial upsell is clearly separated.

**sst/opencode → anomalyco/opencode** (212k, 129 lines). Centered dark/light logo, one-line pitch,
three flat-square badges, a 22-language switcher, then a full product screenshot linking the site.
Installation leads with `curl … | bash # YOLO` then every package manager; desktop app download
table; agents explained; docs link. No Discussions. Custom social card.

**pingdotgg/t3code** (26k, 135 lines). Text only. Explains itself ("agent harness control
surface"), names every provider it drives, then "Wait, what are you selling me? Nothing." with the
motivation and a promise of forkability. Install via script, `npx t3@latest` to try once,
desktop app via winget and Homebrew. "We are very very early in this project. Expect bugs." and
"(mostly) not accepting contributions yet". No About description at all. The objection-first
section is the idea to borrow for Fregat.

**astral-sh/uv** (90k, 326 lines). H1, three badges, the pitch, a benchmark bar chart (dark/light
SVG) with workload caption, Highlights (every bullet linked, "10-100x faster than pip" linked to
BENCHMARKS.md), "backed by Astral, the creators of Ruff and ty", install, feature walkthroughs
with terminal transcripts, FAQ, acknowledgements. The best example of proof-first.

**astral-sh/ruff** (50k, 454 lines). Same layout as uv plus a "Built with Ruff" badge others copy,
bold Docs | Playground links, a benchmark chart, emoji highlights, a list of major adopters, and a
Testimonials section where every quote has a number. README sections are reused by the docs site.

**charmbracelet/bubbletea** (45k, 402 lines). 350 px illustrated logo, three badges, a playful
pitch ("The fun, functional and stateful way to build terminal apps"), a full-width GIF of an app,
an upgrade-guide tip, a cross-promotion for Bubbles with its own GIF, then a full tutorial inline.
Strong brand illustration; tutorial inline suits a small API.

**shadcn-ui/ui** (125k, 17 lines). Title, two-sentence pitch, the site's OG image, links to docs.
Works only with a famous name and a great site.

**tailwindlabs/tailwindcss** (98k, 36 lines). Centered dark/light logo, pitch, four badges, links to
docs, Discussions and contributing. Minimal and polished.

**warpdotdev/Warp** (65k, 110 lines). Full product image at the top, link row to each product
area, About in one paragraph ("bring your own CLI agent (Claude Code, Codex, Gemini CLI, and
others)"), then install link and contribution dashboard. Shows how an app with agents positions
"bring your own agent", which is also a Fregat differentiator.

**coder/ghostty-web** (3k, competitor). npm version and downloads badges, pitch "Ghostty for the
web with xterm.js API compatibility", three bullets (migrate by changing the import, Ghostty's
parser in wasm, zero dependencies and about 400 KB), live demo on an ephemeral VM, `npx` local
demo, screenshot, then "Comparison with xterm.js" table with linked issues. ghostty-webgpu must
answer this page directly: same parser, plus measured rendering speed.

## 3. README templates

All three share: sentence case, absolute image URLs (Decision 8), `<picture>` dark/light for
logos and charts, alt text on every image, every number linked to its benchmark, planned items
labeled "planned" with a plan link, and a length target.

### (a) Product app: Fregat (`README.md`)

Target 100–160 lines. Models: Ghostty (candid voice, roadmap table), uv (proof up front), t3code
(objection answered), opencode and Warp (product screenshot first).

```markdown
<p align="center">
  <picture>…Fregat logo, dark/light, ~96 px…</picture>
</p>
<h1 align="center">Fregat</h1>
<p align="center">
  {Pitch sentence from Track B: category + the one edge. ≤ 15 words.}
</p>
<p align="center">
  [CI] [License] [Latest release]
</p>
<p align="center">
  Website · Download · Documentation · Roadmap · Discussions
</p>

{Hero: looping WebM uploaded as a user-attachments video, with a GIF/WebP still for npm and
feeds. Shows typing, a terminal, an agent session and a second device in ≤ 20 s.}

## Why Fregat

{Two or three sentences that resolve the tension: "Editors with agents trade speed for features
or lock you to one provider. Fregat …" Then 5–7 bold-lead bullets, each one differentiator
from the pitch, each with a number or a link:}

- **Fast as the browser allows.** Keystrokes land within one 120 Hz frame ([trace](…)).
- **Runs on your machine.** One local server; browser, desktop, Mac, terminal and phone clients.
- **Bring your own agents.** Claude Code and Codex on the subscriptions you already pay for.
- **Open it anywhere.** …
- **Built from its own parts.** Singapore, ghostty-webgpu and hotkeys (links).

## Speed

{One chart: dark/light SVG, caption naming the workload and machine, link to the method page.}

## Install

{Shortest path first (installer or `bunx …` to try once), then platform alternatives,
then "from source" in one line linking docs/development.md.}

## Quick start

{Three numbered steps to the first result: open a folder, open a terminal, start an agent.}

## Is this another Cursor?

{The objection as a question; answer with what Fregat is and does (local server, many clients,
your subscriptions, its own editor and terminal). Copy rules: no "rather than"/"not X".}

## Roadmap

| Goal | Status | ← Ghostty-style; planned items say "planned" and link the plan.

## The parts

| Project | What it is | Links | ← Singapore, ghostty-webgpu, hotkeys with their own pitches.

## Contributing

{One paragraph: how to start, AI policy link, where to ask.}

## License
```

Rationale: a product sells by showing itself, so the hero is motion and the first section is
"why". The objection section exists because the first impression ("another Cursor") is the main
risk. The roadmap table carries the planned work without overclaiming. Development detail moves
to `docs/development.md`.

### (b) Library: Singapore (`editor/README.md`) and ghostty-webgpu (`ghostty-webgpu/README.md`)

Target 120–200 lines. Models: uv and Ruff (chart under the pitch), xterm.js (feature bullets,
getting started that reaches a working terminal), tldraw (link row, short code quick start),
Astro (package directory table), Monaco (Concepts), ghostty-web (comparison table).

```markdown
<p align="center"><picture>…wordmark, dark/light…</picture></p>
<p align="center">{Pitch: "A code editor for the browser, built the way Zed is built." /
  "Ghostty's terminal core for the web, rendered on the GPU."}</p>
<p align="center">[npm] [CI] [License] [Bundle size, if it flatters]</p>
<p align="center">Docs · Live demo · API · Benchmarks · Discussions (in fregat)</p>

{Hero: benchmark chart (dark/light SVG) with caption "Rendering N MB of output, WebGL, M1 Pro,
2026-10-xx". For Singapore, a short GIF of a large file scrolling and editing, then the chart.}

## Highlights

{5–8 bold-lead bullets, each linked to a docs page or benchmark.}

## Install

npm install …

## Quick start

{≤ 15 lines of code to a working editor / a terminal attached to a PTY. Type-checked in CI.}

## Compared with {Monaco and CodeMirror | xterm.js and ghostty-web}

| | Us | A | B | ← every cell links proof; like for like; date and machine stated.

## Migrating from {xterm.js} ← ghostty-webgpu only: API mapping table or link.

## Packages

| Package | Version | What it does | ← Astro-style directory; Singapore lists all 21.

## Concepts

{3–5 short paragraphs or links: piece table and snapshots, anchors, workers / wasm core,
damage tracking, renderers. Links into the docs site.}

## Roadmap

{Planned items labeled planned, linked to plans (collaborative editing; addon ecosystem).}

## Contributing

This repository mirrors `editor/` in Fregat. Issues and pull requests go to Fregat (link).

## License
```

Rationale: developers choosing a library compare first, so proof (chart, comparison) sits above
install. A runnable quick start is the second filter. The package table and concepts section
answer "is this a serious system", which matters for an editor that competes with Monaco.

Package READMEs on npm (each of the 21 `@singapore-editor/*` and the ghostty-webgpu subpackages),
modelled on Vite's and xterm.js's addon READMEs, 20–60 lines:

```markdown
# @singapore-editor/{name}

{One sentence: what this package adds to Singapore.}
Part of [Singapore](absolute docs URL). [Docs](…) · [API](…) · [Changelog](…)

## Install

## Usage ← ≤ 15 lines, type-checked

## API ← link to the generated reference page

## License
```

### (c) Small utility: hotkeys (`hotkeys/README.md`)

Target 80–150 lines. Models: Bubble Tea (small API taught in the README), xterm.js addons
(install, usage, API link), Tailwind (clean header). A small library can teach itself in its
README because the whole API fits.

```markdown
# hotkeys

{Pitch: "Zed-style keyboard shortcuts for any app."}
[npm] [CI] [License] [Bundle size]
Docs · API · Used in Fregat

{Optional small GIF: a shortcut recorder and a chord being typed, with the formatted label.}

## Highlights

- **Context-aware.** The deepest focused context wins.
- **Chords.** `Mod+K Mod+C`.
- **Display and recording.** Platform-correct labels; record a shortcut from the keyboard.
- **DOM-free core.** Browser and terminal adapters.
- **React bindings.** `@fregat/react-hotkeys`.

## Install

## Quick start ← register, chord, unregister in ≤ 10 lines

## Contexts ← one example of the same key doing two jobs

## Formatting and recording

## Adapters ← browser, terminal

## API ← table of exports or link to the generated reference

## Contributing ← mirror note pointing to Fregat

## License
```

Rationale: for a utility, the reader decides from the code sample, so the sample comes early and
each feature gets one short example. No comparison table unless a fair, linked one exists
(TanStack Hotkeys and tinykeys would be the comparisons).

## 4. Checklist for Track C

State found on 2026-10-08, and the change to make. Items marked (B) wait for Track B's approved
pitch or visuals.

### READMEs

- [ ] Rewrite `README.md`, `editor/README.md`, `ghostty-webgpu/README.md`, `hotkeys/README.md` in
      sentence case from templates (a), (b), (b) and (c). Today all four are lowercase. (B)
- [ ] First screen of each: logo or wordmark, pitch sentence, ≤ 4 badges, link row, hero visual.
- [ ] One pitch sentence per project, reused verbatim as GitHub About, npm `description` and site
      `<title>`. (B)
- [ ] Every speed claim links a benchmark page that states date, machine, versions and method;
      charts are dark/light SVGs with a workload caption.
- [ ] Every image uses an absolute URL (site or `raw.githubusercontent.com/ShaulLavo/fregat/main/…`)
      so it renders in fregat, the mirror and npm. Today `editor/README.md` and
      `ghostty-webgpu/README.md` use relative `docs/images/*.webp`, and the root README uses
      `docs/images/workbench.webp`.
- [ ] Hero for Fregat: short looping video (user-attachments upload) plus GIF/WebP fallback. (B)
- [ ] Quick start code in every README is type-checked in CI (Decision 6; shared with Track F).
- [ ] Planned features say "planned" and link the plan; no dates.
- [ ] Singapore and ghostty-webgpu READMEs include a like-for-like comparison table with linked
      proof; ghostty-webgpu adds a "Migrating from xterm.js" link or table, answering
      coder/ghostty-web's README.
- [ ] `editor/README.md` gets a package directory table (name, npm version badge, one line).
- [ ] Add a short package README to every published package that lacks one, from the package
      template in section 3(b); check all 21 `editor/packages/*/README.md` against it.
- [ ] Fregat README: "Is this another Cursor?" section and a roadmap status table. (B)
- [ ] Length check: Fregat 100–160 lines, libraries 120–200, hotkeys 80–150. Detail moves to docs.
- [ ] Run the `unslop` skill over every README before merge.

### Badges

- [ ] npm version (shields.io `npm/v/<pkg>`), CI (the workflow badge for `ci.yml`), license.
- [ ] Bundle size (bundlejs or pkg-size) for hotkeys and ghostty-webgpu's JS, only if it reads well.
- [ ] No stars or downloads badges until the numbers help. Badges in one row, same style.

### package.json (every published package)

Today: all 21 `@singapore-editor/*` packages lack `description` (except textbuffer), `keywords`,
`homepage`, `bugs` and `license`. `ghostty-webgpu` has `homepage` pointing at the GitHub README
and `repository` pointing at the mirror. `@fregat/hotkeys` and `@fregat/react-hotkeys` lack
`homepage` and `bugs`.

- [ ] `description`: the pitch sentence (root package) or the package's one line.
- [ ] `keywords`: 5–12 accurate terms (npm search uses them; Vite 6, xterm.js 13, Biome 11).
- [ ] `homepage`: the docs page for that package (preview URL until Track E's domains exist).
- [ ] `repository`: `{ "type": "git", "url": "git+https://github.com/ShaulLavo/fregat.git",
"directory": "<path>" }` for every package, ghostty-webgpu included, so npm links to the
      source of truth.
- [ ] `bugs`: `https://github.com/ShaulLavo/fregat/issues` (with a label query per project if
      wanted).
- [ ] `license`, `author`, `funding` (only if the owner wants funding links).
- [ ] Confirm `type`, `exports`, `types` and `sideEffects: false` where true (leaders set it; it
      helps tree-shaking and bundle-size badges).
- [ ] `files` limits the tarball to built output, README and LICENSE; check with `npm pack --dry-run`.

### Repository settings (`gh api -X PATCH repos/ShaulLavo/<repo>`)

Today: fregat and singapore have no About description; fregat, singapore and hotkeys have no
topics; hotkeys has no homepage; homepages point at `shaullavo.github.io`.

- [ ] About description = pitch sentence. Mirrors append "Read-only mirror of `<dir>/` in
      ShaulLavo/fregat." (hotkeys already does; add to singapore and ghostty-webgpu).
- [ ] Homepage = the project's site or docs (preview URL until Track E).
- [ ] Topics, 5–10 each (`PUT repos/<o>/<r>/topics`): for example Singapore `code-editor`,
      `text-editor`, `piece-table`, `tree-sitter`, `lsp`, `typescript`, `browser`; ghostty-webgpu
      keeps its six and adds `xterm`, `terminal-emulator`, `webgl`; hotkeys `keyboard-shortcuts`,
      `hotkeys`, `keybindings`, `typescript`, `react`.
- [ ] Discussions on in fregat with categories Q&A, Ideas, Show and tell, Announcements.
- [ ] Disable the wiki where unused (fregat, ghostty-webgpu and hotkeys have it on).
- [ ] Social preview images, 1280×640, one per repository (all four use the generated card
      today). Upload via browser automation on Settings → Social preview, or hand the files to the
      owner. (B)
- [ ] Add a root `LICENSE` to fregat and `editor/` (neither has one; GitHub shows "No license"
      for fregat and singapore, which reads as unusable to outside developers). License choice is
      the owner's; ghostty-webgpu and hotkeys are MIT.

### Mirrors (singapore, ghostty-webgpu, hotkeys)

Today issues are enabled on all three mirrors, and nothing closes pull requests opened there.

- [ ] Disable issues on the mirrors (`has_issues: false`), as Symfony and Illuminate do.
- [ ] Add a `close-pull-request` workflow to each mirrored folder's `.github/workflows/` (or have
      `mirror.yml` write it) that closes PRs with a comment linking fregat.
- [ ] README "Contributing" section in each mirrored folder: issues and PRs go to fregat, with
      absolute links.
- [ ] Publish GitHub Releases on the mirrors (or link fregat's releases) so the sidebar does not
      show "No releases" (with Track G).

### Community files (fregat `.github/`)

Today fregat's `.github/` holds only `actions/`, `workflows/` and `github_known_hosts`.

- [ ] `CONTRIBUTING.md`: setup in five commands, where to ask, how PRs are reviewed, changeset
      rule, link to the AI policy.
- [ ] `SECURITY.md`: private reporting through GitHub security advisories, response time.
- [ ] `AI_POLICY.md` (or a section in CONTRIBUTING): disclosure and review expectations for
      agent-written PRs, like Ghostty, TanStack and Vite.
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant) to reach 100% community profile.
- [ ] Issue forms in YAML: bug report (project dropdown: Fregat, Singapore, ghostty-webgpu,
      hotkeys; version; OS and browser; reproduction; logs), feature request. Enabled after
      Track H empties the tracker.
- [ ] `ISSUE_TEMPLATE/config.yml`: `blank_issues_enabled: false`; contact links to Discussions
      Q&A and the docs.
- [ ] `pull_request_template.md`: what it changes for the user, how it was tested, changeset
      added, AI disclosure.
- [ ] `FUNDING.yml` only if the owner wants it.
- [ ] Labels per project (`fregat`, `singapore`, `ghostty-webgpu`, `hotkeys`) applied by the
      issue form's dropdown or a labeler.
- [ ] One pinned issue or Discussion: "Start here", explaining where to ask and how issues are
      triaged.

### Review before merge

- [ ] Screenshot each front page on GitHub in dark and light themes at desktop and phone widths,
      and each npm package page after a `next` publish; send to the owner (Plan 336 acceptance).
- [ ] Check every link and image from a logged-out browser on fregat, the mirror and npm.
- [ ] Compare each first screen side by side with uv, Ghostty and tldraw; it should hold up.
