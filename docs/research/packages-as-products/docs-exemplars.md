# How the best documentation is built

Track A research for [Plan 336](../../../plans/336-packages-as-products.md), topic 3. Written
2026-10-08 from pages read that day. Where a fact comes from prior knowledge and was not re-read
today, it is marked _(not re-verified)_. Several sites (react.dev, Stripe, TanStack) now serve
Markdown or MDX source to non-browser clients, so some rendered UI details came from the source
files and the sites' own repositories instead of the rendered page.

The target: Singapore and ghostty-webgpu docs that are as good as the best in their category.
Their category peers are CodeMirror, Monaco, Lexical and tldraw (editors and canvases) and xterm.js
and Ghostty (terminals). Stripe, Tailwind, Vite, Bun, React, Svelte, Astro and TanStack set the bar
for docs in general.

## 1. Principles of great docs, ranked

Ranked by how much each one changes a newcomer's first hour, and by how badly our category peers
miss it.

1. **A working result in under a minute, and a live one before installing anything.**
   CodeMirror's home page _is_ a live editor. Svelte's tutorial and react.dev put an editable
   sandbox beside the first paragraph. Tailwind's Vite install is six short steps on one screen;
   Bun's quickstart prints output at step 2 of 5; tldraw offers "Have five minutes?" with one
   command. Our packages run in the browser, so we can do better than all of them: the docs home
   page runs Singapore or ghostty-webgpu, and the quick start ends with the same thing running in
   the reader's own page.

2. **Every code sample compiles, and long ones run.** The peers that skip this show it.
   xterm.js's "Using addons" guide defines `DataLoggerAddon` and then loads `new ExampleAddon()`,
   and calls `loadAddon` "a static method" while the code calls it on an instance. tldraw's
   generated reference shows a `getCurrentPageShapeIds` example that calls `getCurrentPageIds`.
   Both errors would fail a type check. Plan 336 decision 6 already requires this; the tooling
   section below shows how.

3. **Keep the four kinds of page apart, and let the structure grow from content.** Diátaxis:
   tutorials (learning by doing), how-to guides (a task for someone who already knows the basics),
   reference (look-up facts), explanation (understanding). The compass is two questions: action or
   cognition, acquisition or application. Its workflow page is blunt about empty skeletons
   ("Don't do that. It's horrible."): structure follows content, one improvement at a time, each
   published immediately. React (Learn vs Reference), Astro (Tutorial, Guide, Reference,
   Ecosystem) and Vite (Introduction, Guide, APIs) all follow this split.

4. **Generated reference is necessary and is not documentation.** Monaco's docs are a TypeDoc
   index of about 170 modules with no introduction, no guide and no concepts; the whole community
   learns Monaco from the playground, GitHub issues and Stack Overflow. CodeMirror generates its
   reference too, but pairs it with a long hand-written System Guide and 25 example pages.
   Generated reference stays complete and can't drift; guides and concepts sit on top of it.

5. **Show the result next to the code.** Tailwind renders each example above its HTML. React's
   Sandpack blocks run multi-file examples inline. tldraw's examples site runs each example
   beside its `App.tsx`. CodeMirror's example pages embed live editors and a "sandbox" link to
   its Try page. For a visual component the rendered result is the explanation.

6. **One explanation of the model, written frankly.** CodeMirror's System Guide (Architecture
   Overview, Data Model, The View, Extending) is the reason people can build serious things with
   it. It admits trade-offs ("the less bright side" of modularity), names its inspirations (Redux,
   Elm) and labels an anti-pattern "BAD WRONG NO GOOD CODE". Singapore has unusual internals
   (persistent piece table, CSS Custom Highlight API, worker topology); ghostty-webgpu has damage
   tracking and a wasm core. A reader who understands the model debugs their own problems.

