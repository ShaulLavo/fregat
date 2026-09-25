# Dependency shape: the bytes no loading boundary reaches

Status: Phases 1 and 2 implemented and deployed 2026-09-20, uncommitted in both checkouts; Phase 3
not started. Requested 2026-09-20. Planned against Platform
`b915d3e0` and Editor `21c17e8`, both with unrelated working changes present.

[Plan 109](109-boot-boundaries.md) measured the entry chunk per owner and found that its own
boundaries are worth at most 6.25% of it. The larger items are large because of how a dependency is
built, not because of when it is needed. 109 named them, measured them and handed them off (its D8,
Handoffs A and B) without an owner. This plan is that owner.

It covers the Editor's inline worker blobs, the unreachable `@phosphor-icons/react` weights, and a
costed look at what is left after both. It does not cover loading boundaries or the first-load gate
([Plan 109](109-boot-boundaries.md)), the instrument (Plan 106), the markdown
stack ([Plan 108](108-markdown-modes.md)), or removing Lexical from the composer, which is
[Plan 111](111-editor-decorations.md) question 7 and is not executable until 111 answers it.

Root `PLAN.md` owns scheduling. Priority: P1. Effort: M. Risk: medium for Phase 1, because a worker
becomes a separately fetched file and inherits the no-restart deploy risk 109 describes for lazy
chunks; low for Phase 2.

## What is on the table

All figures are from 109's 2026-09-20 measurement: first-load JavaScript 2217 KB gz [disk], entry
chunk 2,270,002 gz. `KB` is 1024 bytes. "Measured" means a re-gzip of the shipped file; "modelled"
means the instrument's proportional share, which 109 showed under-reports incompressible modules by
1.87× and overstates the rest.

| Item                                   | First-load cost             | Kind     | Owner after this plan |
| -------------------------------------- | --------------------------- | -------- | --------------------- |
| Three inline Editor workers            | 579,386 gz, 25.5%           | measured | Phase 1               |
| Phosphor `thin` + `light` path data    | 128,873 raw, about 23 KB gz | modelled | Phase 2               |
| Terminal and settings boundaries       | at most 6.25% of the entry  | modelled | Plan 109 Phase 3      |
| The Lexical cone, `features/chat` only | about 50 KB gz              | modelled | Plan 111 question 7   |
| Editor main-thread code                | about 2.08 MB rendered      | modelled | Phase 3, research     |

Phase 1 alone moves first load from 2217 KB to roughly 1650 KB gz. Nothing else in the repository
is within a factor of four of it. Phases 1 and 2 plus 109's boundaries land near 1500 KB gz, and
that is the floor of this approach: what remains is `node_modules` (react-dom, `@base-ui/react`, the
markdown parser), first-party features, and the Editor's main-thread half.

Getting under that floor is a structural change, not a prune. 109 showed that the always-mounted
provider stack in `active-environment-application.tsx` statically anchors `@singapore-editor/core/shiki` and
`@singapore-editor/tree-sitter`, so no editor-surface boundary releases them. Phase 3 asks what it would take
to un-anchor them. It is research, because the answer may be that the providers need the code at
boot.

## Decisions

