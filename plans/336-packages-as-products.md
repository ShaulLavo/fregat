# Plan 336: Our packages look and read like products

## Status and authorization

- Status: APPROVED. Owner request 2026-10-08. Revised the same day after the research round in
  [docs/research/packages-as-products/](../docs/research/packages-as-products/README.md).
- Scope: Fregat, Singapore, ghostty-webgpu and hotkeys, plus tree-sitter-x and tree-sitter-md as the
  parsers behind Singapore. Their GitHub repositories, npm pages, websites, documentation, release
  cycle and issue tracker. Mesh, fast-ulid and the other owned repos stay out until the owner adds them.
- Priority: P1. Effort: XL in total, split into tracks that mostly run in parallel.
- Owner decisions 2026-10-08: MIT for everything (done: `LICENSE` files and `license` fields). npm
  publishing setup comes last. The owner authorized production sites on the Hetzner VPS at
  `shaulavo.dev` on 2026-10-08. Cloudflare keeps DNS; hosting uses the existing Coolify proxy. Versions
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
6. **Production sites use the Hetzner VPS at `shaulavo.dev`**, with `/fregat`, `/singapore` and
   `/ghostty-webgpu`, plus a project index at `/`. A read-only Nginx container sits behind the
   existing Coolify proxy, which handles TLS. CI builds main and atomically publishes through a
   restricted SSH deploy key. GitHub Pages keeps running until redirects cover the old addresses.
   PR previews remain separate work.
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
- Parsing and highlighting use a worker-side source snapshot. Initial connection sends document
  chunks; subsequent revisions send edits. The editor retains the document on the main thread.
  The minimap, spellcheck and TypeScript language service also have worker implementations.
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

## Track E: Production hosting on the VPS

Owner authorized this track now on 2026-10-08. It replaces the Cloudflare Workers proposal.

1. Serve `https://shaulavo.dev/` and the `/fregat`, `/singapore` and `/ghostty-webgpu` paths from
   one static directory on the owner's Hetzner VPS. Coolify's existing Traefik proxy terminates
   TLS; a read-only Nginx container serves files. Leave Mesh and every subdomain untouched.
2. `.github/workflows/product-sites.yml` builds main with the production base paths and uploads
   in a secret-free job, then deploys through the `PRODUCT_SITES_DEPLOY_KEY` secret in the
   main-only `production` environment. The dedicated SSH user can only
   publish a validated archive to `/srv/product-sites`. A symlink swap activates all sites
   together. Keep three complete releases, prune assets with their releases, and skip identical
   content. HTML caches for 60 seconds; hashed assets cache for a year with `immutable`;
   missing files return 404. See [deployment setup](../scripts/product-sites/README.md).
3. Start with `apps/site`, `editor/examples/app` and `ghostty-webgpu/site`. The pipeline selects
   `editor/site` when it lands. The new Astro sites replace current builds through this pipeline.
4. Keep `.github/workflows/site.yml` and GitHub Pages running. Redirect the five old Pages
   addresses before disabling them. Update published links then. PR previews are later work.

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
- Sites serve from `shaulavo.dev` on the VPS. GitHub Pages turns off after redirects ship.
- `docs/releasing.md` exists and changesets read for package users.
- Zero agent-filed issues remain open.

## Singapore highlighted open

Status: Approved. The 2026-10-08 browser comparison makes large-file syntax startup a separate
execution item. Establish the critical path before changing the parser bootstrap.

### What the open clock measures

The comparison waits for first detectable syntax in the mounted rows, then two animation-frame
callbacks. It does not check every visible token, token correctness or whole-document completion.
Singapore's detector requires one nonempty token CSS Highlight collection. Monaco's detector
requires one colored token span. CodeMirror's detector requires one classed span in a rendered line;
this fixture gives those spans language-highlighting classes.

The outcomes share that readiness clock, but their prerequisite work differs:

- Monaco uses its TypeScript Monarch lexical tokenizer. Its visible-line path calls
  `tokenizeHeuristically`; background tokenization continues separately.
