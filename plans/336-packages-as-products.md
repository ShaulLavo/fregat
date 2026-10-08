# Plan 336: Our packages look and read like products

## Status and authorization

- Status: APPROVED. Owner request 2026-10-08.
- Scope: Fregat, Singapore, ghostty-webgpu and hotkeys. Their GitHub repositories, npm pages,
  websites, documentation, release cycle and issue tracker. Mesh and tree-sitter-x are out of
  scope until the owner adds them.
- Priority: P1. Effort: XL in total, split into tracks that run in parallel after Track A.
- Owner inputs still needed: the domain names and Cloudflare account access for Track E. Every
  other track runs without the owner. Sites build and deploy to a preview URL until the domains
  exist.
- Planned against Fregat `1e066d38b`.

## Outcome

Someone who lands on any of our repositories, npm pages or sites sees a serious project within ten
seconds: what it is, why it is better than the thing they use now, proof, and a one-minute way to try
it. Each project has its own clear pitch. Singapore and ghostty-webgpu have documentation as good as
the best in their category. Sites live on our own domains, built with Astro, off GitHub Pages.
Releases have a cycle with readable changelogs and release notes. The issue tracker is empty of
agent-filed work, ready for outside users.

## What exists today

- READMEs: root `README.md` (35 lines), `editor/README.md` (54), `ghostty-webgpu/README.md` (58),
  `hotkeys/README.md` (80), plus 21 short `editor/packages/*/README.md`. All are written in lowercase,
  undersell the work, and have no badges, social image, or comparison that carries proof.
- Sites: `apps/site` (Astro, one page, hero is an iframe of the whole web app at 31 MB) and
  `ghostty-webgpu/site` (Astro, good). Singapore has only the example app. `.github/workflows/site.yml`
  assembles all three under GitHub Pages at `shaullavo.github.io/fregat/…`.
- Docs: Markdown files in `ghostty-webgpu/docs/` and `editor/docs/`, unpublished except through GitHub.
- Releases: Changesets with fixed groups (`.changeset/config.json`), a version PR and npm publish in
  `.github/workflows/release.yml`. Patch bumps only until launch. Changelog entries are internal
  engineering language ("Own source delivery and contribution lifetimes in document analysis…").
- Issues: 56 open in fregat, 22 in mesh, 0 in the mirrors. Agents no longer open issues
  (`~/.agents/AGENTS.md`, "No new issues", 2026-10-08).
- [Plan 155](155-site-demo-replica.md) already approves replacing the Fregat site's live-app iframe
  with an animated replica of the workbench. Track D executes it.

## Decisions

1. **Sentence case, real prose.** READMEs, sites and docs use normal capitalization and full
   sentences. The lowercase house style goes. Copy still follows the AGENTS.md copy rules and the
   `unslop` skill: say what a thing is and does, no hype words without a number behind them.
2. **Every superlative carries proof.** "Fastest" and "faster than X" appear only beside a linked,
   reproducible benchmark with date, machine and method. Compare like for like (WebGL against
   xterm.js WebGL). Where proof does not exist yet, Track B produces it or the claim waits.
3. **Planned work is labeled as planned.** "Coming soon" items name the feature plainly
   (for example "Collaborative editing, planned") and link the plan. No dates unless the owner gives one.
4. **Astro for every site.** Docs sections use Astro Starlight unless Track A finds a concrete reason
   against it; landing pages are custom Astro. One shared docs look across Singapore and ghostty-webgpu,
   each with its own accent.
5. **API reference is generated from the TypeScript source**, never hand-maintained, so it cannot
   drift. Hand-written guides sit on top of it.
6. **Code samples in docs and READMEs are type-checked in CI.** A broken sample fails the build.
7. **Hosting is Cloudflare Pages** on our own domains, one project per site, deployed from CI.
   GitHub Pages is switched off once the new URLs serve.
8. **Mirrors stay mirrors.** READMEs and docs are edited in fregat. Links inside mirrored folders
   are absolute URLs so they work on both GitHub repositories and npm.

## The pitch, per project

Track B turns these owner points into final copy with evidence. They are the starting brief.

**Fregat, the crown jewel.** Hard to sell because at a glance it looks like another Cursor. What
sets it apart:

- Speed you can feel: as fast as the browser can go. Typing lands within one 120 Hz frame; terminals
  and editors render faster than the tools they replace. Cite measurements.
- Local first. Everything runs on your machine; one server, many clients (browser, desktop, native
  Mac, terminal UI, phone).
- Bring your own tools: Claude Code and Codex run on the subscriptions you already pay for, side by
  side, each with its own permissions.
- Share it: open the same workspace from any device.
- Seamless: editor, terminals, git, language servers and agents in one workspace with no seams.
- Every layer is ours: Singapore, ghostty-webgpu and hotkeys are its parts, and the reason it is fast.