| Decision                                    | Proposed behavior                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 — workers ship as files                  | The Editor package build stops rewriting `new Worker(new URL(…))` into `?worker&inline`. The published `dist` keeps the `new URL('./x.worker.js', import.meta.url)` form and ships each worker as a self-contained module beside it. The consumer's bundler emits it as an asset.                                                                                                                                                    |
| D2 — no inline fallback                     | Greenfield: one shape. A consumer that cannot bundle module workers is not a consumer we have. The `createObjectURL(blob)` path is deleted with the plugin, not kept behind a flag.                                                                                                                                                                                                                                                  |
| D3 — the canonical form is asserted         | Revised in implementation. A worker file no longer has to be self-contained, because the consumer bundles it and resolves its relative imports; the tree-sitter worker keeps a Node-only sibling chunk. The build instead fails unless every `new Worker(new URL('./x.worker.ts', …))` in source came out as `new Worker(new URL("…", import.meta.url), { type: "module" })`, the only form a consumer's bundler treats as a worker. |
| D4 — Phosphor prune is global, not per icon | Keep the union of weights any call site draws (`regular`, `bold`, `fill`, `duotone`), drop `thin` and `light` from every definition. A per-icon prune saves more but needs dataflow: an icon passed as `icon={GitBranch}` is drawn at a weight chosen elsewhere.                                                                                                                                                                     |
| D5 — the prune cannot drift from the source | The kept-weight set is computed from source at build start by the same plugin that prunes. A `weight={expr}` that is not a string literal, or any `IconContext` provider, fails the build with the file and line. A pruned weight renders an empty `<svg>`, so silence is the bug.                                                                                                                                                   |
| D6 — the gate is 109's                      | This plan adds no threshold. It reports before and after with `bundle:report`, and 109 Phase 4's ratchet re-pins downward when each phase lands.                                                                                                                                                                                                                                                                                     |
| D7 — research items carry a drop threshold  | A Phase 3 item is measured by cutting it and re-running the report. Under 15 KB gz exclusive, it is dropped with the number recorded.                                                                                                                                                                                                                                                                                                |

## Phase 1 — Editor workers as files

Owner: the Editor checkout, [`scripts/build-package.ts`](../../Editor/scripts/build-package.ts).

1. **Drift check.** Confirm the three construction sites still match
   `workerConstructorPattern()`: `packages/tree-sitter/src/treeSitter/workerClient.ts:346`,
   `packages/minimap/src/workerClient.ts:133`, and `packages/editor/src/shiki/workerClient.ts:249`
   (`packages/editor` publishes as `@singapore-editor/core`). Confirm
   [`apps/web/vite.config.ts`](../apps/web/vite.config.ts) still excludes every Editor package from
   `optimizeDeps` (line 36); a pre-bundled dependency breaks the `new URL` worker pattern in dev.
2. **Emit each worker as its own entry.** Replace `inlineModuleWorkers` with a step that builds each
   `*.worker.ts` as a self-contained ES module into `dist` next to its client and rewrites only the
   extension in the client's `new URL('./x.worker.ts', …)`. Delete `inlineModuleWorkerImports`,
   `workerImportBlock` and `workerIdentifier`.
3. **Re-point the assertion** (D3).
4. **Check the Editor's other hosts.** The Solid and React packages, the demo app and any test that
   constructs a worker run against the new shape. A test that relied on the blob URL is rewritten,
   not shimmed.
5. **Rebuild and relink.** `bun run build` in the Editor, touch the platform `vite.config.ts` so dev
   picks it up.
6. **Settle the deploy question with 109.** `bun run deploy` swaps `current` without a restart, so a
   page opened on the previous release asks for a hashed worker file the new release does not have.
   Shiki language chunks and the mermaid cone already have this exposure. Use whatever 109 Phase 3
   decides for lazy chunks; if this phase lands first, it decides, and 109 adopts it.

The worker bodies were built with `minify: false` and sat inside string literals, so the platform
minifier never touched them. As real worker entries they go through the platform's worker build and
are minified, so the bytes fetched when an editor opens should fall too. Record that number; do not
predict it.

Verification: `bun run --cwd apps/web bundle:report` before and after, entry chunk down by about
579 KB gz and three worker assets present in `dist/assets`; `index.html` still names three files;
`bun run agent:browser look` on an open file with Shiki highlighting, one with tree-sitter
highlighting, and the minimap, on dev and on the mesh; the network log shows each worker fetched
once, on first editor open and not at boot.

### Outcome