- CodeMirror's Lezer language state initially targets the first 3,000 code units with a 20 ms work budget.
  Its parse worker prioritizes the viewport and advances in bounded scheduled work. Decorations use
  visible ranges.
- Singapore's structural session requests `parseOnly` in range mode. The worker still completes a
  full root Tree-sitter parse and injection discovery before acknowledging that request. Only then
  can the session request and paint visible-range tokens.

The comparison therefore measures a shared user outcome with each editor's normal algorithm.
It cannot support a claim about equal full-document parsing throughput. Keep the normal-algorithm
comparison. Add an explicitly named viewport-first Singapore mode only when its coverage and
correctness controls pass.

### Diagnostic method

The original committed traces capture scrolling after open. They contain no open-clock markers
or CPU-profile samples, so they cannot explain the original 1,517.7 ms median.

Use `editor/bench/compare/run.mjs --profile-open --open-only` for the missing measurement. It runs
the original constructor, fixture, geometry checks and 30-second highlighting deadline, and retains
failed-open traces. Its opt-in worker probe records existing parser phase timings and request
metadata. Initial source chunk sizes and synchronous `postMessage` times are measured without
recording document contents. The normal ranking reducer rejects these instrumented runs.

Report constructor wall time, initial source round trip, root parse, injection discovery, visible
query, token payload, main-thread projection and rendering. Round trips contain queueing,
serialization, execution and delivery. Worker phases sit inside them; do not add those durations
as separate costs. Mount includes buffer creation and editor setup, so CPU attribution is needed
to distinguish them. Frame markers measure callback opportunities, not physical presentation.

### Measurement and execution decision

The noisy diagnostic experiment ran on 2026-10-08, on Linux 7.2.8-arch1-2 with an Intel Core
i7-14700K, 28 logical CPUs, 33,368,662,016 bytes of RAM and headless Chromium 153.0.8010.12.
Singapore's packages were 0.2.6, Monaco 0.57.0, CodeMirror 6.0.2, its state 6.7.6, view 6.43.14
and TypeScript mode 6.2.5. Playwright was 1.63.0 and Vite 8.3.1. The product base was
`308f5e514573c6cee874ad63201bbb17151b5c36`, the open comparison branch. The opt-in instrumentation
was an uncommitted addition; its source hash is retained in the experiment.

The matrix retained all 27 attempts at 1, 10 and 200 MiB. Twenty-four completed. All three Singapore
200 MiB attempts reached the 30-second visible-highlighting deadline; Monaco and CodeMirror
completed all their attempts. The original uninstrumented comparison remains the ranking evidence.
These diagnostic numbers establish where work happens and do not establish a speedup.

| Singapore at 10 MiB, median of three attempts           |      ms |
| ------------------------------------------------------- | ------: |
| Constructor and mount                                   |    28.7 |
| First frame opportunity                                 |    32.5 |
| Initial source reset round trip                         |     6.7 |
| Synchronous reset `postMessage`, inside that round trip |     1.7 |
| Parse acknowledgement round trip                        | 1,275.5 |
| Worker parse operation, inside that round trip          | 1,268.3 |
| Root parse, inside the worker operation                 |   783.9 |
| Injection discovery, inside the worker operation        |   477.2 |
| Visible query round trip                                |   125.6 |
| Structural range walk, inside the query                 |   100.0 |
| Highlight query and predicates, inside the query        |     4.5 |
| Token packing, inside the query                         |     0.4 |
| Main-thread structural syntax application               |     4.0 |
| Recorded style, layout and paint spans                  |    10.2 |
| First detected syntax                                   | 1,542.7 |
| Settled highlighted frame opportunity                   | 1,576.0 |

These are medians of nested or overlapping observations, not additive slices. Main-thread
constructor wall time includes buffer adoption and editor setup. The existing `editor.input`
diagnostic takes 20.7 ms in the representative attempt; it does not isolate buffer construction.
The trace's named main-thread script/render spans total 12.5 ms but omit the DevTools-evaluated
constructor. Keep that subtotal separate from constructor wall time. CPU samples exist, but
minified functions without source maps do not support a finer buffer attribution.