**Singapore.** Today's README says "same shelf as Monaco and CodeMirror". It should say why to
pick it: a modern Monaco, built the way Zed is built, for the browser.

- Modern platform APIs throughout: the CSS Custom Highlight API for syntax paint, workers for
  parsing, highlighting and language servers, so the main thread stays free.
- Zed's ideas in the browser: persistent copy-on-write piece table, snapshots, stable anchors.
- Large files and fast edits, with benchmarks against Monaco and CodeMirror.
- Modular: core plus optional packages (tree-sitter, LSP, diff, minimap, markdown, React and Solid).
- Planned: collaborative editing built on the event-graph approach of eg-walker and diamond-types
  ([delta-db plan](delta-db-implementation-plan.md)), the modern alternative to classic CRDTs.

**ghostty-webgpu.** The easiest sell.

- Ghostty's own terminal core (libghostty-vt) compiled to wasm, so it is as correct as Ghostty.
- Faster than xterm.js and ghostty-web in every rendering scenario measured, often several times
  faster (`ghostty-webgpu/docs/benchmarks.md`), and still getting faster.
- WebGPU, WebGL2, Canvas 2D and DOM renderers that redraw only changed cells.
- Planned: the addon ecosystem xterm.js users expect (fit, search, links, serialize, images and
  the rest), once performance work settles.

**hotkeys.** Zed-style keyboard shortcuts for any app: context-aware bindings, chords, display
formatting and recording, DOM-free core with browser and terminal adapters.

## Track A: Research (runs first, about one day of agent time)

Study the best in each category deeply and write down what to copy, with links and screenshots.
Output: `docs/research/packages-as-products/` with one file per topic and a `README.md` summary of
the patterns we adopt. Each file ends with a concrete checklist the other tracks follow.

1. **READMEs and repository front pages.** Category leaders and generally admired repos. At least:
   Bun, Vite, Biome, Oxc, Zed, Ghostty, Tauri, Astro, tldraw, Excalidraw, Yjs, Loro, TanStack Query,
   xterm.js, CodeMirror, Monaco, Lexical, Tiptap, opencode, t3code. Record: first screen layout, hero
   image or video, badges, the one-line pitch, how they show proof (benchmarks, logos, numbers), install
   and quick start, "why" section, comparison tables, links, community and contributing files, About
   description, topics, social preview image.
2. **Product and landing sites.** Cursor, Zed, Warp, Ghostty, Linear, Bun, Vite, Biome, Raycast.
   How they sell speed and local-first work; how hero demos are built (video, animated replica, live).
3. **Documentation.** CodeMirror (the model for Singapore's site: minimal, docs-first, live editor on
   the home page), xterm.js, Stripe, Tailwind, Vite, Bun, React (react.dev), Svelte, Astro, TanStack,
   Ghostty's docs, and the Diátaxis framework. Record structure (tutorial, how-to, reference,
   explanation), navigation, search, examples, API reference generation, versioning, "edit this page".
4. **Release cycles.** Vite, Astro and TanStack (Changesets with pre-release mode), React (channels),
   Biome, Bun (release blog posts), Ghostty (release notes pages). Record: channels (stable, next,
   canary), cadence, changelog style, GitHub Releases, deprecation policy, migration guides.

## Track B: Pitch and proof (after A)

1. Write `docs/research/packages-as-products/pitch.md`: for each project, the one-liner, the
   three-to-five differentiators, the proof for each, and the planned items. Owner reviews this one
   document before Tracks C and D publish copy; publish it to the owner as a private Mesh app.
2. Fill proof gaps. Fregat: typing latency and pane-switch numbers from existing traces
   (`bun run agent:browser trace`). Singapore: a reproducible comparison against Monaco and CodeMirror
   (large-file open, typing latency, memory) built on the existing editor benchmarks. ghostty-webgpu:
   the existing benchmark suite, presented per renderer, like for like.
3. Produce visuals: README hero screenshots or short looping videos (WebM plus GIF fallback for
   GitHub), social preview images (1280×640) for each repository, and a logo or wordmark per project
   consistent with the Fregat icon.

## Track C: Repositories and npm pages (after B's pitch is reviewed)

1. Rewrite `README.md`, `editor/README.md`, `ghostty-webgpu/README.md`, `hotkeys/README.md` and every
   published package README from the Track A checklist and Track B pitch.
2. Badges: npm version, CI, license, and bundle size where it flatters the truth.
3. `package.json` for every published package: `description`, `keywords`, `homepage` (the docs URL),
   `repository.directory`, `bugs`, `funding` if the owner wants it.
4. Repository settings through `gh api`: About description, topics, homepage URL, Discussions on
   fregat. Social preview images need the GitHub web UI; do it through browser automation or hand the
   image files to the owner.
5. Community files in fregat: `CONTRIBUTING.md`, `SECURITY.md`, issue forms for outside users (bug
   report, feature request) and a pull request template. Mirrors point contributors to fregat.