Landed 2026-09-20 in [`build-package.ts`](../../Editor/scripts/build-package.ts). Vite's own library
output for a module worker is unusable as published: an absolute `/assets/…` URL, or with a relative
base a `"" + new URL(…).href` wrapper behind `@vite-ignore`, which a consumer reads as a static
asset. The build now sets `base: './'` and a post plugin, `canonicalModuleWorkers`, rewrites the
wrapper to the canonical form. `inlineModuleWorkers` and the blob fallback are gone. Dev was never
affected: `devSourcePlugin` serves Editor source, where the workers were always files.

Entry chunk, gzip-9 on disk. The "before" is 109's measurement of the same commit earlier the same
day, so a few KB of unrelated drift sit inside the delta.

|                    |                   Raw |              Gzip-9 |
| ------------------ | --------------------: | ------------------: |
| Entry chunk before |             7,528,676 |           2,270,002 |
| Entry chunk after  |             5,949,525 |           1,736,849 |
| **Delta**          | **1,579,151 (21.0%)** | **533,153 (23.5%)** |

The workers are now minified by the platform build, which the string literals never were:

| Worker      | Inline, standalone gz | As a file, gz |
| ----------- | --------------------: | ------------: |
| shiki       |               296,529 |       270,858 |
| tree-sitter |               267,291 |       248,659 |
| minimap     |                13,742 |         9,693 |

`index.html` still names three files. On release `20260920T160758Z-b915d3e0-workers-as-files`, a
`look` with no file open fetched none of the three workers
(`/work/tmp/fregat-evidence/20260920T160855Z-look-platform-1440x1000`); `editor-fast-scroll` fetched
all three once and painted highlighting and the minimap
(`/work/tmp/fregat-evidence/20260920T160822Z-scenario-editor-fast-scroll`). Step 6, the stale-tab
worker 404 across a no-restart deploy, is still open and still shared with 109 Phase 3.

## Phase 2 — Phosphor weights

1. **Write the plugin** under `apps/web/scripts/`, beside `bundle-stats-plugin.ts`. At `buildStart`
   it scans `apps/web/src` and `packages/ui/src` for `weight=` on any JSX element and collects the
   literals (D5). In `transform`, for ids matching `@phosphor-icons/react/dist/defs/*.es.js`, it
   removes the `Map` entries whose key is not in the kept set.
2. **Build only.** Dev serves the full definitions; the scan makes the two agree by construction.
3. **Test it** the way `scripts/web-layering.test.ts` is shaped: a fixture definition file, exact
   output, a fixture with `weight={w}` that must fail, and one with `IconContext` that must fail.

Verification: `bundle:report` shows `@phosphor-icons/react` down by about 128,873 rendered bytes;
`look` on a surface with each of the four kept weights (duotone has 18 call sites, bold 9, fill 6)
and read the screenshot for an empty icon slot.

### Outcome

Landed 2026-09-20 as
[`phosphor-weight-plugin.ts`](../apps/web/scripts/phosphor-weight-plugin.ts), wired into
[`vite.config.ts`](../apps/web/vite.config.ts) after `tailwindcss()`. `collectKeptWeights` walks
`apps/web/src` and `packages/ui/src` at `buildStart` and reads every `weight=` literal; `regular` is
kept unconditionally because `IconBase` falls back to it when the prop is unset. The 34 call sites
draw `bold`, `duotone` and `fill`, so `thin` and `light` are the whole prune. `pruneWeights` rewrites
each `dist/defs/*.es.js` `new Map([…])` with a string-and-comment-aware scanner and throws on a
definition it cannot read — an unpruned module is a build failure, not a silent pass.

Measured with `bundle:report` on the same working tree, the plugin out and then in. Entry chunk only;
nothing else in the build moved.

|                    |                 Raw |             Gzip-9 |
| ------------------ | ------------------: | -----------------: |
| Entry chunk before |           5,979,441 |          1,752,756 |
| Entry chunk after  |           5,860,567 |          1,721,696 |
| **Delta**          | **118,874 (1.99%)** | **31,060 (1.77%)** |

`@phosphor-icons/react`'s first-load share falls 75,575 → 53,967 gz, 28.6%. The raw delta lands
within 8,000 bytes of the 128,873 the plan modelled. First-load JavaScript is now 1722 KB gz.