7. **Fixed page templates per page type.** react.dev reference pages always go: one-line intro
   with bare signature, Reference (Parameters, Returns, Caveats), Usage (task-named scenarios with
   live examples), Troubleshooting (headings phrased as the user's symptom, "I've updated the
   state, but the screen doesn't update"). Tailwind utility pages always go: quick reference table,
   examples with previews, responsive variant, customizing. Ghostty's VT pages always go: summary,
   byte-by-byte syntax, behavior, numbered validation cases with a `printf` script and the expected
   grid. Readers learn the template once and then scan.

8. **Proof pages for claims.** None of the general exemplars need this; we do (Plan 336
   decision 2). Ghostty's VT validation cases and our existing `ghostty-webgpu/docs/benchmarks.md`
   (environment, method, artifact, regenerate command) are the model: a claim links to a page
   that says how to reproduce it.

9. **Fast navigation.** ⌘K search, a left sidebar grouped by task, "On this page" table of
   contents, previous and next links, stable heading anchors. Every exemplar except CodeMirror
   (one huge reference page, browser find instead of search) and Monaco (TypeDoc's search index
   failed to load when read) does this.

10. **Pages that read well in Markdown, for people and agents.** The 2026 norm: react.dev and Zed
    publish `llms.txt`; Stripe serves every page as `.md` and ships `stripe docs` to read docs in a
    terminal; Bun has "Copy page" and "View as Markdown"; tldraw and Lexical have "Copy markdown"
    or "Copy page". TanStack writes docs as GitHub-flavoured Markdown with tab blocks in HTML
    comments, so the same file reads well on GitHub. Our mirrors put docs on GitHub and npm too.

11. **Maintenance signals.** "Edit this page" (Vite, Bun, Svelte, Starlight, tldraw, Lexical,
    Ghostty), "Last updated" (Starlight, tldraw), a version picker with archived majors (Vite,
    Tailwind), a changelog and migration guides (CodeMirror, Vite, Astro's "Upgrade" section with
    guides back to v1). These tell a reader the docs are alive and match the version they run.

12. **Plain, specific prose.** The best pages are short and concrete: Tailwind's install step is
    one sentence and one code block; Zed's getting started is five numbered steps; react.dev
    talks to "you" and builds one concept at a time. Diátaxis's tutorial advice ("ruthlessly
    minimise explanation", "deliver visible results early and often", "aspire to perfect
    reliability", end by describing what the learner built) is the best short guide to tone. Our
    house rules (sentence case, the AGENTS.md copy rules, `unslop`) apply on top.

## 2. Per-site notes

### CodeMirror (codemirror.net), the model for Singapore

- **Home:** "Extensible Code Editor", two sentences of pitch, then a live JavaScript editor, then
  a feature grid where each feature links to its docs or example, then language packages,
  sponsors. No hero art. The editor is the hero.
- **Docs index:** a flat list of seven cards: System Guide, Reference Manual, List of Core
  Extensions, Examples, Migration Guide (from 5.x), Community Packages, Changelog. Plus the forum.
- **System Guide:** one long page, four parts, 19 sections, linked table of contents at the top.
  Prose with many short code samples; console output shown in comments; no diagrams except an
  HTML outline of the DOM structure. First person, frank about trade-offs.
- **Examples:** 25 pages in four groups (Basics, Language, Programming Interface, Integration),
  named by task: Huge Document, Decoration, Split View, Collaborative Editing, Autocompletion.
  Each is a walkthrough of about 1,000 words with prose and code roughly balanced, live editors
  embedded in the page and a "sandbox" link that opens the full code in the Try page.
- **Try page:** Code, Output and Log tabs; output in an iframe; `@codemirror/*` imports resolve by
  name, others must be URLs; example picker; Share button. Used for bug reports too.
- **Reference:** one very long generated page (getdocs-ts plus builddocs, confirmed in the
  `codemirror/website` package.json). Package sections in a hand-chosen order, themed
  subsections, kind labels (class, interface, type), every type name linked, dotted anchors
  (`#state.EditorState^create`), built-in types link to MDN, `fn(…) → Result` notation, defaults
  inline. No per-member source links. Excellent density; weak for search and mobile.
- **Search, versioning, edit link:** no search; v5 docs kept at a separate link; no edit link.
- **Copy:** hand-written by the author, direct, occasionally playful.
- **Take:** live editor as hero, task-named examples with live editors, one deep model guide, a
  Try page. Skip the single-page reference; Starlight per-module pages with search work better.

### xterm.js (xtermjs.org), the terminal incumbent and partly a counter-example

- **IA:** Guides (8 pages: Downloading, Encoding, Flowcontrol, Parser Hooks, Importing, Link
  Handling, Security, Using addons), API Reference (Terminal class, 34 interfaces, Supported
  Terminal Sequences), Addons (empty heading when read). No getting started page.
- **Reference:** Jekyll site, API pages built with TypeDoc 0.17 and typedoc-plugin-markdown 2
  (confirmed in `xtermjs/xtermjs.org` package.json). Hierarchy, Index, "Defined in" links pinned
  to the release tag. Union types render with stray asterisks, a markdown-conversion artifact.
  Few `@example` tags.
- **Guides:** very short. The addons guide has the bugs listed in principle 2 and does not list
  which addons exist; readers browse the GitHub `addons/` folder.
- **Supported terminal sequences page:** a real asset; terminal users need it.
- **Take:** an xterm.js user switching to us needs an addons map, flow control, link handling,
  security and a sequence table. Their gaps are where our migration guide and guides win.

### Ghostty (ghostty.org/docs)

- **IA:** About, Install, Configuration, Linux, Features, Terminal API (VT), Help, Financial
  Support. Docs home: one line, install links, four featured cards (Keybindings, Color Theme,
  Configuration, Terminal API).
- **Config reference:** one very long page of about 150+ options, "ordered roughly by how common
  they are", generated from Ghostty's source (the website repo has a
  `warn-autogenerated-files` workflow guarding `docs/config/reference.mdx`). Related options share
  one description; defaults inline; platform notes and "Available since: 1.2.0" lines; Warning
  and Note callouts. The author's first-person voice survives from source comments.
- **VT docs:** a section per sequence family (`csi/`, `esc/`, `osc/`, `concepts/`). Each sequence
  page: summary, byte-by-byte syntax, parameter rules, behavior, then numbered validation cases
  ("CUP V-2: Off the Screen") with a `printf` script and an ASCII grid of the expected screen.
  The validation cases double as examples and as a conformance spec.
- **Stack:** Next.js with MDX in `ghostty-org/website`, Mermaid available, "Edit on GitHub".
- **Take:** ghostty-webgpu runs libghostty-vt, so it inherits this conformance. Our reference can
  link Ghostty's VT pages per sequence and run their validation scripts in a live terminal on a
  conformance page.

### Monaco (microsoft.github.io/monaco-editor), the counter-example

- The API site is a default-theme TypeDoc index: about 70 `features/*/register` modules, about 85
  `languages/definitions/*` modules, `nls` locales, no introduction, guide or concepts. The
  search index failed to load when read ("The search index is not available").
- The playground is the real documentation. Everything a newcomer needs (bundling workers, models
  versus editors, URIs, language registration, disposal) lives in issues and blog posts.
- **Take:** this is the gap Singapore's pitch ("a modern Monaco") should fill: everything Monaco
  makes people reverse-engineer becomes a guide (workers and bundling, documents and sessions,
  languages, LSP, themes, disposal).

### Lexical (lexical.dev)

- Docusaurus. Top nav: Playground (separate site), Docs, API, Community, Demos gallery.
- Sidebar: Introduction, Getting Started (vanilla and React quick starts), Concepts (Editor State,
  …), Nodes, Browser and Environment, Serialization, Extensions, Packages, React, Collaboration,
  Testing, FAQ, Maintainers' Guide.
- API reference from TypeDoc through docusaurus-plugin-typedoc with four custom TypeDoc plugins
  (external links, module names, legacy router, command groups), confirmed in
  `packages/lexical-website/docusaurus.config.ts`. Per-package module pages.
- "Copy page" buttons, "Edit this page", breadcrumbs, on-page table of contents.
- **Take:** closest structural match for a modular editor: a Packages section with one page per
  package, plus Concepts. Their custom TypeDoc plugins show the generated reference needs some
  tuning for a multi-package library.

### tldraw (tldraw.dev)

- Top nav: Quick start, Documentation, Reference, Starter kits, Examples. Sidebar: Introduction,
  Learn tldraw, SDK features (alphabetical), Community.
- Quick start: two paths ("Have five minutes?" `npm create tldraw@latest`, or a React
  walkthrough). Steps build on each other: render, add `persistenceKey`, add multiplayer with one
  hook against their demo server, control the canvas through `onMount`. Each step adds one
  visible capability. No live canvas on the page.
- Examples: 11 categories (Getting started, Configuration, Editor API, UI & theming, Shapes &
  tools, Collaboration, Use cases, …), each example runnable with its source and a Copy button.
- Reference: generated from API Extractor (each package has `api-extractor.json` and a committed
  `api-report.api.md`, confirmed in the repo). Grouped by kind; signature block, example,
  parameter table, returns; one "See source code" link per class pinned to the release tag;
  "Copy markdown" on every page; "Is this page helpful?".
- **Take:** the quick-start shape (each step adds one visible capability, collaboration within
  minutes) and the examples gallery. API Extractor's committed API report is a useful review
  artifact separate from the docs.

### Stripe (docs.stripe.com)

- Getting started is a hub of cards: create account, set up the environment, API keys,
  quickstarts, no-code, "Build on Stripe with AI", then use cases phrased as the reader's
  business ("Sell subscriptions as a SaaS startup").