The representative 10 MiB attempt gives the ordering directly. Mount finishes at 28.7 ms. Worker
initialization starts at 38.2 ms and takes 18.7 ms. The source reset starts at 58.0 ms and finishes
at 64.2 ms. Parsing runs from 64.7 to 1,338.4 ms. The source-unpin request then takes 69.5 ms;
this is a worker queue/execution gap, not measured token transfer. The visible query runs from
1,408.9 to 1,534.5 ms. Syntax is detected at 1,538.3 ms, and two more frame callbacks finish at
1,570.5 ms. The query covers code units 0 through 23,359 and returns 2,672 tokens in 32,064 bytes.
Its round trip exceeds its reported worker query by only 0.3 ms. That difference bounds neither
network latency nor transfer cost in isolation, but gives no evidence of a large token-transfer
bottleneck. Mounted token segment/range work takes 0.8/1.8 ms inside the 3.4 ms structural apply.

The initial reset transmits all 10,485,760 code units. It sends chunks, and the worker parser reads
bounded 4,096-code-unit callbacks from its source snapshot. Removing a supposed full-string parse
copy would target a copy this parser does not make. Initial source transport costs are measured
and are small beside parsing in this fixture.

At 200 MiB, constructor wall time is 79.2, 84.6 and 89.6 ms. Reset round trips are 149.5, 149.5 and
159.7 ms, with synchronous sends taking 57.8, 61.1 and 62.6 ms. Parse requests return successfully
at the transport level after 20,126.4, 20,156.8 and 20,132.4 ms, with no parse result or phase
timings. No visible query follows. This matches the worker's 20-second cancellation budget and
its cancellation-to-undefined path. The trace cannot divide cancelled parsing between root and
injection phases because that path drops phase timings. The browser then exhausts its independent
30-second syntax deadline. Raising either deadline would leave the startup dependency intact.

The measured full parse plus injection discovery occupies about 80% of the 10 MiB open clock.
There is also a bounded range-walk defect: after reaching the requested end, traversal skips each
remaining subtree but continues visiting every following root sibling. A visible query therefore
pays for document length. Stop the walk at its ordered end and prove that trailing siblings are
unvisited while in-range diagnostics remain identical. This narrow correction does not solve
full-document bootstrap or the 200 MiB cancellation.

Evidence is retained in
[the raw matrix](../editor/docs/performance/singapore-open-2026-10-08/baseline/experiment.json.gz),
[the 10 MiB open trace](../editor/docs/performance/singapore-open-2026-10-08/baseline/singapore-10-0-open.trace.json.gz)
and [the failed 200 MiB open trace](../editor/docs/performance/singapore-open-2026-10-08/baseline/singapore-200-0-open.trace.json.gz).
The three settled 10 MiB editor screenshots were read back. All display highlighted initial rows.

### Bounded correction and repeated experiment

The ordered-end correction is implemented. The regression control failed before the change,
with one trailing sibling read where zero was expected. After the change, all 18 worker tests
pass in both Bun and Node, including middle-range nested diagnostics and bracket depth.

The second noisy diagnostic matrix uses the same 1, 10 and 200 MiB fixtures, three repetitions,
browser, machine, dependency lock, package versions and clock. Both matrices retain 27 attempts
and 24 completed opens. The comparator verifies those identities and unchanged competitor bundle
manifests before reporting differences. Singapore's emitted worker hash changed from
`9103714cff5238bf29efc4894409cd210aae7a5b1fafcaf867f8a86ed45e8136` to
`692028b39cd9a0d2083b9ed8d189667412f0bc6fa6d10fb6f14ecca44b8a5aad`.
Both captures use the product base above, with uncommitted instrumentation and, in the second,
the ordered-end guard. Analysis-only reducer changes also change the recorded harness source hash;
the page clock, fixture and probe remain unchanged between captures. These runs predate the merged
harness's full served-build manifest. Their minimal-bundle manifests include the worker identities.