The prune is exact rather than approximate: the shipped entry holds 139 icon definitions and each
one has precisely the four kept weights — `regular`, `bold`, `fill` and `duotone` all appear as 139
map keys, `thin` and `light` as none.

Verified on release `20260920T201321Z-46edcf82-phosphor-weights`. `duotone` paints in the
empty-workspace folder and the command-palette category icons
(`/work/tmp/fregat-evidence/20260920T201349Z-look-platform-1600x1000`,
`…/20260920T201404Z-scenario-command-palette-type-burst`), `fill` in the contained render-error
badge (`…/20260920T201418Z-scenario-pane-render-crash`), `bold` in the session rail's New session
plus (`…/20260920T201431Z-scenario-chat-timeline`), `regular` throughout. No empty icon slot in any
of them.

D5's guards are covered by [`phosphor-weight-plugin.test.ts`](../apps/web/scripts/phosphor-weight-plugin.test.ts),
which is in `test:scripts`: a fixture definition with exact pruned output, an untouched definition
when every weight survives, and a failing build for `weight={w}`, for `IconContext` and for a
misspelled weight.

## Phase 3 — what is left, costed

Research. Each item is measured by cutting it on a scratch branch and re-running the report, then
dropped or promoted to its own plan (D7).

| Question                                                                                                                                                                      | Why it is worth asking                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Can `state/syntax-highlighting.ts` and `lib/code-theme/utils/catalog.ts` reach the Editor through a dynamic import, so the provider stack holds a handle instead of the code? | It is the only route to the Editor's main-thread half, about 2.08 MB rendered, the largest remaining owner. |
| Why are `@shikijs/vscode-textmate` and `oniguruma-to-es` (127,644 rendered together) in the entry chunk when tokenizing runs in a worker?                                     | Either the main thread tokenizes something at boot or an import is wider than it needs to be.               |
| `evlog` is 119,891 rendered in the client. How much of it is server-side machinery the browser never runs?                                                                    | Sixteen client modules import it; a browser entry or a narrower import may exist.                           |
| `minimatch` (41,118 rendered) reaches the client through `packages/contracts/src/workspace-search-match.ts`. Does the client call it?                                         | A contracts module that only the server executes should not be in the client graph.                         |
| Is a per-icon Phosphor prune worth the dataflow? Most of the 134 icons draw one weight, so the ceiling is near 300,000 rendered bytes.                                        | Only if Phase 2's number, once real, leaves Phosphor in the top five.                                       |

Verification: each row ends with a measured exclusive-byte figure and a verdict in this document.

### Q1 — the Editor's main-thread half: measured, and the question was wrong

Answered 2026-09-20 against the build with Phases 1 and 2 in. Method: a throwaway Rollup plugin
dumped `getModuleInfo` for every module in the client build, giving the real static import graph
including which edges are dynamic; reachability was then recomputed from `main.tsx` with chosen
edges removed, and the byte ceiling was measured for real by rebuilding with
`external: [/^@singapore-editor\//]`. Both the plugin and the switch were removed afterwards.

**The premise does not hold.** The two modules the question names are not the route, and neither is
the provider stack alone:

| Cut                                                               | Modules released | Rendered bytes released |
| ----------------------------------------------------------------- | ---------------: | ----------------------: |
| `lib/code-theme/utils/catalog.ts` stops importing the Editor      |                0 |                       0 |
| `state/syntax-highlighting.ts` stops importing the Editor         |                3 |                  21,448 |
| `features/editor/utils/plugins.ts` stops importing the Editor     |                — |                 175,864 |
| Every static edge from the app into `@singapore-editor/*` removed |              516 |               2,362,077 |

`catalog.ts` releases nothing: it imports `VSCODE_THEMES` for metadata only, and every byte behind
it is held by something else. `syntax-highlighting.ts` releases 21,448 — and not the Shiki cone, but
`tree-sitter-languages/dist/catalog.generated.js`. The Editor's own Shiki subtree is 35,962 rendered
in the entry, not 2 MB; the weight is the editor proper (`Editor.js`, the virtualizers,
`documentSession`, `inputSelectionController`).

