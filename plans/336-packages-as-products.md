# Plan 336: Our packages look and read like products

## Status and authorization

- Status: APPROVED. Owner request 2026-10-08. Revised the same day after the research round in
  [docs/research/packages-as-products/](../docs/research/packages-as-products/README.md).
- Scope: Fregat, Singapore, ghostty-webgpu and hotkeys, plus tree-sitter-x and tree-sitter-md as the
  parsers behind Singapore. Their GitHub repositories, npm pages, websites, documentation, release
  cycle and issue tracker. Mesh, fast-ulid and the other owned repos stay out until the owner adds them.
- Priority: P1. Effort: XL in total, split into tracks that mostly run in parallel.
- Owner decisions 2026-10-08: MIT for everything (done: `LICENSE` files and `license` fields). npm
  publishing setup and the domains/Cloudflare token come last, once everything else is done. Versions
  stay as they are: patch bumps only, no 1.0.0, no version-policy changes while we are setting up.
- Planned against Fregat `0df5eb872`.

## Outcome

Someone who lands on any of our repositories, npm pages or sites sees a serious project within ten
seconds: what it is, the one thing it does better, proof they can rerun, and a one-minute way to try
it. npm serves current code. Singapore and ghostty-webgpu have documentation as good as the best in
their category. Sites live on our own domains, built with Astro, off GitHub Pages. Releases have a
cycle with changelogs written for users. The issue tracker is empty of agent-filed work, ready for
outside users.

## What the research found

Twelve reports, summarized in the [research README](../docs/research/packages-as-products/README.md).
The facts that change the plan:

- **npm serves ten-day-old code.** `@singapore-editor/core` and `ghostty-webgpu` are 0.1.2 on npm
  (2026-09-28); the repo has 0.2.6 and 0.3.20. 21 version PRs merged since, but the publish job only
  runs when the `NPM_TRUSTED_PUBLISHING` variable is `true`, and it was never set.
  `@fregat/hotkeys` was never published. `ghostty-webgpu/package.json` points `repository.url` at the
  mirror, which trusted publishing rejects; the pinned npm 11.19.0 cannot move dist-tags (11.21.0+).
- **There is no license** on the fregat root, `editor/`, or any `@singapore-editor/*` package, so
  neither can be called open source. ghostty-webgpu and hotkeys are MIT.
- **Several claims we wanted are false or unproven today.** ghostty-webgpu is not faster in every
  scenario (WebGL loses on Unicode and scroll, DOM on interactive edits, p95 input latency is worse);
  "18× less memory" omits wasm memory (fair figure 43.6 vs 52.4 MiB whole browser). Fregat has no
  competitor measurement and no "one 120 Hz frame" proof (1–10 MiB TypeScript types at 56–254 ms
  p95 with analysis on). Singapore has never been measured against Monaco or CodeMirror in a browser.
- **Positioning lines are taken.** "An open Cursor" was Void's (archived June 2026). "A modern Monaco"
  is the tagline of `modern-monaco`. Open source, local, bring-your-own-agents, parallel agents and
  phone access are table stakes among T3 Code, Paseo, Orca, Nimbalyst and Emdash.
- **We have far more to sell than the READMEs say**, verified in code; see the pitch section.
- **Wrong copy is live:** the Fregat site promises a native phone app and says "no releases yet"; the
  README says "native mac" (apps/mac is a stub titled "Platform"; the shipped Mac app is a webview).
- **Tooling:** TypeDoc and twoslash crash on our TypeScript 7; pin `typescript@6` in the docs
  workspace. Cloudflare (which bought Astro in January 2026) recommends Workers static assets over
  Pages.

## Decisions

1. **Sentence case, real prose.** READMEs, sites and docs use normal capitalization and full
   sentences. The lowercase house style goes. Copy follows the AGENTS.md copy rules and the `unslop`
   skill.