## Track D: Sites (after B's pitch is reviewed; D1–D3 run in parallel)

1. **Fregat site facelift** (`apps/site`). Execute [Plan 155](155-site-demo-replica.md): drop the
   31 MB live-app iframe for an animated replica of the workbench. New sections follow the pitch.
   Links to the Singapore and ghostty-webgpu sites and docs.
2. **Singapore site** (new, `editor/site`). CodeMirror style: a plain home page with a live
   "edit this" Singapore editor, a short pitch, install, and then docs. Most of the site is docs.
3. **ghostty-webgpu site.** Keep the existing site; add a docs section. Move the user-facing parts of
   `ghostty-webgpu/docs/` into it (integration, API, fonts, hotkeys, config, benchmarks). Keep
   engineering notes (autoresearch, phase acceptance, perf attribution) in the repository.
4. A hotkeys docs page lives under the Fregat site until it outgrows it.
5. Every site: fast (Lighthouse performance 95+ on mobile), works without JavaScript for reading,
   respects reduced motion, has Open Graph images, a sitemap and a 404 page.
6. Verify each site with screenshots at desktop and phone widths and send them to the owner.

## Track E: Hosting (needs the domains; build work can start before)

1. Owner chooses the domains and grants a Cloudflare API token (stored as a GitHub Actions secret).
2. One Cloudflare Pages project per site. CI deploys main to production and PRs to preview URLs.
   Replace `.github/workflows/site.yml`'s Pages deploy.
3. Old GitHub Pages URLs serve a redirect page to the new URLs for a few months, then Pages is
   disabled. Update every link in READMEs, `package.json` and docs.

## Track F: Documentation (after A; runs alongside D)

1. Structure each docs site by Diátaxis: Getting started (tutorial), Guides (how-to), API reference
   (generated), Concepts (architecture and design). Adapt from Track A's findings.
2. Generate API reference from the TypeScript exports (TypeDoc into Starlight, or the tool Track A
   picks).
3. Singapore: getting started; guides for themes, languages and tree-sitter, LSP, React and Solid,
   large files, decorations, plugins; concepts from `editor/ARCHITECTURE.md` and `editor/docs/`.
4. ghostty-webgpu: getting started; guides for a PTY over WebSocket, renderers and fallbacks,
   fonts, themes, workers, hotkeys, migrating from xterm.js (with an API mapping table); concepts for
   damage tracking and the wasm core; the benchmarks page.
5. CI: type-check every code sample, check every link, build docs on every PR that touches them.

## Track G: Release cycle (after A; machinery now, minors at launch)

1. Write `docs/releasing.md`: channels, cadence, versioning policy (patch only until launch, strict
   semver after), deprecation policy, what goes in a changeset.
2. Changesets with `@changesets/changelog-github` so entries link PRs. Changeset summaries are written
   for users of the package, in plain words; internal detail goes in the PR. Add the rule to
   `AGENTS.md`.
3. A `next` pre-release channel (snapshot releases from main) beside `latest`.
4. GitHub Releases per package family with readable notes, and a changelog page on each docs site.
5. At launch (owner decides when): first minor, migration guide if needed, release announcement.

## Track H: Close out the issue backlog (independent, starts now)

1. Work through the 56 fregat and 22 mesh issues. Read each issue and its comments, check current
   main, then: fix it (close through the PR), close it as already fixed or obsolete with the evidence,
   or fold it into the owning plan and close it with the plan link. Follow the claim rules in
   `~/.agents/AGENTS.md`, "The existing backlog".
2. Work in batches of about ten; record each batch's outcome in
   `plans/issue-closeout-2026-10.md` with the issue links.
3. When the count reaches zero, enable the Track C issue forms so outside users file into a clean
   tracker. [Plan 295](295-cross-repository-issue-collection.md)'s collector then serves user reports.

## Acceptance

- Each repository front page, npm page and site passes a review against the Track A checklists,
  with screenshots sent to the owner.
- Every performance claim links a reproducible benchmark.
- Docs builds fail on a broken code sample or link.
- Sites serve from our domains on Cloudflare; GitHub Pages is off.
- `docs/releasing.md` exists and a `next` release has been published.
- Zero agent-filed issues remain open.

## Kickoff prompt for an executing coordinator

> Execute Plan 336 (`plans/336-packages-as-products.md`) in fregat. Load the `orchestrate` and
> `fregat-local` skills. Start Track A (research) and Track H (issue close-out) now in parallel.
> When Track A lands, run Track B and send the owner the pitch document as a private Mesh app link.
> After the owner approves the pitch, run Tracks C, D, F and G in parallel lanes. Track E waits for
> the owner's domains and Cloudflare token; ask for them once, when the first site is ready to
> deploy. Send screenshots of every site and README at each milestone.