**Of 50 boot-reachable modules that statically import an Editor package, 48 have a marginal of
exactly zero.** Everything funnels through the same package barrels, so cutting any one edge frees
nothing. The real anchors are `features/editor/{utils,state,hooks,components,providers}`,
`features/search`, `features/settings`, `features/workspace`, `features/git`, `features/chat`,
`features/workbench`, `keymap/{default-bindings,state,utils}`, `lib/{diagnostic,document-symbols,
language-server-capabilities,language-server-document,file-open-intent}`, `main.tsx` (three
stylesheets) and `packages/client-core/src/{commands/metadata,git/diff-files}` — across twelve
Editor packages. `keymap/utils/when.ts` and `client-core`'s command metadata reaching
`editor/dist/public/keymap.js` is the shape of the problem: the command registry cannot boot without
the editor's keymap types' runtime module.

**The ceiling, measured not modelled.** Externalizing `@singapore-editor/*` entirely:

|                                  |                   Raw |              Gzip-9 |
| -------------------------------- | --------------------: | ------------------: |
| Entry chunk, as built            |             5,860,567 |           1,721,696 |
| Entry chunk, Editor external     |             4,619,470 |           1,375,182 |
| **Exclusive to the Editor cone** | **1,241,097 (21.2%)** | **346,514 (20.1%)** |

The gz figure covers the twelve Editor packages plus what only they pull — `micromark` and the
`mdast` stack behind `@singapore-editor/markdown` (about 190,000 rendered together) and `diff`
(31,624). First load would go 1722 KB → about 1384 KB gz.

**Verdict: promoted, but not as this question asked it.** 346 KB gz clears D7 by more than twenty
times and is the largest cut left in the repository, second only to Phase 1. It is not a dynamic
import in two modules; it is an all-or-nothing boundary across 50 call sites and twelve packages,
where no intermediate step pays anything. That makes it a plan of its own, not a Phase 3 item, and
its first question is not bundling but whether the command registry, the keymap and `client-core`
can describe the editor without importing it. The two modules the question named are dropped with
their numbers recorded: 0 and 21,448 rendered, both under D7's threshold.

### The duplicated markdown stack

Found while checking Q1's numbers, fixed in part 2026-09-21. The `markdown stack` the table above
attributes to the Editor is not the Editor's own parser: it is a **second copy of the platform's**,
at identical versions, resolved out of `/work/projects/Editor/node_modules` because of the `link:`
setup. Fifty-five npm packages ship twice in the entry chunk, 265,995 rendered bytes from the Editor
side. `bundle:report` never flagged it because its duplicate detector keys on version, and the
versions match — an instrument gap, not a build one.

The route is `features/editor/providers/workspace-edit-context.ts` → `@singapore-editor/lsp-plugin`
→ `@singapore-editor/plugin-ui` → `markdownTooltip.js` → `remark-gfm` → micromark.

Two things were wrong and one was fixed. `plugin-ui` already ships granular subpath exports
(`./hover-participant`, `./anchored-surface`, `./offset-range`, `./tooltip`, `./markdown-tooltip`),
so the package is shaped correctly for standalone use — but `lsp-plugin` imported the root barrel in
eleven places and the platform in two, and the barrel statically re-exports `markdownTooltip`. All
thirteen now import subpaths, and `markdownTooltip` builds its two `unified()` pipelines on first
use instead of at import.

Measured back-to-back on the same tree: entry 4,585,845 → 4,578,074 raw, 1,377,519 → 1,375,816 gz-9.
**1,703 gz, 0.12%** — far less than the duplicate is worth, because the barrel was not the only
route. `plugin-ui/tooltip.ts` imports `renderTooltipMarkdown` directly, and `lsp-plugin` needs
`createTooltipController`: a tooltip renders markdown, so that edge is real. The duplicate's bytes
leave only when `lsp-plugin` leaves the boot path, which is the same structural item as Q1 — or if
the tooltip's markdown renderer becomes injectable, which is an API change to the library.