- API reference: each endpoint has the request and full response object, then parameters with
  type and required or optional, nested objects collapsed behind `?query=` links, then
  "Returns" with the common error causes. Rendered as three columns with sticky code on the right
  and a language selector that persists across pages _(not re-verified)_. Logged-in readers see
  their own test keys in samples _(not re-verified)_.
- Agent-first in 2026: every page available as `.md`, `stripe docs` reads docs in the terminal,
  agent skills and an "agent setup" command. Stripe authored Markdoc for this site.
- **Take:** parameters that say units, limits and defaults in the description; a full response
  example; use-case entry points; docs as Markdown for agents. Personalized keys don't apply to
  us.

### Tailwind CSS (tailwindcss.com/docs)

- Sidebar: Getting started, Core concepts, Base styles, then a utility reference grouped by CSS
  area, with pages named after the CSS property (`padding`, `grid-template-columns`), so readers
  who know CSS find them.
- Install: a row of method tabs (Vite, PostCSS, CLI, Framework Guides, Play CDN), then six
  numbered steps (`01`–`06`), each one sentence plus one code block titled with a filename or
  "Terminal". About one screen. "Are you stuck?" callout at the end.
- Utility pages: quick reference table (class to CSS, "Show more"), examples each with a rendered
  preview and HTML with irrelevant classes replaced by `...`, responsive variant, customizing.
- Search: Algolia DocSearch _(not re-verified)_. Previous and next links.
- **Take:** numbered install steps with filenames; previews above code; eliding irrelevant code
  with `...`; naming pages by what the reader already knows (for us: the xterm.js API name in the
  migration table, the Monaco concept in the Singapore guides).

### Vite (vite.dev)

- VitePress. Sidebar: Introduction (Getting Started, Philosophy, Why Vite), Guide (14 pages up to
  "Migration from v7" and "Breaking Changes"), APIs (Plugin, HMR, JavaScript, Config Reference),
  Environment API.
- Getting started: "Trying Vite Online" first (StackBlitz through `vite.new/{template}`, 16
  presets in a JS and TS table), then `npm create vite@latest` in package-manager tabs (npm, Yarn,
  pnpm, Bun, Deno), then manual install, CLI, using unreleased commits.
- Version menu (v8.3.3) linking Changelog, Unreleased Docs at `main.vite.dev`, and archived docs
  for each old major on its own subdomain. Six languages. "Suggest changes to this page". ⌘K
  search (Algolia DocSearch on VitePress _(not re-verified)_).
- **Take:** "try online" before "install"; package-manager tabs; docs for main on their own
  subdomain (for us: a `next` docs build matching the `next` npm channel in Track G).

### Bun (bun.com/docs)

- Product tabs (Runtime, Package Manager, Bundler, Test Runner, Guides, Reference, Blog), each
  with its own sidebar of collapsible groups. Docs home: tagline, four product cards with their
  first command, Install and Quickstart cards, "What is Bun?", design goals.
- Quickstart: five steps; output at step 2; each code block titled `terminal`, `index.ts`,
  `index.html`; the growing `index.ts` re-shown at each stage; a troubleshooting aside for the
  likeliest failure (TypeScript errors without `@types/bun`).
- "Copy page", "View as Markdown", "Ask AI", "Edit this page on GitHub". MDX source; the
  platform looks like Mintlify but is unconfirmed.
- **Take:** a separate Guides tab of short recipes; show expected output after each command;
  put the likeliest failure inline as an aside.

### React (react.dev)