2. **Every number links its method.** A speed claim sits beside its number, machine, versions, date and
   a reproduce link (bun.com's benchmark block is the model). Like for like only: WebGL against xterm.js
   WebGL, DOM against DOM. A claim without proof waits for Track P.
3. **Planned work shows as a status table**, Ghostty-roadmap style (done / in progress / planned), each
   row linking its plan. Announce only items that are Approved and started, or that the
   [roadmap report](../docs/research/packages-as-products/roadmap-highlights.md) marks "announce now".
4. **Astro everywhere; Starlight for docs** with Pagefind search and `starlight-typedoc` reference,
   generated from built `.d.ts` with `typescript@6` pinned in the docs workspace.
5. **Every code sample in docs and READMEs is type-checked in CI.** Long examples are real files the
   page shows and the live demo runs; inline blocks are extracted and compiled. Internal links are
   checked per build, external links weekly.
6. **Hosting is Cloudflare Workers with static assets**, one Worker per site, our own domains, PR
   previews. GitHub Pages turns off after redirect pages cover all five old addresses.
7. **Mirrors are read-only and say so:** "[READ ONLY]" in the description, Issues off, a workflow that
   closes PRs with a pointer to fregat. Links inside mirrored folders are absolute URLs.
8. **Lead with what only we have; keep table stakes as features.** "Use your Claude subscription" is a
   feature line, not the headline: Anthropic's terms for Agent SDK use with subscription logins are
   unsettled.

## The pitch, per project

Starting brief for Track B. Each item is verified in code by the research reports, which hold the
file and commit evidence.

**Fregat.** Category: a complete, fast IDE in your browser, on your machine, with your agents
inside. The closest rival (Orca) is VS Code's editor plus xterm.js; ours is built from our own parts.

- _Every layer is ours, built for speed._ Singapore editor, ghostty-webgpu terminals, language servers
  and git in one workspace. Speed is proven through the Singapore and ghostty-webgpu benchmark pages
  until Track P measures Fregat itself.
- _Work keeps going._ One server per machine shared by every window, browser and phone; terminals
  survive server restarts and replay their output; updates wait for running agent turns, check
  themselves live and roll back; a reload repaints before any network reply.
- _Review agents like pull requests._ Undo or reapply one hunk of a turn, batch line comments into one
  message, fork from any turn, have a second model review a change, fan one prompt out to several
  models each in its own worktree. Claude's edits get the language server's new errors back within
  1.5 s.
- _Nothing is lost._ A browsable undo graph that survives closing the file, and undo in the file tree
  that brings back a deleted folder with its tabs and unsaved edits.
- _Bring your own agents._ Claude Code and Codex on your logins, side by side, permission rules saved
  as real rules in each tool; usage, limits and cost per chat.
- Visual demos: theme bundles (palette, code theme, wallpaper, glass material in one click), Theme
  Studio, Fix with AI on every error, the 200 MiB file test.
- Must not claim: native Mac app, downloads, Windows, phone over Tailscale without setup, one-frame
  typing, Cursor/OpenCode support (off by default), collaboration, debugger, extensions, Vim.

**Singapore.** Not "a modern Monaco" (taken). Working line: the editor built the way Zed is built,
for the browser.

- Every edit returns a new version; old versions stay readable. Anchors survive edits, even deletion.
- Parsing, highlighting, the minimap, spellcheck and the real TypeScript language service run in
  workers that receive edits, never whole documents. (The document itself lives on the main thread.)
- Modern platform: CSS Custom Highlight API paint, EditContext input (Chromium), OffscreenCanvas,
  `Intl.Segmenter`, `scheduler.postTask`. Not used: WebGPU, WebGL, SharedWorker.
- Measured limits: 200 MiB editable, 600 MiB read-only in about 2.3 MiB of heap; syntax tokens per
  keystroke went from 155 ms to 0.004 ms.
- Planned: collaborative editing following Matt Weidner's
  [Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html),
  with FugueMax placement so concurrent typing doesn't interleave (E066/E067, not started).
- Gaps to fix or avoid: no Monaco/CodeMirror benchmark, bundle size unmeasured, no bold/italic syntax,
  no inlay hints, find stops at 19,999 matches, no screen-reader audit.

**ghostty-webgpu.** Ghostty's own terminal core in the browser, and the only web terminal that
publishes reproducible benchmarks against its rivals.

- Unpatched upstream libghostty-vt, pinned and reproducible.
- Parsing 2.6–5.2× xterm.js and ghostty-web (rerun on current release before quoting); about 25% less
  energy than xterm.js WebGL and 62% less than xterm.js DOM on streaming output; about half the idle
  CPU.
- Four renderers (WebGPU, WebGL2, Canvas 2D, DOM) that redraw only changed cells; a worker mode; first
  frame rendered into the page's HTML.
- Correctness: Kitty keyboard, Ghostty grapheme widths, OSC 8 links, policy-gated clipboard. Rivals
  crashed (ghostty-web on Unicode) or dropped emoji (xterm.js on split bytes) in our runs.
- Planned: the addon set xterm.js users expect. Search first; then images, serialize, progress/cwd/
  notification events (cheap: Ghostty already parses them).
- Must not claim: faster in every scenario, 18× memory, only WebGPU Ghostty (restty exists), small
  bundle, Firefox/Safari/Windows numbers.

**hotkeys.** Zed's keymap model for the web, with no rival on npm: bindings depend on focus context,
users override or remove a pack's binding, one keymap drives browser and terminal. Matches a key in
under 0.2 µs. Keep the MIT notice from its TanStack origin.

**tree-sitter-x and tree-sitter-md.** The reason Singapore parses fast: tree-sitter-x reparses 1 MB
Markdown in 0.35 ms instead of 0.82 ms; tree-sitter-md passes 676/676 CommonMark and GFM examples.
Sold through Singapore's pages and their own READMEs.

## Track 0: Prerequisites (starts now)

1. Done 2026-10-08: MIT `LICENSE` at the root, in `editor/` and in every published package, with
   `license` fields.
2. Fix wrong live copy: the site's native phone app and "no releases yet", the README's "native mac",
   remaining "Platform" names in `apps/mac` and `apps/tui`.
3. Make the mirrors read-only (decision 7).

## Track N: npm publishing (last, with Track E)

Owner decision: after everything else is done. Then: fix `ghostty-webgpu`'s `repository.url`, pin npm
11.21.0+, pass `GITHUB_TOKEN` to the release script, owner configures the npm trusted publisher and
confirms the `@fregat` scope, set `NPM_TRUSTED_PUBLISHING=true`, publish current versions and confirm
on npm. Until then, READMEs and docs install from npm as written; the published 0.1.2 is known stale.

## Track P: Proof (starts now; benchmarks run through the heavy-job runner)

From the [performance report](../docs/research/packages-as-products/performance-evidence.md):

1. Copy the reviewed 2026-10-08 terminal wave results into `ghostty-webgpu/docs/benchmarks/`, then one
   Mac session across all six renderers with equal history. Rewrite `benchmarks.md` like for like,
   with fair memory figures, and turn on the site's "Measured" block.
2. Singapore: add CodeMirror 6 to the text-buffer CI benchmark; then a browser comparison of
   Singapore, Monaco and CodeMirror on the existing input-latency suite (large-file open, typing p95,
   memory). Measure the smallest editor bundle.
3. Fregat: land Plan 201's typing metric, then measure keystrokes, tab switches and large-file open
   against VS Code for the Web; measure terminal reattach after a server restart. Rerun the 200 MiB
   test on a committed build.
4. Correctness: run an esctest2 subset against ghostty-webgpu, xterm.js and ghostty-web.

## Track B: Pitch (after Track P's first results; owner reviews)

1. Write `docs/research/packages-as-products/pitch.md` from the section above: per project the
   one-liner (15 words or fewer, reused as GitHub, npm and site description), three to five
   differentiators with proof, the status table of planned work, and the "must not claim" list.
2. Publish it to the owner as a private Mesh app. Tracks C and D publish copy only after approval.
3. Visuals: hero screenshots or short loops (WebM plus GIF for GitHub), 1280×640 social images, and a
   wordmark per project consistent with the Fregat icon. Benchmark charts in light and dark.

## Track C: Repositories and npm pages (after the pitch is approved)

Follow the [README report](../docs/research/packages-as-products/readme-exemplars.md) templates and
checklist:

1. Rewrite the four READMEs (centered header, pitch, 3–4 badges, link row, hero, proof chart, quick
   start, bold-lead feature bullets into docs, status table) and a template-based README for every
   published package. Fregat gets a "what are you selling me?" section. Images use absolute URLs.
2. `package.json` for every published package: `description`, `keywords`, `homepage`, `bugs`,
   `license`, `repository.directory`.
3. `gh api`: About descriptions, topics, homepage URLs, Discussions on fregat. Social preview images
   go through the GitHub web UI via browser automation.
4. Community files in fregat: `CONTRIBUTING.md`, `SECURITY.md`, an AI-contribution policy, issue forms
   per product with questions routed to Discussions, a PR template.

## Track D: Sites (after the pitch is approved; D1–D3 in parallel)

Follow the [landing-sites report](../docs/research/packages-as-products/landing-sites.md) outlines:

1. **Fregat** (`apps/site`): headline names the category; execute
   [Plan 155](155-site-demo-replica.md)'s animated replica, upgraded so the editor and terminal panes
   become the real libraries on click; a bring-your-own-agents section with the login commands; speed
   proven through the library benchmark pages; links to the Singapore and ghostty-webgpu sites.
2. **Singapore** (new, `editor/site`): CodeMirror-style plain home page; a live "edit this" editor
   whose first frame is rendered at build time and which loads when scrolled into view; a
   "million-line file" button; then docs.
3. **ghostty-webgpu**: keep the site; add the benchmark chart under the terminal, the docs section,
   an xterm.js migration page and a "Used in Fregat" line.
4. hotkeys gets a docs page on the Fregat site.
5. Every site: under 1 MB on first load, readable without JavaScript, reduced motion, Open Graph
   images, sitemap, 404, `llms.txt`. Screenshots at desktop and phone widths go to the owner.

## Track E: Hosting (last, with Track N; site builds do not wait)

1. Owner chooses the domains (DNS on Cloudflare) and grants a Cloudflare API token as a GitHub
   Actions secret.
2. One Worker with static assets per site; CI deploys main to production and PRs to previews,
   replacing `.github/workflows/site.yml`'s Pages deploy.
3. Redirect pages at the five old GitHub Pages addresses (two in the mirror repos), then disable
   Pages. Update every link in READMEs, `package.json` and docs.

## Track F: Documentation (after Track 0; alongside D)

Follow the [docs report](../docs/research/packages-as-products/docs-exemplars.md) contents and
checklist:

1. Sections: Start here, Guides, Examples, Reference, Concepts. No empty sections; ★ pages first.
2. Singapore: "Coming from Monaco" and "Coming from CodeMirror"; guides for themes, languages and
   tree-sitter, LSP, React and Solid, large files, decorations, plugins; concepts from
   `editor/ARCHITECTURE.md` and `editor/docs/`; an embedded live-editor examples gallery.
3. ghostty-webgpu: "Coming from xterm.js" (API mapping table) and "Coming from ghostty-web"; guides for
   a PTY over WebSocket, renderers and fallbacks, fonts, themes, workers, hotkeys; concepts for damage
   tracking and the wasm core; the benchmarks and correctness pages. Engineering notes stay in the repo.
4. Verify StackBlitz runs WebGPU, wasm and workers before any example links there; keep live WebGL
   embeds per page under Chrome's context limit.

## Track G: Release cycle (after Track 0; no version changes)

Owner decision: versions are untouched while we set up. Patch bumps only, no 1.0.0, no new version
policy. This track improves how releases read, not how they are numbered. Follow the
[release report](../docs/research/packages-as-products/release-cycles.md):

1. `docs/releasing.md` describes today's cycle: Changesets, patch only, fixed groups, the version PR.
   Channels (`next` snapshots, pkg.pr.new previews) wait for Track N.
2. `@changesets/changelog-github`; changeset summaries describe what a package user sees, in plain
   words, with the good/bad examples from the report added to `AGENTS.md`.
3. GitHub Releases per product family and matching mirror releases wait for Track N.

## Track H: Close out the issue backlog (independent, starts now)

1. Work through the 56 fregat and 22 mesh issues in batches of about ten. Read each issue and its
   comments, check current main, then fix it (close through the PR), close it as fixed or obsolete
   with evidence, or fold it into the owning plan and close it with the plan link. Follow
   `~/.agents/AGENTS.md`, "The existing backlog". Record batches in `plans/issue-closeout-2026-10.md`.
2. At zero, enable the Track C issue forms. [Plan 295](295-cross-repository-issue-collection.md)'s
   collector then serves user reports.

## Acceptance

- Every repository and published package has an MIT license.
- After Track N: npm serves the current version of every published package, from CI with provenance.
- Each repository front page, npm page and site passes the research checklists, with screenshots sent
  to the owner.
- Every performance claim links a reproducible, like-for-like benchmark.
- Docs builds fail on a broken code sample or internal link.
- Sites serve from our domains on Cloudflare; GitHub Pages is off.
- `docs/releasing.md` exists and changesets read for package users.
- Zero agent-filed issues remain open.

## Kickoff prompt for an executing coordinator

> Execute Plan 336 (`plans/336-packages-as-products.md`) in fregat. Load the `orchestrate` and
> `fregat-local` skills, and read `docs/research/packages-as-products/README.md` and the report each
> lane needs. Start Track 0, Track P and Track H now in parallel. When Track P's first results land,
> run Track B and send the owner the pitch as a private Mesh app link. After the owner approves it,
> run Tracks C, D, F and G in parallel lanes. Do not change package versions. Tracks N and E come last:
> ask the owner for npm setup, domains and the Cloudflare token only when everything else is done.
> Send screenshots of every site and README at each milestone.