**The hover surface now splits.** `plugin-ui/hoverToken.ts` already registers the hover as an
ambient plugin loaded by `import('./hoverPlugin')` on the first participant, with a comment saying
the Markdown renderer is part of what that defers. One static import defeated it, and the Editor's
own build had been warning about it: `INEFFECTIVE_DYNAMIC_IMPORT — hoverPlugin.js is dynamically
imported by hoverToken.js but also statically imported by lsp-plugin/dist/plugin.js`. `lsp-plugin`
wanted two trivial symbols from it — a `WeakMap.get` and a `closest('[data-editor-popup]')`.

`isInsideEditorPopup` moved to `anchoredSurface.ts`, beside the code that writes the attribute, and
the controller registry to a new leaf `hoverRegistry.ts` with a `./hover-registry` subpath.
`hoverPlugin.ts` writes into the registry instead of owning it. Nothing statically imports
`hoverPlugin` any more, the warning is gone, and `hoverPlugin` + `hoverController` now ship as a
4,333-byte dynamic chunk fetched on first hover. Entry 4,578,387 → 4,574,164 raw, 1,375,919 →
1,374,646 gz-9: **1,273 gz**.

**And the parser still did not leave, for a third reason.** `plugin-ui/tooltip.ts` statically
imports `renderTooltipMarkdown`, and `lsp-plugin/src/signatureHelpController.ts:21` statically
imports `createTooltipController` — constructed eagerly at `plugin.ts:501`, and it renders real
markdown (`hoverText: display.markdown`). So `tooltip.js` (26,604) and `markdownTooltip.js`
(12,826) stay in the entry with the 282,392 rendered bytes of duplicated npm behind them.

That was the last anchor, and it came out by demand-loading signature help rather than by any
bundling trick. `signatureHelp.ts` holds `signatureHelpTriggerFromChange`, a pure function over a
single-character edit with only type imports — the perfect demand signal. `LanguageServerContribution`
now keeps the controller's options instead of the controller, and `updateSignatureHelp` returns early
until an opening `(` or a `,` arrives, then `import('./signatureHelpController')` once and forwards
every update after. `)` on a signature that was never shown loads nothing. Disposal settles into a
load still in flight; the controller's own `dispose` is idempotent, so the race is safe.

Measured in isolation — the platform tree held constant, the Editor change stashed and restored,
rebuilt and re-measured back-to-back:

|                             |                 Raw |             Gzip-9 |
| --------------------------- | ------------------: | -----------------: |
| Entry, signature help eager |           4,574,164 |          1,374,656 |
| Entry, signature help lazy  |           4,441,041 |          1,338,319 |
| **Delta**                   | **133,123 (2.91%)** | **36,337 (2.64%)** |

`markdownTooltip`, `plugin-ui/tooltip`, `signatureHelpController` and `hoverPlugin` are all absent
from the entry chunk. The duplicated npm from the Editor checkout falls from 282,392 to 37,913
rendered. Both now live in an `assets/tooltip-*.js` chunk of 129,975 bytes, fetched on the first
hover or the first `(` — never at boot.

Two `anchoredSurface` tests typed `(` and answered the request synchronously; the first signature
help of a session is now async. They wait on a new `awaitRequest(method)` helper that polls the
transport rather than on a fixed flush — a fixed delay passed the second test and failed the first,
because the very first dynamic import of a process resolves over more turns than a later one.

### The trigger read the wrong signal, and had since before this plan