- Learn (tutorial and explanation, starting with Quick Start: "80% of the React concepts that
  you will use on a daily basis") versus Reference (one page per API).
- MDX components: `<Intro>`, `<YouWillLearn>`, `<Sandpack>` (multi-file, editable, live preview;
  Fork, Reset and Download buttons _(not re-verified)_), `<DiagramGroup>` with alt text and
  captions, `<Pitfall>`, `<DeepDive>`, `<Recipes>` (several named examples in one block),
  `<CodeStep>` (numbered highlights in code matched to colored words in prose), 🚩 and ✅
  comments for wrong and right code.
- Reference template as in principle 7. Cross-links run in every direction: caveats link to
  troubleshooting, usage links to Learn.
- `/llms.txt` sitemap. Search: Algolia DocSearch _(not re-verified)_.
- **Take:** the reference page template, symptom-named troubleshooting, `CodeStep`-style linking
  of prose to code, wrong-versus-right pairs.

### Svelte (svelte.dev/tutorial)

- Split screen: lesson prose on the left (with previous and next), file tree, editor and preview
  on the right; "solve" button per exercise ("disabled on sections … that don't include an
  exercise"); four parts (Basic Svelte, Advanced Svelte, Basic SvelteKit, Advanced SvelteKit);
  "Edit this page on GitHub"; vim toggle. Each lesson demonstrates one feature and later lessons
  build on earlier ones.
- **Take:** the gold standard for a learning-oriented tutorial in the browser. A smaller version
  fits our tutorials: an embedded Singapore editor holds the reader's code and a live preview
  runs it. Singapore editing its own tutorial code is a demo in itself.

### Astro (docs.astro.build) and Starlight (starlight.astro.build)

- Astro docs are built with Starlight. Four tabs: Tutorial ("Build a blog", six units), Guide,
  Reference (template syntax, config, CLI, runtime API, error reference), Ecosystem. Upgrade
  guides from v1 to v7. 15 languages. Landing: two buttons (Install, Learn features), cards for
  themes, tutorial, `npm create astro@latest`.
- Starlight (0.42.5, needs Astro ^7.2.10; we run 7.3.5): Pagefind search by default (Algolia
  DocSearch plugin optional), i18n, sidebar config with autogenerated groups, Expressive Code for
  code blocks, components (Tabs with synced keys, Cards, LinkCard, Steps, Aside, FileTree, Badge,
  Icon), edit link, last updated, previous and next, dark and light, component overrides, MDX and
  Markdoc, custom Astro pages beside the docs.
- Plugin ecosystem (from the plugins page): `starlight-typedoc`, `starlight-links-validator`,
  `starlight-llms-txt`, `starlight-versions`, `starlight-changelogs`, `starlight-blog`,
  `starlight-sidebar-topics`, `starlight-image-zoom`, `starlight-kbd`, `starlight-page-actions`
  and `starlight-contextual-menu` (copy as Markdown), `starlight-package-managers`,
  `starlight-github-alerts`, `astro-live-code` (MDX code blocks as live components), and diagram
  integrations (`astro-mermaid`, `astro-d2`).

### TanStack (tanstack.com)

- Docs live as GitHub-flavoured Markdown in each library's repository; the tanstack.com app
  renders them. Framework and version pickers; the same page swaps framework-specific blocks.
- Tabs are HTML comments (`<!-- ::start:tabs variant="package-manager" -->`), so files still read
  well on GitHub. Package-manager tabs take per-framework lines. `redirect_from` front matter
  handles moved pages.
- Examples live in the repo under `examples/<framework>/<name>` and open in StackBlitz ("Open in
  StackBlitz" loads straight from GitHub).
- Reference pages under `docs/framework/*/reference` are generated by TypeDoc from JSDoc
  (`scripts/generate-docs.ts`, `@tanstack/typedoc-config`); CONTRIBUTING tells people to edit the
  JSDoc because the next run overwrites the Markdown.
- **Take:** examples as real projects in the repository, opened in StackBlitz from GitHub; our
  public mirrors make this work for Singapore and ghostty-webgpu with no extra hosting.

### Zed (zed.dev/docs)

- Getting started: one-line intro, then five numbered Quick Start steps (open a project,
  essential commands, configure, set up a language, try AI), "Coming from another editor?"
  (VS Code, IntelliJ, PyCharm, WebStorm, RustRover migration pages), community links.
- Keybindings in a three-column table (Action, macOS, Linux/Windows); settings named by key
  with anchors in an all-settings reference; the in-app Settings Editor is offered first.
- `llms.txt` banner. Tooling looks like mdBook (relative `.md` links, highlight.js) but is
  unconfirmed.
- **Take:** "coming from X" migration pages as a first-class section; keybinding tables per
  platform (Singapore and ghostty-webgpu keymaps, and hotkeys).

### Diátaxis (diataxis.fr)

- Four kinds of page, the compass's two questions, and a workflow: choose something, assess it
  ("what user need does it serve, how well?"), decide the single next improvement, do it and
  publish. Docs are "never finished" but can be "always complete".
- Tutorial rules worth pinning above every tutorial we write: show where the learner is going (not
  "In this tutorial you will learn…"), visible results early and often, a narrative of the
  expected ("The output should look something like…"), point out what to notice, minimise
  explanation, stay concrete, ignore options and alternatives, aspire to perfect reliability.

### Summary table

| Site       | Docs home              | First success                  | Examples                                  | Reference and generator                | Search           | Versioning                      | Agent-readable           |
| ---------- | ---------------------- | ------------------------------ | ----------------------------------------- | -------------------------------------- | ---------------- | ------------------------------- | ------------------------ |
| CodeMirror | Live editor, card list | Bundling example, minutes      | 25 task pages with live editors, Try page | One page, getdocs-ts                   | None             | v5 kept separately              | No                       |
| xterm.js   | Sidebar only           | No quick start                 | Inline snippets                           | TypeDoc 0.17 into Jekyll               | None seen        | Current only                    | No                       |
| Ghostty    | Four cards             | Download                       | VT validation scripts                     | Config reference generated from source | Not seen         | "Available since" notes         | No                       |
| Monaco     | TypeDoc index          | Playground                     | Playground                                | Default TypeDoc theme                  | TypeDoc (broken) | No                              | No                       |
| Lexical    | Intro page             | Quick start, vanilla and React | Playground, gallery                       | TypeDoc through Docusaurus             | Docusaurus       | Not seen                        | Copy page                |
| tldraw     | Quick start            | `npm create`, five minutes     | 11-category live gallery                  | API Extractor                          | ⌘K               | Source pinned to tag            | Copy markdown            |
| Stripe     | Card hub               | Quickstarts                    | Full integration samples                  | Custom (OpenAPI)                       | Custom           | API versions                    | `.md`, CLI               |
| Tailwind   | Install                | Six steps, minutes             | Rendered previews                         | Hand-written, templated                | DocSearch        | v3 site                         | Not seen                 |
| Vite       | Getting started        | StackBlitz before install      | `vite.new/*`                              | Hand-written                           | ⌘K               | Per-major subdomains, main docs | Not seen                 |
| Bun        | Product cards          | Output at step 2               | Guides tab                                | Reference tab                          | `/` search       | Current                         | Copy page, `.md`, Ask AI |
| React      | Quick start            | Sandpack in page               | Sandpack recipes                          | Hand-written, strict template          | DocSearch        | Legacy site                     | `llms.txt`               |
| Svelte     | Tutorial               | Split-screen lesson            | Every lesson live                         | Hand-written                           | Custom           | Current                         | Not seen                 |
| Astro      | Cards                  | `npm create astro`             | Tutorial units                            | Hand-written                           | ⌘K               | Upgrade guides v1–v7            | Not seen                 |
| TanStack   | Overview               | Install plus StackBlitz        | `examples/` in repo                       | TypeDoc to committed Markdown          | ⌘K               | Version picker                  | Markdown sources         |
| Zed        | Quick start            | Five steps                     | In-app                                    | All-settings page                      | Not seen         | Current                         | `llms.txt`               |

## 3. Proposed tables of contents

Rules for both sites:

- Starlight sidebar groups: **Start here** (tutorial), **Guides** (how-to), **Reference**
  (generated plus a few templated tables), **Concepts** (explanation). Examples sit in their own
  top-level section because they are the most browsed part of CodeMirror's and tldraw's sites.
- Write the pages marked ★ first. They form a complete, useful site on their own (Diátaxis:
  no empty sections). The rest follow, each published when ready. Planned features are labeled
  "Planned" and link to the plan (Plan 336 decision 3).
- Every guide uses one template: what you will have at the end (one sentence and a screenshot or
  live embed), prerequisites, numbered steps with code blocks titled by filename, the result,
  "If it doesn't work" (symptom-named), next steps.
- Every concept page opens with a three-sentence summary, has at least one diagram, and links the
  reference symbols it explains.

### Singapore (`editor/site`, docs at `/docs`)

Landing page (custom Astro, outside Starlight): CodeMirror-style. A live Singapore editor with a
real TypeScript file, tree-sitter colors, minimap and find; one-sentence pitch; three proof
numbers linking the comparison page; `npm install @singapore-editor/core`; cards into the docs.

**Start here**

| Page                                      | Content                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ★ Introduction                            | What Singapore is, who it is for, what is in the box (core plus optional packages), when to pick Monaco or CodeMirror instead. One live editor. Links to the three paths below.                                                                                                |
| ★ Quick start                             | Install, mount an editor, open a document, dispose. Under a minute; ends with a live copy of the result. Tabs: npm, pnpm, Bun, Yarn. Tabs: vanilla, React, Solid.                                                                                                              |
| ★ Tutorial: build a TypeScript playground | Six steps, each with a visible result in an embedded preview: core editor, a VS Code theme, tree-sitter highlighting, gutters and find, the TypeScript language service in a worker (hover, completion, diagnostics), a minimap. About 15 minutes. Ends with "what you built". |
| Coming from Monaco                        | Concept and API mapping table (models to documents, `ITextModel` to snapshots, decorations, `registerCompletionItemProvider` to LSP plugin, themes, workers). What is different and why.                                                                                       |
| Coming from CodeMirror                    | Same shape: state and transactions to documents and edits, extensions to plugins, decorations, language packages to tree-sitter.                                                                                                                                               |

**Guides**

| Page                             | Content                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★ Bundling and workers           | Vite, webpack, Next.js and plain ESM. Worker URLs, wasm grammars, CSP, optional cross-origin isolation (tree-sitter cancellation uses `SharedArrayBuffer` when present). The guide Monaco never had. |
| ★ Documents and sessions         | Open, switch, save state, close; snapshots; disposal; many editors on one page.                                                                                                                      |
| Reading and editing text         | Text edits, transactions, reading lines, snapshots and anchors from host code.                                                                                                                       |
| Selections and multiple cursors  | Reading and setting selections, multi-cursor commands.                                                                                                                                               |
| Undo and history                 | Undo graph, persisted undo across sessions.                                                                                                                                                          |
| ★ Themes and styling             | Theme object, VS Code theme conversion through `/shiki`, `registerEditorColor`, CSS variables, the gutter inset.                                                                                     |
| ★ Syntax highlighting            | Shiki or tree-sitter: when to use which; setup for each.                                                                                                                                             |
| Add a language                   | Bring a tree-sitter grammar with highlight, fold and injection queries; bundled grammars in `tree-sitter-languages`.                                                                                 |
| ★ Language servers               | `lsp` and `lsp-plugin`: connect over WebSocket or a worker; diagnostics, completion, hover, rename, code actions.                                                                                    |
| TypeScript in the browser        | `typescript-lsp`: the real TypeScript language service in a worker, virtual files, types for imports.                                                                                                |
| Keymaps and commands             | Keymap packs, chords, custom commands, sharing keys with the host app (hotkeys).                                                                                                                     |
| Gutters and folding              | Line numbers, fold arrows, custom gutter markers.                                                                                                                                                    |
| Find and replace                 | Widget, regex and case options, programmatic search.                                                                                                                                                 |
| Minimap                          | Setup, options, document-space behavior.                                                                                                                                                             |
| Diff view                        | A diff is an editor with one plugin; side by side and inline; hunks.                                                                                                                                 |
| Markdown                         | Live preview and editing commands.                                                                                                                                                                   |
| Decorations and row presentation | Marks, widgets, line classes, row presentation handles.                                                                                                                                              |
| Hovers and popups                | `plugin-ui`: one shared hover for every plugin.                                                                                                                                                      |
| ★ Write a plugin                 | The extension API from a 20-line example to a real feature; lifetimes and disposal.                                                                                                                  |
| Structure guides                 | Indent guides, sticky headers (`scope-lines`).                                                                                                                                                       |
| Spellcheck                       | Worker dictionary, one service per page.                                                                                                                                                             |
| ★ Large files                    | Limits of the core, the `paged` viewer for files too big to load, measured numbers.                                                                                                                  |
| Split panes                      | `panes` for plain DOM layouts.                                                                                                                                                                       |
| Accessibility                    | Screen reader behavior, keyboard-only use, reduced motion.                                                                                                                                           |
| Testing your integration         | The `/testing` entry point, deterministic workers in tests.                                                                                                                                          |

**Examples** (each: live editor, source, "Open in StackBlitz" from the public `singapore` mirror)

Basic editor, Read-only viewer, Huge document, Two editors on one document, Custom theme,
Tree-sitter language, Language server over WebSocket, TypeScript playground, Diff of two files,
Markdown preview, Custom gutter marker, Custom command and keybinding, Inline widgets, Decode
reveal animation, React app, Solid app, Paged viewer for a 1 GB log.

**Reference** (generated unless noted)

| Page                       | Content                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ★ Packages                 | Hand-written table of all 21 packages: purpose, entry points, size, status.                                                                                                                                                                            |
| ★ `@singapore-editor/core` | One page group per entry point: `/editor`, `/document`, `/extensions`, `/rendering`, `/syntax`, `/keymap`, `/shiki`, `/testing`.                                                                                                                       |
| One group per package      | `textbuffer`, `tree-sitter`, `tree-sitter-languages`, `lsp`, `lsp-plugin`, `typescript-lsp`, `gutters`, `find`, `minimap`, `diff`, `markdown`, `highlighting`, `plugin-ui`, `scope-lines`, `spellcheck`, `paged`, `panes`, `decode`, `react`, `solid`. |
| Commands                   | Generated from the command registry (today `editor/docs/commands.md`): id, title, default keys per platform.                                                                                                                                           |
| Keymap packs               | Generated tables, Zed style: action, macOS, Linux and Windows.                                                                                                                                                                                         |
| Theme colors               | Generated list of color tokens with defaults.                                                                                                                                                                                                          |
| Errors                     | Generated from the error catalogs: code, why, fix.                                                                                                                                                                                                     |
| Browser support            | Required platform APIs (CSS Custom Highlight API, workers, `SharedArrayBuffer` optional) and browser versions.                                                                                                                                         |

**Concepts**

| Page                           | Content                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★ Architecture                 | The CodeMirror System Guide equivalent: main thread versus workers, document engine, transactions, layout, rendering, extension system, the typing flow. From `editor/ARCHITECTURE.md` and `docs/architecture/worker-topology.md`. Diagrams. |
| ★ Text storage                 | The persistent AVL piece table, copy-on-write snapshots, why old versions stay readable, comparison with Monaco's piece tree, CodeMirror's line tree and Zed's rope (the README table, expanded). Optional live piece-tree inspector.        |
| Positions and anchors          | Offsets, positions, stable anchors and how they survive edits (`docs/positions/`).                                                                                                                                                           |
| Rendering                      | CSS Custom Highlight API painting, virtualization, point queries, browser quirks (`docs/display/`).                                                                                                                                          |
| Syntax pipeline                | Tree-sitter in a worker, incremental parses, injections, token store.                                                                                                                                                                        |
| Undo graph                     | The undo model (`docs/editing/undo-graph.md`).                                                                                                                                                                                               |
| ★ Performance                  | Budgets (one 120 Hz frame per keystroke), how we measure, reproducible comparison with Monaco and CodeMirror (Track B), with date, machine and method.                                                                                       |
| Collaborative editing, planned | Weidner's approach: stable character IDs, server-ordered "insert after" operations, client rebase. Labeled Planned, links the plan.                                                                                                          |

**Also:** Changelog (from Changesets), Roadmap link, Contributing (points to fregat).

### ghostty-webgpu (`ghostty-webgpu/site`, docs at `/docs`)

Landing page: keep the existing custom Astro page. Add a "Docs" link and an install snippet that
links the quick start.

**Start here**

| Page                                    | Content                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★ Introduction                          | What it is (Ghostty's terminal core in wasm plus GPU renderers), what it is not yet (addon ecosystem, planned), browser support, one live terminal running the in-browser shell the site already has.                                                                                                                                                                        |
| ★ Quick start                           | Install, a sized host element, `Terminal.create()`, `open`, `write`, `focus`, `dispose`. Ends with a live terminal echoing typed keys. Under a minute.                                                                                                                                                                                                                       |
| ★ Tutorial: a real shell in the browser | A 40-line Node or Bun server with a PTY over WebSocket, the client from the quick start, resize, then the result: your own shell in a browser tab. About 10 minutes; expected output after every step.                                                                                                                                                                       |
| ★ Coming from xterm.js                  | API mapping table (`new Terminal(opts)`/`open` to `Terminal.create()`/`open`, `onData`, `write`, `resize`, `loadAddon(FitAddon)` to built-in fit, `ITheme`, link providers, decorations), addon-by-addon status (built in, planned, not planned), behavior differences (async creation, bytes in and out, fonts), and a measured performance section linking the benchmarks. |
| Coming from ghostty-web                 | Same shape, shorter.                                                                                                                                                                                                                                                                                                                                                         |

**Guides**

| Page                            | Content                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ★ Connect to a PTY              | WebSocket transport, binary frames, flow control and backpressure, reconnecting, `attachOutputPort` for producer ports.                 |
| ★ Renderers and fallbacks       | WebGPU, WebGL2, Canvas 2D, DOM: `auto` selection, forcing one, capability errors (`code`, `why`, `fix`), what each costs.               |
| ★ Run in a worker               | The `/worker` entry: what moves off the main thread, the async API convention, hosting the worker and wasm files.                       |
| ★ Fonts                         | Loading fonts by URL or bytes, fitting, emoji and CJK fallback, ZWJ widths, geometry.                                                   |
| Themes and Ghostty config       | Theme object, reading a Ghostty config with `/config-resolver`.                                                                         |
| Size and fit                    | Host sizing, fit, resize events, device pixel ratio.                                                                                    |
| Selection, clipboard and OSC 52 | Selection API, clipboard policy, why OSC 52 is denied by default and how to allow it.                                                   |
| Links                           | Link detection, providers, keyboard link navigation.                                                                                    |
| Hotkeys                         | `attachTerminalHotkeys`, default packs, sharing focus with a host app.                                                                  |
| Scrollback and reading history  | `lineCount`, `readLines`, screens, retention.                                                                                           |
| Restore a terminal after reload | Saved viewport, first frame as HTML (`renderFrameToHtml`, `paintTerminalViewport`) for instant paint.                                   |
| Many terminals on one page      | Browsers cap live WebGL contexts (Chrome at 16 _(not re-verified)_); sharing, pausing hidden terminals, the 17-terminal benchmark case. |
| React, Solid and Vue            | Mounting and disposal in each framework.                                                                                                |
| Bundling and hosting assets     | Vite, webpack, Next.js; wasm files, worker URL, CSP, cache headers.                                                                     |
| Accessibility                   | Screen reader text, submitted rows, reduced motion.                                                                                     |
| Testing your integration        | Reading text back in tests, software GPU in CI.                                                                                         |

**Examples** (live terminal plus source plus "Open in StackBlitz" from the public mirror)

Echo terminal, In-browser shell, PTY over WebSocket, Worker terminal, Renderer switcher, Theme
switcher, Font switcher, Search in scrollback (planned until the addon exists), 16 terminals grid,
Replay a recorded session, Ghostty config file applied live.

**Reference**

| Page                             | Content                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ★ `ghostty-webgpu`               | Generated: `Terminal`, `TerminalSession`, renderers, options, events, types.                             |
| `ghostty-webgpu/worker`          | Generated.                                                                                               |
| `ghostty-webgpu/config-resolver` | Generated.                                                                                               |
| ★ Options                        | Templated table: option, type, default, since.                                                           |
| Errors                           | Generated from the error catalog: code, why, fix.                                                        |
| Supported sequences              | Table of supported VT sequences linking Ghostty's per-sequence pages, plus any web-specific differences. |
| Browser support                  | Renderer by browser matrix.                                                                              |

**Concepts**

| Page                  | Content                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| ★ How it works        | libghostty-vt compiled to wasm, the render state, frame building, the renderer, the DOM host. One diagram.      |
| ★ Damage tracking     | Redrawing only changed cells: first frames and damage, GPU frame ownership.                                     |
| Execution conventions | Sync main-thread API versus async worker API (`TerminalApi<'sync' \| 'async'>`).                                |
| Correctness           | Same core as Ghostty; a live conformance page that runs Ghostty's VT validation scripts in our terminal.        |
| ★ Benchmarks          | From `docs/benchmarks.md`: environment, method, like-for-like tables per renderer, artifacts, how to reproduce. |

**Also:** Changelog, Roadmap (planned addons, labeled Planned), Contributing. Engineering notes
(autoresearch, phase acceptance, perf attribution, renderer baselines) stay in the repository.

## 4. Tooling recommendation

### Site framework: Starlight, with custom Astro landing pages

Use Starlight 0.42 for both docs sections, as Plan 336 decision 4 assumes. No reason against it
turned up:

- It is what Astro's own docs use, and it covers everything on the principles list out of the
  box: Pagefind search (static, no third-party account, works on Cloudflare Pages), sidebar,
  previous and next, edit link, last updated, Expressive Code, Tabs with synced keys, Steps,
  FileTree, Aside, i18n if ever wanted.
- Custom Astro pages coexist with it, so each landing page stays custom in the same project.
  ghostty-webgpu's site already runs Astro 7.3.5; Starlight 0.42.5 requires Astro ^7.2.10.
- Component overrides cover the shared look. Put the shared theme (CSS tokens, overridden
  `Header`, `Footer`, `PageTitle` components, the live-embed components) in one small private
  workspace package; each site sets its accent color.
- Plugins we'd use: `starlight-typedoc`, `starlight-links-validator`, `starlight-llms-txt`, a
  copy-as-Markdown page action (`starlight-page-actions` or `starlight-contextual-menu`),
  `starlight-package-managers` for install tabs, `starlight-changelogs` for Changesets
  changelogs. `starlight-versions` waits for the first minor at launch; until then the docs say
  "for version x.y.z" from `package.json` and a `next` build can serve main (Vite's
  `main.vite.dev` pattern).

A fully custom Astro docs site would mean rebuilding search, navigation, the table of contents
and code blocks for no gain. VitePress, Docusaurus, Mintlify and Next.js were not considered
further: Plan 336 fixes Astro, and Starlight is Astro's docs framework.

### API reference: TypeDoc through starlight-typedoc, with a TypeScript 6 sidecar

- `starlight-typedoc` 0.23.1 runs TypeDoc with `typedoc-plugin-markdown` and writes Starlight
  pages plus a sidebar group. `createStarlightTypeDocPlugin()` makes one instance per package,
  each with its own `entryPoints`, `tsconfig` and non-overlapping `output`, which fits Singapore's
  21 packages and many entry points.
- **The blocker:** the repository is on TypeScript 7.0.2 (the Go compiler), which ships no
  JavaScript API. TypeDoc 0.28.20 declares a peer of TypeScript ≤ 6 and crashes on 7
  (TypeDoc issue #3098: TS 7 support targets the 7.1 API, no date). Twoslash has the same
  problem. **Fix:** the docs workspace depends on `typescript@6` under the `typescript` name (6.0.3
  is already in the Bun store as a transitive dependency); the packages keep building and
  type-checking with 7. Point TypeDoc at the built `dist/**/*.d.ts` files (with `tsconfig`
  `skipLibCheck`), so TypeScript 6 only reads declarations. Note `ghostty-webgpu` exports
  `types@>=7.0` to `dist` and `types` to `types/legacy`; use the `dist` entry points directly.
  Revisit when TypeDoc supports 7.1.
- Settings: `excludePrivate`, `excludeInternal`, `@group` and `@category` tags to order members by
  meaning, `sourceLinkTemplate` pinned to the release tag (as xterm.js and tldraw do),
  `validation.notDocumented` on public exports, `treatValidationWarningsAsErrors` once the
  coverage backlog is closed. TSDoc comments with `@example` blocks become the reference examples;
  these blocks are type-checked like every other snippet (below).
- **Alternatives considered.** API Extractor (tldraw) adds a committed `api-report.api.md` that
  makes public API changes visible in review; worth adding later as a separate check, but its
  documenter output needs a custom renderer. A custom generator like CodeMirror's getdocs-ts
  gives the most control and the most work; the owner's complexity bar rules it out for now.

### Code blocks: Expressive Code, twoslash hovers later

- Expressive Code ships with Starlight: frames with filename titles, terminal frames, line and
  text markers (the react.dev `CodeStep` effect: mark a term in code and the same term in prose),
  copy buttons, word wrap. Add `@expressive-code/plugin-collapsible-sections` for long examples
  (`collapse={1-12}`) and `plugin-line-numbers` where line references matter.
- Twoslash type hovers (`expressive-code-twoslash` 0.6.1) are attractive but not ready for us:
  its peers are Expressive Code ^0.41.7 while Starlight uses 0.44, and TypeScript ^5.5. Adopt
  only after a spike proves it works on Expressive Code 0.44 with the TypeScript 6 sidecar.
  Type checking must not depend on it.

### Type-checking every snippet in CI

Two layers, both using the repository's own `tsgo`:

1. **Long examples are real files.** Every example and every multi-step tutorial file lives in
   `site/src/examples/**.ts(x)`, inside a tsconfig that resolves the workspace packages. Pages
   import them with `?raw` into Expressive Code's `<Code>` component, and the live embed imports
   the same module, so the code shown is the code that runs. Vitest browser tests mount each
   example and assert it renders (no console errors, terminal text or editor text present). The
   same folders are the StackBlitz targets.
2. **Inline fences are extracted.** A script (remark over `src/content/docs/**/*.mdx`, plus
   package READMEs per Plan 336 decision 6) writes every `ts`/`tsx` fence to a generated file per
   block in a temp project and runs `tsgo --noEmit`. Fence meta controls it: default is checked;
   `nocheck` for intentional fragments; a hidden prelude (`// ---cut---`, twoslash syntax) for
   declarations a snippet assumes; `@errors: 2540` to assert an expected error in wrong-versus-right
   examples. A failure prints the page, line and TypeScript message. TSDoc `@example` blocks go
   through the same extractor. `bun run docs:check` runs both layers.

### Link checking

- `starlight-links-validator` fails the build on broken internal links and heading anchors,
  including links into generated reference pages.
- External links: `lychee` on a weekly schedule and on demand, not per PR, so a flaky third-party
  site can't block merges; it opens an issue or fails a scheduled job the docs owner reads.
- README links: the mirrored READMEs use absolute URLs (decision 8); lychee checks them too.

### Live Singapore editors and ghostty-webgpu terminals in pages

- Write `<LiveEditor>` and `<LiveTerminal>` as Astro components that render a static placeholder
  (a screenshot or server-rendered first frame; ghostty-webgpu's site already paints first frames
  as HTML) and hydrate with `client:visible`. Pages stay readable without JavaScript and
  Lighthouse stays high.
- Import from the workspace packages, built from the same commit as the docs, so the demos run
  the documented version.
- ghostty-webgpu: reuse the site's in-browser shell (`just-bash`) as the default data source, so
  terminals show a real interactive shell with no server. Unmount terminals that scroll out of
  view to stay under the browser's WebGL context limit; at most a few live terminals per page.
- Singapore: workers and tree-sitter wasm served from the site; set COOP and COEP headers in
  Cloudflare Pages `_headers` only if cancellation through `SharedArrayBuffer` matters for a demo
  (it falls back without it).
- "Open in StackBlitz" links: `https://stackblitz.com/github/ShaulLavo/singapore/tree/main/examples/<name>`
  and the same for ghostty-webgpu, served from the public mirrors. Run one spike to confirm WebGPU,
  wasm and workers behave inside StackBlitz before linking every example.
- Optional Try page per site later (CodeMirror's Code, Output, Log tabs), with a Singapore editor
  as its code pane.

### Diagrams

Diagrams render at build time to static SVG (`astro-d2` or `astro-mermaid` in build mode), with
alt text and a caption (react.dev's `DiagramGroup` pattern). Hand-drawn SVG for the two or three
hero diagrams (Singapore architecture, ghostty-webgpu pipeline). No client-side diagram runtime.

## 5. Track F checklist

Setup

- [ ] Add Starlight 0.42 to `ghostty-webgpu/site` (docs under `/docs`, landing page unchanged) and
      create `editor/site` with a custom landing page plus Starlight.
- [ ] Shared private theme package: tokens, overridden header and footer, `LiveEditor`,
      `LiveTerminal`, per-site accent. Sentence case throughout.
- [ ] Enable Pagefind search, edit link (to fregat, the source of truth), last updated, previous
      and next, `llms.txt`, copy as Markdown, package-manager tabs, a 404 page, sitemap, Open Graph
      images.
- [ ] Docs workspace pins `typescript@6` for TypeDoc; packages stay on 7.

Content (★ pages first; no empty sections)

- [ ] Singapore ★ pages: Introduction, Quick start, TypeScript playground tutorial, Bundling and
      workers, Documents and sessions, Themes, Syntax highlighting, Language servers, Write a
      plugin, Large files, Packages, core reference, Architecture, Text storage, Performance.
- [ ] ghostty-webgpu ★ pages: Introduction, Quick start, Real shell tutorial, Coming from
      xterm.js, Connect to a PTY, Renderers and fallbacks, Run in a worker, Fonts, main reference,
      Options, How it works, Damage tracking, Benchmarks.
- [ ] Move the user-facing parts of `ghostty-webgpu/docs/` (integration, api, hotkeys, fonts,
      config resolver, history, saved viewport, benchmarks) into guides and concepts; keep
      engineering notes in the repository.
- [ ] Turn `editor/ARCHITECTURE.md` and `editor/docs/{storage,positions,display,syntax,editing}`
      into concept pages; plan-number files stay as engineering notes.
- [ ] Every guide follows the template: outcome, prerequisites, numbered steps with filename
      titles, result, "If it doesn't work" with symptom headings, next steps.
- [ ] Every tutorial follows the Diátaxis tutorial rules: visible result per step, expected
      output shown, no options or alternatives, ends by describing what was built. Test each one
      from a clean directory before publishing.
- [ ] Examples galleries with task names, a live embed and source on each page, and a StackBlitz
      link from the mirror.
- [ ] Migration pages: Coming from Monaco, Coming from CodeMirror, Coming from xterm.js, Coming
      from ghostty-web, each with a mapping table.
- [ ] Performance and benchmark pages state date, machine, browser, method and artifact, compare
      like for like, and say how to reproduce. Every superlative elsewhere links one.
- [ ] Planned features say "Planned" and link the plan; no dates.
- [ ] Copy passes `unslop` and the AGENTS.md copy rules.

Reference

- [ ] `starlight-typedoc` instance per package and entry point, from built `.d.ts`, source links
      pinned to the release tag, `@group`/`@category` ordering, internal symbols excluded.
- [ ] TSDoc on every public export, with `@example` where usage is not obvious;
      `validation.notDocumented` reported, then enforced.
- [ ] Generated tables: commands, keymap packs per platform, theme colors, error catalogs (code,
      why, fix), options.

CI (decision 5 and 6)

- [ ] `bun run docs:check`: build both sites; `tsgo --noEmit` over extracted fences from docs,
      TSDoc examples and package READMEs; example files type-checked and mounted in Vitest browser
      tests; `starlight-links-validator` fails on broken internal links.
- [ ] Docs job runs on every PR touching `editor/site`, `ghostty-webgpu/site`, package sources,
      READMEs or the docs theme.
- [ ] Weekly `lychee` external link check.
- [ ] Lighthouse mobile performance ≥ 95 on each docs home and one heavy page (with live embeds).
- [ ] Changelog page per site generated from Changesets (Track G).

Review

- [ ] Screenshots of each docs home, a guide, a reference page and an example at desktop and
      phone widths, sent to the owner.
- [ ] One person with no context follows each quick start from a clean directory and reaches a
      working result; record the time. Target: under one minute after install.

## Sources

Pages read on 2026-10-08:

- CodeMirror: [home](https://codemirror.net/), [docs](https://codemirror.net/docs/),
  [System Guide](https://codemirror.net/docs/guide/), [reference](https://codemirror.net/docs/ref/),
  [examples](https://codemirror.net/examples/), [decoration example](https://codemirror.net/examples/decoration/),
  [Try](https://codemirror.net/try/), `codemirror/website` package.json
- xterm.js: [docs](https://xtermjs.org/docs/), [Terminal class](https://xtermjs.org/docs/api/terminal/classes/terminal/),
  [Using addons](https://xtermjs.org/docs/guides/using-addons/), `xtermjs/xtermjs.org` package.json
- Ghostty: [docs](https://ghostty.org/docs), [config reference](https://ghostty.org/docs/config/reference),
  [CUP](https://ghostty.org/docs/vt/csi/cup), `ghostty-org/website` repository
- Monaco: [API index](https://microsoft.github.io/monaco-editor/typedoc/index.html)
- Lexical: [intro](https://lexical.dev/docs/intro), [API](https://lexical.dev/docs/api/),
  `packages/lexical-website/docusaurus.config.ts`
- tldraw: [quick start](https://tldraw.dev/quick-start), [examples](https://tldraw.dev/examples/basic),
  [Editor reference](https://tldraw.dev/reference/editor/Editor), `packages/editor/api-extractor.json`
- Stripe: [get started](https://docs.stripe.com/get-started), [create a charge](https://docs.stripe.com/api/charges/create)
- Tailwind: [install with Vite](https://tailwindcss.com/docs/installation/using-vite), [padding](https://tailwindcss.com/docs/padding)
- Vite: [getting started](https://vite.dev/guide/)
- Bun: [docs](https://bun.com/docs), [quickstart](https://bun.com/docs/quickstart)
- React: [Quick Start](https://react.dev/learn), [useState](https://react.dev/reference/react/useState)
- Svelte: [tutorial](https://svelte.dev/tutorial/svelte/welcome-to-svelte)
- Astro and Starlight: [Astro docs](https://docs.astro.build/en/getting-started/),
  [Starlight getting started](https://starlight.astro.build/getting-started/),
  [Starlight plugins](https://starlight.astro.build/resources/plugins/)
- TanStack: [Query overview](https://tanstack.com/query/latest/docs/framework/react/overview),
  `TanStack/tanstack.com` docs-info.md, `TanStack/query` CONTRIBUTING.md
- Zed: [docs](https://zed.dev/docs/)
- Diátaxis: [home](https://diataxis.fr/), [compass](https://diataxis.fr/compass/),
  [workflow](https://diataxis.fr/how-to-use-diataxis/), [tutorials](https://diataxis.fr/tutorials/)
- Tooling: [starlight-typedoc multiple instances](https://starlight-typedoc.vercel.app/guides/multiple-instances/),
  [expressive-code-twoslash](https://twoslash.studiocms.dev/),
  [Expressive Code collapsible sections](https://expressive-code.com/plugins/collapsible-sections/),
  [TypeDoc TS 7 issue #3098](https://github.com/TypeStrong/typedoc/issues/3098),
  [TypeDoc native TS discussion #3068](https://github.com/TypeStrong/typedoc/discussions/3068),
  npm registry metadata for `@astrojs/starlight`, `starlight-typedoc`, `typedoc`,
  `typedoc-plugin-markdown`, `expressive-code-twoslash`, `twoslash`, `starlight-links-validator`,
  `starlight-llms-txt`, `starlight-versions`, `starlight-changelogs`, `starlight-package-managers`.