| Singapore at 10 MiB, median of three attempts | Before, ms | After, ms |
| --------------------------------------------- | ---------: | --------: |
| Settled highlighted frame opportunity         |    1,576.0 |   1,464.0 |
| First frame opportunity                       |       32.5 |      32.8 |
| Root parse                                    |      783.9 |     767.0 |
| Injection discovery                           |      477.2 |     476.4 |
| Visible query round trip                      |      125.6 |      30.1 |
| Structural range walk                         |      100.0 |       4.6 |
| Main-thread structural syntax application     |        4.0 |       3.3 |

The structural walk falls by 95.4 ms in this experiment. Its three after observations are 4.4,
4.6 and 4.6 ms. The visible query still covers code units 0 through 23,359 and returns 2,672 tokens
in 32,064 bytes in every 10 MiB attempt. Singapore's mounted row pool remains 48 before and after.
The three after screenshots were read back and show highlighted initial rows. These controls
support removing trailing traversal work; the noisy clocks do not establish a headline speedup.
The 1 MiB highlighted medians are 309.8 and 308.8 ms.

The larger dependency remains. All three after Singapore 200 MiB attempts still miss the existing
30-second deadline. Their parse round trips are 20,157.7, 20,094.1 and 20,097.3 ms and return no
parse result; no visible query follows. All competitor attempts complete. Keep the viewport-first
bootstrap below as Approved work, with cancellation accounting and correctness controls.

[The after matrix](../editor/docs/performance/singapore-open-2026-10-08/after/experiment.json.gz),
[the diagnostic comparison](../editor/docs/performance/singapore-open-2026-10-08/after/comparison.json)
and [the after 10 MiB trace](../editor/docs/performance/singapore-open-2026-10-08/after/singapore-10-0-open.trace.json.gz)
retain the proof. Reproduce the phase comparison with:

```sh
node editor/bench/compare/summarize-open.mjs \
  editor/docs/performance/singapore-open-2026-10-08/after/experiment.json.gz \
  --compare editor/docs/performance/singapore-open-2026-10-08/baseline/experiment.json.gz
```

### Approved viewport-first follow-up

1. Give the initial visible query a bounded Tree-sitter bootstrap, with explicit source version and
   covered-range metadata. Keep partial and full trees distinct. A partial tree must not claim
   complete folds, diagnostics or structural navigation. Use existing viewport/overscan demand to
   choose coverage; register any new execution setting in the settings registry.
2. Publish visible tokens from that bootstrap before scheduling full-document parsing and injection
   discovery. Continue the complete analysis through cancellable worker tasks, yielding between
   bounded work units. Visible queries and edits take priority. Do not queue an idle full reparse
   ahead of the first visible result. Measure the existing post-acknowledgement unpin gap before
   changing that idle policy.
3. Preserve grammar context and prove preview correctness. Compare initial tokens with the completed
   parse for this TypeScript fixture, multiline strings/comments, syntax crossing the preview end,
   TSX ambiguities and injected languages. Scroll or jump beyond covered ranges must request valid
   context rather than reuse a partial root as a complete document. Edits and disposal cancel stale
   bootstrap/background results by source identity and version.
4. Retain timings and a structured cancellation outcome when analysis exhausts a work budget.
   Silent missing results must not leave the visible-highlight request permanently unsettled.
5. Re-run the original uninstrumented matrix and the diagnostic open matrix on the same machine,
   versions, fixture and geometry. Require initial visible highlighting before the existing
   30-second deadline at 200 MiB, bounded initial parsing work as file size grows, and token coverage
   and correctness controls in addition to the first-token detector. Publish any headline only after
   the full comparison protocol passes. Keep noisy trials labelled as experiments.

## Kickoff prompt for an executing coordinator

> Execute Plan 336 (`plans/336-packages-as-products.md`) in fregat. Load the `orchestrate` and
> `fregat-local` skills, and read `docs/research/packages-as-products/README.md` and the report each
> lane needs. Start Track 0, Track P and Track H now in parallel. When Track P's first results land,
> run Track B and send the owner the pitch as a private Mesh app link. After the owner approves it,
> run Tracks C, D, F and G in parallel lanes. Do not change package versions. Track E is authorized
> now on the VPS. Track N comes last:
> ask the owner for npm setup only when everything else is done.
> Send screenshots of every site and README at each milestone.