Writing the browser scenario for the change above found that **typing `(` never opened signature
help at all**, on the lazy build or the eager one — the control run on the previous release failed
the same way, with the surface present but hidden. `signatureHelpTriggerFromChange` required
`edits.length === 1 && edit.text.length === 1`, and auto-close writes a typed `(` as the
two-character `()` in one edit, deliberately: `inputSelectionController.ts` carries the comment
_"One edit, not two: the renderer only takes its incremental path for a single-edit change."_
Worse, typing over the closer it inserted calls `typeOverCloser`, which is a `setSelection` with no
text edit at all, so `)` could never dismiss either. No reshaping of the edits fixes that half.

VS Code does not have this bug despite the same auto-close behavior, because its `ParameterHintsModel`
triggers on `editor.onDidType(text)` — the keystroke — and uses the content change only to retrigger
or dismiss a hint already on screen. Aligned with that:

- `EditorViewContributionContext.onDidType?(listener)` is new and optional, fed from `applyTypedText`
  (the single funnel for `beforeinput`, the keydown fallback and deduced/composition input) and
  delivered from `applyChange` after the edit lands, so a listener that reads the document sees the
  character in it. Type-over emits it too, having no edit of its own.
- `signatureHelpTriggerFromChange(change)` became `signatureHelpTriggerFromTypedText(text)`, which
  also removes the `edits.length` fragility. The controller keeps `update` for hide and re-anchor
  and gains `handleTypedText`; `LanguageServerContribution` subscribes in its constructor and
  disposes the registration.
- The demand gate for the lazy load is the same function, so the byte result is unchanged:
  `markdownTooltip`, `plugin-ui/tooltip` and `signatureHelpController` all stay out of the entry.

The scenario now types `(` and then `)` like a person, and asserts both the surface and its
dismissal. Verified on release `20260921T052025Z-f9a0815e-vscode-typed-trigger`
(`/work/tmp/fregat-evidence/20260921T052040Z-scenario-editor-lsp-signature-help`). `lsp-plugin`'s
382 tests pass; the harness context now carries `onDidType`, because a contribution that reads the
keystroke cannot be tested by a harness that only replays edits. The five failures in
`packages/editor` are pre-existing — verified by re-running `autoClose.test.ts` with these changes
stashed.

Injecting a markdown renderer into `createTooltipController` would not have worked: signature help
renders real markdown (`hoverText: display.markdown`), so it would have had to pass the real
renderer at boot and put every byte straight back. Laziness at the feature boundary is what pays.

A dedupe experiment bounds the other half: collapsing the two copies with `resolve.dedupe` recovers
16,185 gz and only 56,250 of the roughly 130,000 minified duplicate bytes, so it is a partial
mitigation, not the fix. Not adopted; recorded here.

Verified on release `20260921T033620Z-f9a0815e-plugin-ui-subpaths`: the shared LSP tooltip still
renders its markdown parts, links and actions
(`/work/tmp/fregat-evidence/20260921T033638Z-scenario-editor-lsp-hover`). `lsp-plugin`'s 382 tests
and `plugin-ui`'s 10 pass.

Two leads fell out of the same graph and belong to Q2. `@shikijs/vscode-textmate` is reached from
boot through `state/bootstrap-runtime.ts` → `features/editor/state/color-theme-store.ts` →
`editor/dist/shiki/index.js` → `tokenizer.js` → `scopedTokens.js`: the main thread pulls the
tokenizer through the Shiki barrel even though tokenizing runs in a worker, which is the "import
wider than it needs to be" Q2 guessed at. It is not exclusive to that route, so Q2 still owes a
second path. `oniguruma-to-es` arrives somewhere else entirely, through
`features/command-palette/components/content.tsx`, and has nothing to do with the editor.

## What this plan does not do

- No Lexical removal. [Plan 111](111-editor-decorations.md) question 7 decides whether the composer
  can run on our editor; "Composer de-Lexical" is listed there as a plan of its own, not yet written.
- No `@base-ui/react` or `react-dom` replacement. `PLAN.md` already rejected the second, and the
  first is a product change.
- No bundler chunking configuration (109 D1).
- No grammar-chunk work. `tree-sitter-sql` at 1,176,809 gz is lazy and outside first load.
- No threshold of its own (D6).
