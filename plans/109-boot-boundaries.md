# Boot boundaries and a first-load gate

Status: proposed, implementation not started. Requested 2026-09-13, revised 2026-09-20 against the
first per-owner attribution of the entry chunk. Planned against Platform `b915d3e0`, with
substantial unrelated working changes present. [Plan 106](106-boot-weight.md) and
[Plan 107](107-workspace-markdown.md) are implemented; [Plan 108](108-markdown-modes.md) is not
started. The attribution this plan said it was waiting for now exists, it unblocks Phases 2 and 3,
and it refutes most of what the plan expected to land.

This plan covers where loading boundaries belong in `apps/web` and the gate that pins the result.
It does not cover the instrument that measures first load ([Plan 106](106-boot-weight.md) owns it),
the markdown stack that moves the number next ([Plan 108](108-markdown-modes.md)), first paint and
restoration ([Plan 085](085-instant-workspace-reload.md)), the browser-driving CLI
([Plan 119](119-agent-verification-tooling.md)), or the scoped error boundary and the
`<Activity>`/visibility rule it leans on
([Plan 127](127-compiler-and-lifetime-repairs.md), [Plan 128](128-react-19-patterns.md)).

Root `PLAN.md` owns scheduling. This plan owns its internal execution order and does not reorder
other work.

Priority: P1. Effort: M. Risk: medium, because a lazy chunk that 404s across a no-restart deploy
takes the workbench down with it.

[Plan 106](106-boot-weight.md) established that this is not a bundler problem:
[`vite.config.ts`](../apps/web/vite.config.ts) has no chunking configuration because **the
application declares almost no loading boundaries**. Rolldown emits one chunk because the module
graph is one graph. The 2026-09-20 build confirms it exactly — 484 chunks, and all 483 non-entry
chunks are vendor or data. Not one byte of `apps/web/src`, `packages/ui`, `packages/tree` or
`ghostty-webgpu` lives outside the entry chunk.

## The boundaries are a rounding error

The original plan wrote, on 2026-09-13:

> Which feature deserves a boundary is answerable from Plan 106's per-package attribution and from
> nothing else. Guessing produces `React.lazy` in places that cost a spinner and save nothing.

That was right, and the attribution proves it in the direction nobody expected. The two boundaries
that survive mechanism are worth **801,767 of the entry chunk's 12,825,502 rendered bytes, 6.25%**,
and that is the optimistic figure in which every byte behind them is exclusive. The linked Editor
packages are 3,806,168 rendered bytes (29.7%) and `node_modules` is 3,826,220 (29.8%). Together,
**59.5% of the entry chunk sits in two owners that no proposed loading boundary touches.**

The largest single item in first load is not a feature at all. Three Web Workers arrive as inline
JavaScript string literals and account for 1,726,771 raw bytes of the 7,528,676-byte entry script —
**579,386 gzip bytes, 25.5% of the first-load JavaScript** — downloaded and parsed whether or not
an editor is ever opened. The second-cheapest large item is 128,873 bytes of SVG path data for two
icon weights the repository cannot render. Neither is a loading boundary, neither is owned by this
plan, and both are larger than everything this plan can land.

## Why this is last

| Reason                 | State on 2026-09-20                                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The number is moving   | It moved, and then it moved back. Plan 106 landed 2425 → 2281 KB gz; Plan 107 landed 2292 → 2120 KB gz. This build reads 2213 KB gz of first-load JS by the instrument, 2217 KB by `gzip -9` on disk. First load grew roughly 95 KB gz in seven days with no plan owning the growth, and Plan 108 still has not run. |
| Boundaries follow data | Answered. The per-owner attribution exists (below), and it refuted two of the three boundaries anyone had proposed, on mechanism, before a line of `React.lazy` was written. That is what this row was for.                                                                                                          |
| A gate needs a floor   | Revised. The floor argument assumed the number was about to fall by a third. It fell, then rose unnoticed, which is the argument for a ratchet with a margin now rather than a perfect threshold later. See D6.                                                                                                      |

The original dependency statement — "It runs after [107](107-workspace-markdown.md) and
[108](108-markdown-modes.md) because both move the number, and a threshold pinned before them would
be re-pinned twice" — is half discharged. 107 landed. 108 has not, so Phase 4 pins twice by design
rather than waiting.

## What first load costs today

One production build of this checkout on 2026-09-20, emitted at `12:18:52Z`, measured two ways:

- **[stats]** is `apps/web/bundle-stats.json`, written by the build. Its `gzipSize` is `node:zlib`
  at level 9 ([`bundle-stats-plugin.ts:113`](../apps/web/scripts/bundle-stats-plugin.ts)). Its
  per-module `renderedLength` is post-treeshake and pre-minify, and its per-module gzip is a
  proportional model, not a measurement.
- **[disk]** is GNU `gzip -9` (1.14) over the emitted file in `apps/web/dist/`.

The two disagree by 3,925 bytes on the entry chunk, 0.17%. Vite's own build log prints a third,
higher reading because it compresses at level 6: the same entry chunk reads 2,275,407 there. Three
readings of one file within 0.4%. Pin one and never mix them. `KB` below means 1024 bytes, as in
Plans 106 and 107.

The release deployed 41 minutes later, `20260920T125946Z-b915d3e0`, built an entry chunk of
7,530,357 raw / 2,267,680 gz [stats] over 3,097 modules — 4,064 raw bytes and three modules more
than the tree measured here. Every figure below is therefore within 0.06% of the deployed artifact
and is not the deployed artifact.

### First load, measured

`index.html` names exactly three files. There is no vendor chunk, no route chunk, no lazy app chunk.

| File                                  | Kind          |     Raw bytes | Gzip-9 [disk] |
| ------------------------------------- | ------------- | ------------: | ------------: |
| `assets/index-Dw2nlyqc.js`            | entry script  |     7,528,676 |     2,270,002 |
| `assets/rolldown-runtime-hePW80VL.js` | modulepreload |           716 |           459 |
| `assets/index-DSU527xU.css`           | stylesheet    |       171,469 |        30,042 |
| **First load**                        |               | **7,700,861** | **2,300,503** |

First-load JavaScript alone is 2,270,461 bytes, 2217 KB gz [disk]; the instrument reads the entry
chunk 2,383 raw bytes smaller and 3,925 gzip bytes smaller, 2213 KB gz [stats].

Eight non-JS assets total 1,029,810 raw. `ghostty-vt-C8gTGUjq.wasm` (772,977 raw / 258,293 gz) is
**not** named in `index.html`, so it is outside the first-load set. When the runtime actually
fetches it was not traced.

### Entry chunk by top-level owner

[stats]. The entry chunk's modules sum to 12,825,502 rendered bytes against an emitted 7,526,293,
a global minify factor of 0.587. The gzip column applies the chunk's gzip proportionally, so it is
systematically wrong for modules that do not minify. The worker section below measures that error
at 1.87×.

| Owner                                               | Rendered bytes | % of entry | Gzip share (modelled) |   Modules |
| --------------------------------------------------- | -------------: | ---------: | --------------------: | --------: |
| `node_modules`                                      |      3,826,220 |     29.83% |               676,037 |     1,184 |
| Editor (linked, `/work/projects/Editor/packages/*`) |      3,806,168 |     29.68% |               672,494 |       267 |
| `apps/web/src/features`                             |      2,984,619 |     23.27% |               527,323 |     1,075 |
| `apps/web/src` outside `features/`                  |        618,748 |      4.82% |               109,338 |       221 |
| `packages/tree`                                     |        447,992 |      3.49% |                79,154 |        75 |
| `ghostty-webgpu`                                    |        443,345 |      3.46% |                78,333 |        47 |
| `packages/client-core`                              |        291,226 |      2.27% |                51,455 |        82 |
| `packages/contracts`                                |        221,524 |      1.73% |                39,140 |        59 |
| `packages/ui`                                       |        140,752 |      1.10% |                24,869 |        42 |
| `packages/markdown`                                 |         33,291 |      0.26% |                 5,882 |        26 |
| `packages/observability`                            |          5,912 |      0.05% |                 1,045 |         4 |
| `packages/utils`                                    |          2,330 |      0.02% |                   412 |         9 |
| virtual                                             |          3,375 |      0.03% |                   596 |         2 |
| **Total**                                           | **12,825,502** |            |         **2,266,077** | **3,094** |

`ghostty-webgpu` vendors its own `@tanstack/hotkeys`, 7,532 rendered bytes across three modules,
which the `node_modules` rule claims first. Counting every module under the ghostty checkout gives
450,877.

The module column sums to 3,093 against the chunk's 3,094. The unattributed one is
`apps/web/index.html`, which Rolldown records as a module of the entry chunk at 0 rendered bytes, so
it moves no byte total.

### `apps/web/src` by feature

[stats]. Every row is in the entry chunk.

| Owner                                              |      Rendered |  Gzip share |   Modules |
| -------------------------------------------------- | ------------: | ----------: | --------: |
| `features/chat`                                    |       705,213 |     124,601 |       244 |
| `features/editor`                                  |       528,899 |      93,449 |       132 |
| `features/settings`                                |       324,154 |      57,273 |       125 |
| `lib`                                              |       301,519 |      53,274 |       115 |
| `features/search`                                  |       253,913 |      44,863 |        73 |
| `features/workbench`                               |       220,270 |      38,918 |        91 |
| `features/workspace`                               |       206,724 |      36,525 |        69 |
| `features/chat-mode`                               |       201,863 |      35,666 |        93 |
| `features/git`                                     |       169,627 |      29,971 |        80 |
| `keymap`                                           |       114,758 |      20,276 |        38 |
| `state`                                            |        99,363 |      17,556 |        22 |
| `features/file-picker`                             |        98,899 |      17,474 |        47 |
| `features/command-palette`                         |        92,798 |      16,396 |        41 |
| `components`                                       |        86,742 |      15,326 |        28 |
| `features/address`                                 |        60,661 |      10,718 |        21 |
| `features/logs`                                    |        48,392 |       8,550 |        23 |
| `features/environments`                            |        38,938 |       6,880 |        15 |
| `features/terminal`                                |        34,268 |       6,055 |        21 |
| `hooks`                                            |         9,567 |       1,690 |         9 |
| `providers`                                        |         3,462 |         612 |         6 |
| `main.tsx`, `App.tsx`, `app-keymap-controller.tsx` |         3,337 |         589 |         3 |
| **Total**                                          | **3,603,367** | **636,662** | **1,296** |

`features/address` is 54 files and 8,460 lines on disk but 21 modules and 60,661 rendered bytes in
the bundle. Tree-shaking already removes most of it. It is neither a boundary candidate nor dead
code.

### Nothing first-party is outside the entry chunk

[stats], entry-chunk rendered bytes against whole-build rendered bytes.

| Owner            |  In entry | In whole build | Outside entry |
| ---------------- | --------: | -------------: | ------------: |
| `apps/web/src`   | 3,603,367 |      3,603,367 |         **0** |
| `packages/ui`    |   140,752 |        140,752 |         **0** |
| `packages/tree`  |   447,992 |        447,992 |         **0** |
| `ghostty-webgpu` |   450,877 |        450,877 |         **0** |

Non-entry chunks containing any first-party module: **0**.

`apps/web/src` contains exactly two runtime dynamic imports outside the Shiki language and theme
maps: [`features/chat/state/mermaid.ts:20`](../apps/web/src/features/chat/state/mermaid.ts) and
[`features/editor/utils/plugins.ts:110`](../apps/web/src/features/editor/utils/plugins.ts). Both
produce chunks. Everything else that looks like a dynamic import in a grep — `define-command.ts:82`
and `:86`, `use-dirty-tab-close.tsx:384`, `client-core/src/environments/utils/connection.ts:23` —
is `import('…').Type` in type position and emits nothing.

The build log carries one `[INEFFECTIVE_DYNAMIC_IMPORT]` warning
(`web-build.log:520`), for `Editor/packages/plugin-ui/dist/hoverPlugin.js`, dynamically imported by
`hoverToken.js` and statically imported by `index.js`. That is the failure mode to watch:
**writing `import()` is not declaring a boundary.** Every static import of the deferred module has
to go in the same pass, and the proof is a new chunk in the listing, not a new `import()` in the
diff.

### `node_modules`, top 20 in the entry chunk

[stats].

|   # | Package                     | Rendered | Gzip share | Modules |
| --: | --------------------------- | -------: | ---------: | ------: |
|   1 | `react-dom`                 |  536,999 |     94,880 |       4 |
|   2 | `@phosphor-icons/react`     |  477,197 |     84,314 |     270 |
|   3 | `@base-ui/react`            |  443,155 |     78,299 |     221 |
|   4 | `lexical`                   |  185,206 |     32,723 |       1 |
|   5 | `micromark-core-commonmark` |  125,498 |     22,174 |      44 |
|   6 | `evlog`                     |  119,891 |     21,183 |      20 |
|   7 | `@tanstack/router-core`     |  118,438 |     20,926 |      19 |
|   8 | `@dnd-kit/core`             |   85,231 |     15,059 |       1 |
|   9 | `@shikijs/vscode-textmate`  |   81,658 |     14,428 |       1 |
|  10 | `@tanstack/query-core`      |   73,354 |     12,961 |      19 |
|  11 | `mdast-util-to-markdown`    |   66,815 |     11,805 |      83 |
|  12 | `tailwind-merge`            |   58,189 |     10,281 |       1 |
|  13 | `sonner`                    |   53,463 |      9,446 |       1 |
|  14 | `oniguruma-to-es`           |   45,986 |      8,125 |       1 |
|  15 | `react-resizable-panels`    |   44,827 |      7,920 |       1 |
|  16 | `micromark`                 |   44,088 |      7,790 |      18 |
|  17 | `minimatch`                 |   41,118 |      7,265 |       6 |
|  18 | `@tanstack/virtual-core`    |   37,616 |      6,646 |       3 |
|  19 | `mdast-util-from-markdown`  |   36,956 |      6,530 |       2 |
|  20 | `@tanstack/react-router`    |   36,763 |      6,495 |      26 |

`@lexical/*` adds 98,897 rendered / ~17,470 gz across 18 modules, so the lexical cone is 284,103
rendered / ~50,193 gz, static, and reached from `features/chat` only — twelve non-test source
files, entered at
[`chat-input.tsx`](../apps/web/src/features/chat/components/chat-input.tsx). `@base-ui/react` has
14 importers, every one in `packages/ui/src/components/`, and none in `apps/web/src`;
`floating-ui-react/` is 138,058 of its bytes and is shared by menu, select, tooltip, popover and
context menu together, so dropping any one of them releases none of it.

### The three inline worker blobs

The largest single item in first load, and the instrument cannot see it.

[`/work/projects/Editor/scripts/build-package.ts`](../../Editor/scripts/build-package.ts) installs
a plugin, `inlineModuleWorkers` (line 174, with `inlineModuleWorkerImports` at line 227), that
rewrites every `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` into
`import W from './x.worker.ts?worker&inline'` (line 259). The published package ships each worker
as a JavaScript **string literal** behind a `createObjectURL(blob)` fallback. To this repo's Vite
build that literal is an ordinary module: unsplittable, and a minifier cannot shrink the inside of
a string. The same script sets `minify: false` (line 93), which is why the Editor's 3,806,168
rendered bytes arrive unminified.

| Worker                                | Source package                  | Chars in the entry chunk | Standalone gzip-9 |
| ------------------------------------- | ------------------------------- | -----------------------: | ----------------: |
| `src/shiki/shiki.worker.ts`           | `@singapore-editor/core`        |                  900,356 |           296,529 |
| `src/treeSitter/treeSitter.worker.ts` | `@singapore-editor/tree-sitter` |                  764,180 |           267,291 |
| `src/minimap.worker.ts`               | `@singapore-editor/minimap`     |                   61,720 |            13,742 |
| **Total**                             |                                 |            **1,726,256** |       **577,562** |

Measured by deleting the three literal assignments from the shipped file and re-gzipping, one pass
[disk]:

|                                  |             Raw bytes |        Gzip-9 bytes |
| -------------------------------- | --------------------: | ------------------: |
| Entry chunk as shipped           |             7,528,676 |           2,270,002 |
| Entry chunk without the literals |             5,801,905 |           1,690,616 |
| **Delta**                        | **1,726,771 (22.9%)** | **579,386 (25.5%)** |

**25.5% of the first-load JavaScript is three Web Workers.** The proportional model assigns the
three 309,027 gz against 579,386 measured, under-reporting them by 1.87× — and because gzip share
is apportioned across a fixed total, every other row in the owner table is correspondingly
overstated. The Editor's true share is higher than the 29.7% the table gives it. A fourth inline
worker exists in `@singapore-editor/typescript-lsp`, which `apps/web` does not depend on.

The Editor source is written the correct way. Only the package build rewrites it. This is not a
loading boundary and this plan does not own it (D8); it is recorded because it is larger than
everything this plan can land, and because the Phase 4 gate has to be able to show it when it moves.

### `@phosphor-icons/react` ships six weights and draws three

[Plan 106](106-boot-weight.md) Phase 3 removed the Phosphor icon **font**, `@phosphor-icons/web`,
from `packages/editor-find`. This is the React **component package**, a different dependency, and
it was not touched. Plan 106's own table says `@phosphor-icons/react` "tree-shakes correctly. It is
not implicated and does not change." That was right about icons and wrong about weights.

| Path                                 | Modules | Rendered bytes |
| ------------------------------------ | ------: | -------------: |
| `dist/defs/*.es.js`                  |     134 |        432,928 |
| `dist/csr/*.es.js`                   |     134 |         43,163 |
| `dist/lib/*` (`IconBase`, `context`) |       2 |          1,106 |

Icon-level tree-shaking already works: 134 definitions ship, against 138 distinct specifiers
imported across 196 files in `apps/web/src` and `packages/ui/src` (one is the `Icon` type, and
`Alarm` and `EnvelopeSimple` are imported but never reach the bundle). Every import is from the
package root; there are no subpath imports. The `apps/web` figure quoted during triage, 84 icons,
is wrong — the bundle and a specifier count over the source agree on roughly 134, not 84.

Opening a definition file confirms the shape. `dist/defs/GitBranch.es.js` is a
`new Map([["bold", …], ["duotone", …], ["fill", …], ["light", …], ["regular", …], ["thin", …]])`
carrying all six weights, and `dist/csr/GitBranch.es.js` hands the whole Map to `IconBase`, which
does `weights.get(weight ?? contextWeight)` at render. Tree-shaking cannot reach inside a `Map`
literal.

Measured over the 134 shipped definition files, 404,270 source bytes of which 391,540 are weight
blocks:

| Weight    |       Bytes | Share | Rendered by the app |
| --------- | ----------: | ----: | ------------------- |
| duotone   |      84,342 | 21.5% | yes, 18 call sites  |
| light     |      64,991 | 16.6% | **never**           |
| thin      |      63,882 | 16.3% | **never**           |
| regular   |      61,146 | 15.6% | yes, the default    |
| bold      |      60,995 | 15.6% | yes, 9 call sites   |
| fill      |      56,184 | 14.3% | yes, 6 call sites   |
| **Total** | **391,540** |       |                     |

33 explicit `weight='…'` call sites, no dynamic `weight={…}` prop anywhere, and zero
`IconContext` providers, so every other icon draws the library default. **128,873 bytes, 32.9% of
the weight data, is `thin` + `light`, which no call site in the repository can draw.** A
per-call-site prune cuts considerably more, because most of the 134 icons are used at exactly one
weight.

There is no subpath fix. The package's `exports` map offers `.`, `./dist/icons/*`, `./dist/csr/*`,
`./dist/lib/*`, `./lib`, `./ssr`, `./dist/ssr`, `./dist/ssr/*`, `./package.json` and a catch-all
`./*`, and every icon-shaped one resolves to `./dist/csr/*.es.js`, which pulls the whole Map.
Fixing it needs a build-time transform, generation from `@phosphor-icons/core` raw SVGs (not
installed), or a local icon module.

Directly measured for honesty: the 134 definitions concatenated gzip to **71,733 bytes**, so
Phosphor's real shipped weight is a little under the 84,314 the model assigns. SVG path data is the
whole cost and it does not compress well.

This is **Handoff A** below, not a phase of this plan (D8).

### The largest chunk in the build is not the entry chunk

Not first load, and recorded because it bears on the native-syntax coverage work now in flight.
`assets/tree-sitter-sql-oeIumqS_.js` is 14,754,667 raw / 1,176,809 gz [disk] — almost twice the
entry chunk raw — and `assets/tree-sitter-c_sharp-Cg89JkOE.js` is 7,134,167 raw / 539,137 gz. Both
are dynamic entries in the 66-chunk grammar group, so neither is downloaded before the first frame
and neither belongs to this plan. Adding a grammar adds a chunk of this size to the release and to
whatever fetches it on demand.

### What is already deferred

[stats]. 484 chunks: 1 entry, 417 dynamic entries, 66 shared. All 483 non-entry chunks are vendor
or data.

| Group                                                            |  Chunks |      Raw bytes |    Gzip bytes |
| ---------------------------------------------------------------- | ------: | -------------: | ------------: |
| tree-sitter grammars (`@singapore-editor/tree-sitter-languages`) |      66 |     40,788,331 |     3,954,209 |
| shiki languages (`@shikijs/langs/*`)                             |     244 |      7,988,078 |     1,342,636 |
| mermaid and the markdown cone behind it                          |      99 |      3,540,989 |       995,891 |
| shiki themes (`@shikijs/themes/*`)                               |      65 |      1,326,977 |       240,632 |
| `js.foresight`                                                   |       6 |         18,734 |         6,465 |
| `@singapore-editor/decode`                                       |       1 |         10,144 |         3,765 |
| `tabbable`                                                       |       1 |          7,008 |         2,747 |
| rolldown runtime (first load)                                    |       1 |            716 |           428 |
| **Total non-entry**                                              | **483** | **53,680,977** | **6,546,773** |

The mermaid cone is the only deliberate application-level split in the repository, and it is Plan
106 Phase 2's single `import()` in
[`features/chat/state/mermaid.ts:20`](../apps/web/src/features/chat/state/mermaid.ts). It keeps
roughly 1 MB gz out of first load. Zero `node_modules/mermaid` bytes reach the entry chunk; the
only mermaid-named modules there are our own three, 5,461 rendered bytes. Phase 3 copies this shape.

Plan 106's duplicate-version finding is now benign: the five remaining duplicate packages
(`layout-base`, `cose-base`, `d3-shape`, `d3-path`, `d3-array`) are all inside the mermaid cone, so
all lazy.

## The instrument

`bun run --cwd apps/web bundle:report` is the instrument of record —
[`apps/web/package.json`](../apps/web/package.json) maps it to `bun scripts/bundle-report.ts`,
which builds `dist` and then attributes. It writes `apps/web/bundle-stats.json` during that build.

That file is **untracked** ([`.gitignore:66`](../.gitignore)) and it is not a cache. The copy on
disk before this measurement was generated on 2026-09-13 and described an entry chunk of 7,194,858
raw / 2,161,887 gz: it would have answered questions about a build that no longer existed, with no
warning that it was doing so, and every denominator computed from it was 4.6% low on raw and 4.8%
low on gzip. It was replaced by the build. Any reading, and the Phase 4 gate, runs the command.
Nothing reads the file it finds lying there.

`--dir=<web dir>` skips the build and reports an existing one. That is the only supported way to
read a build you did not just make, and the report then has file totals but no per-package
attribution unless a matching `bundle-stats.json` sits beside it.

The instrument attributes to npm package or `app`, and nothing finer.
[`bundle-report.ts:246`](../apps/web/scripts/bundle-report.ts) falls everything that does not
resolve under a `node_modules/<name>` segment to `{ name: 'app', version: null }`, and line 277
maps the workspace name `web` to `app`. All 697 `.tsx` files in `apps/web/src` therefore collapse
into one row. The per-feature and per-owner tables above came from ad-hoc scripts over
`bundle-stats.json`; they are not yet a column the tool prints. Phase 4's failure message cannot be
written without that column, so Phase 2 adds it to Plan 106's reporter in place rather than
building a second instrument.

## Ownership

| File                                                                                                                                                  | Current behaviour                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web/src/features/workbench/components/terminal-tabs.tsx`](../apps/web/src/features/workbench/components/terminal-tabs.tsx)                     | Line 28 guards `panels.terminalTabs.length === 0` and returns an `EmptyState`. Lines 14–15 explain why inactive terminals are hidden with `invisible` + `inert`, not `display` or an unmount. |
| [`apps/web/src/features/terminal/components/panel.tsx`](../apps/web/src/features/terminal/components/panel.tsx)                                       | Owns the PTY socket and the ghostty instance in effects; cleanup detaches and disposes server-side. This is why `<Activity mode="hidden">` cannot be used here.                               |
| [`apps/web/src/keymap/providers/command-provider.tsx`](../apps/web/src/keymap/providers/command-provider.tsx)                                         | Line 25 statically imports `SettingsDialog` from `@/features/settings/components/dialog`; renders it at line 406.                                                                             |
| [`apps/web/src/features/workbench/components/editor-surface-tab-body.tsx`](../apps/web/src/features/workbench/components/editor-surface-tab-body.tsx) | Line 23 statically imports `SettingsPage` from `@/features/settings/components/page`; renders it at line 236. The second of settings' two entry points.                                       |
| [`apps/web/src/main.tsx`](../apps/web/src/main.tsx)                                                                                                   | Line 91 wraps the whole tree in `LoggingErrorBoundary`. It is the only boundary over the workbench; the one other in the app is scoped to a chat code block.                                  |
| [`apps/web/src/components/active-environment-application.tsx`](../apps/web/src/components/active-environment-application.tsx)                         | The always-mounted provider stack. `EditorColorThemeProvider` at line 29, `EditorStateProvider` at line 31, both above `children`.                                                            |
| [`apps/web/src/features/editor/providers/state-provider.tsx`](../apps/web/src/features/editor/providers/state-provider.tsx)                           | Line 15 imports `createPlatformFileOpenPreparer`, the head of the chain that anchors the worker packages.                                                                                     |
| [`apps/web/src/features/editor/state/syntax-highlighting.ts`](../apps/web/src/features/editor/state/syntax-highlighting.ts)                           | Lines 6 and 13 statically import `@singapore-editor/core/shiki` and `@singapore-editor/tree-sitter` — the two packages carrying the large inline workers.                                     |
| [`apps/web/src/lib/code-theme/utils/catalog.ts`](../apps/web/src/lib/code-theme/utils/catalog.ts)                                                     | Line 2 imports `VSCODE_THEMES` from `@singapore-editor/core/shiki`, a second static path to the same package from the theme provider.                                                         |
| [`apps/web/src/features/workspace/components/view.tsx`](../apps/web/src/features/workspace/components/view.tsx)                                       | Line 14 reads `uiMode` and branches to `ChatModeSurfaceView` or `EditorSurfaceLayoutView`. Both branches are static imports.                                                                  |
| [`apps/web/src/features/editor/state/workspace-state.tsx`](../apps/web/src/features/editor/state/workspace-state.tsx)                                 | Line 85 is `useStore(useEditorWorkspaceStoreApi(), selector)` — zustand 5 over `useSyncExternalStore`.                                                                                        |
| [`apps/web/scripts/bundle-report.ts`](../apps/web/scripts/bundle-report.ts)                                                                           | Builds, then attributes per package. Line 246 falls non-`node_modules` ids to `app`; line 277 renames `web` to `app`. No per-feature or per-linked-package column.                            |
| [`apps/web/scripts/bundle-stats-plugin.ts`](../apps/web/scripts/bundle-stats-plugin.ts)                                                               | Emits `bundle-stats.json` beside the build. `GZIP_LEVEL = 9` at line 113, through `node:zlib`.                                                                                                |
| [`apps/web/vite.config.ts`](../apps/web/vite.config.ts)                                                                                               | No `rollupOptions`, no `advancedChunks`. Chunk boundaries come only from `import()` in source.                                                                                                |
| [`/work/projects/Editor/scripts/build-package.ts`](../../Editor/scripts/build-package.ts)                                                             | `inlineModuleWorkers` at line 174 and `inlineModuleWorkerImports` at line 227 rewrite module workers to `?worker&inline` (line 259). `minify: false` at line 93.                              |
| [`scripts/lint/web-design-census.mjs`](../scripts/lint/web-design-census.mjs)                                                                         | The shape Phase 4's gate follows: one exported target table, `--check` setting `process.exitCode`, a `--json` form, and an allow file whose entries carry a reason.                           |

## What the attribution refutes

Two proposed boundaries died on mechanism before implementation. They are recorded as a negative
result so nobody proposes them again.

| Refuted candidate                                                                                                    | Why it does not work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The editor stack behind [`file-editor-body.tsx`](../apps/web/src/features/workbench/components/file-editor-body.tsx) | The heavy modules are anchored by the always-mounted root provider stack in `active-environment-application.tsx`, not by the editor surface. `EditorStateProvider` reaches `@singapore-editor/tree-sitter` through `state-provider.tsx:15` → `utils/prepared-document.ts:17` → `state/syntax-highlighting.ts:13`, and that same module imports `@singapore-editor/core/shiki` at line 6; `EditorColorThemeProvider` reaches `core/shiki` again through `lib/code-theme/utils/catalog.ts:2`. Those are precisely the two worker-bearing packages. The audit's reachability pass measured that cutting all seven candidate boundaries leaves 3,345,606 of the claimed 3,933,985 bytes statically reachable. That is a module-graph count, not a chunk measurement, and this report does not carry it; the shape of the result is what matters and the four import chains above were re-checked at `b915d3e0` and hold. |
| Splitting [`workspace/components/view.tsx`](../apps/web/src/features/workspace/components/view.tsx) by `uiMode`      | It fails twice over. The workbench branch statically requires the whole chat composer, so the two branches are not disjoint and splitting them releases nothing. Separately, `uiMode` is read at line 14 through `useEditorWorkspaceState`, a zustand context store on `useSyncExternalStore`, whose change path in React 19.3.0 is `forceStoreRerender` → `enqueueConcurrentRenderForLane(fiber, 2)` → `scheduleUpdateOnFiber(root, fiber, 2)` (`react-dom-client.development.js:8642`). Lane 2 is SyncLane, unconditionally. The toggle cannot be wrapped in a transition, so a Suspense fallback for a deferred branch would be a synchronous blank, not a deferred paint.                                                                                                                                                                                                                                        |

The general lesson is the one Plan 106 D6 stated in bundler terms and this plan restates in
application terms: **a boundary is only worth what is exclusively behind it.** A candidate whose
modules are also reached from an always-mounted provider saves nothing, and the module graph
answers that before any code is written.

## Decisions

| Decision                                                    | Proposed behavior                                                                                                                                                                                                                                            | Status after the 2026-09-20 attribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — boundaries live in source                              | Loading boundaries are dynamic `import()` at points where a feature is genuinely absent from the first frame. No `advancedChunks`, no manual chunk map: splitting a boot-path chunk into several boot-path chunks changes file count, not transferred bytes. | **Answered, unchanged and reinforced.** 483 of 484 chunks are already vendor data, so no chunk map would have produced an app boundary.                                                                                                                                                                                                                                                                                                                                                                                                              |
| D2 — "boot" is defined before it is optimized               | The first frame of an IDE is not the first frame of a website. This plan writes down what must be on screen before the workspace is usable — and therefore what may not be deferred — before deferring anything.                                             | **Still open.** Byte attribution cannot say whether the Problems panel belongs at first usable frame. Phase 1 stands as written.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3 — a boundary must pay for itself                         | A candidate ships only if Plan 106's report shows a measured first-load reduction and the deferred load does not become visible as a stall in an interaction the user is already waiting on.                                                                 | **Half answered.** The byte half is now computable per feature. The stall half is a browser observation and stays open; the dev server is down, so nothing has been observed.                                                                                                                                                                                                                                                                                                                                                                        |
| D4 — deferred does not mean slow                            | Anything moved behind a boundary is prefetched on a real signal — hover, focus, an open panel — not left to fault in on click. A boundary that turns an instant panel into a spinner has made the app worse.                                                 | **Still open, now concrete.** The terminal boundary prefetches on the Terminal tab's own hover, not on click.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D5 — every deferred state uses a real loader                | Per [AGENTS.md § Loading And Empty States](../AGENTS.md#loading-and-empty-states), a pending boundary renders one of the five primitives, branching on pending before empty. A new boundary is a new chance to ship a bare "Loading…".                       | **Still open, unchanged.** No boundary has shipped, so nothing has been checked against it.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D6 — the gate is a ratchet, not a target                    | The gate pins the achieved number plus a small margin and fails a regression. It does not encode an aspiration. It lands only after the number stops moving.                                                                                                 | **Answered and revised.** The final clause is withdrawn. The number stopped falling and rose roughly 95 KB gz in seven days unobserved. A ratchet needs a current number, not a final one: pin after Phase 3, re-pin after Plan 108 lands, record both.                                                                                                                                                                                                                                                                                              |
| D7 — a boundary carries its own error boundary              | Every new lazy boundary is wrapped in a scoped error boundary that renders a retry in place, not a blank tree.                                                                                                                                               | **New.** `bun run deploy` swaps the `current` symlink under live sessions with no restart, so a page held open across a release requests a hashed chunk the new release does not serve. `main.tsx:91`'s `LoggingErrorBoundary` is the only boundary over the workbench tree, so an unhandled chunk 404 blanks the whole workbench including the live terminal and agent sessions the no-restart deploy exists to preserve. Coordinate with [Plan 127](127-compiler-and-lifetime-repairs.md); the scoped boundary is written once, wherever it lands. |
| D8 — dependency shape is not a loading boundary             | Bytes that are large because of how a dependency is built, not because of when it is needed, are named, measured and handed to the owner of that dependency. This plan does not defer them and does not rewrite them.                                        | **New.** Covers the three inline worker blobs (579,386 gz, Editor `scripts/build-package.ts`) and `@phosphor-icons/react`'s six-weight definitions (128,873 bytes of unreachable `thin`/`light`). Both are larger than anything this plan lands. See Handoffs A and B.                                                                                                                                                                                                                                                                               |
| D9 — an `import()` beside a static import is not a boundary | A candidate is complete only when no static import of the deferred module remains and the build listing shows a new chunk.                                                                                                                                   | **New.** The build carries a live example: `Editor/packages/plugin-ui/dist/hoverPlugin.js` is dynamically imported and statically imported, and Rolldown says so in `[INEFFECTIVE_DYNAMIC_IMPORT]`.                                                                                                                                                                                                                                                                                                                                                  |

## Phase 1 — define boot

No code. This phase produces the sentence everything else is measured against.

1. Write down what is on screen at first usable frame: which panes, which of them can be empty
   shells, and which must hold real content. The
   [instant workspace reload](085-instant-workspace-reload.md) plan already owns first-paint
   restoration and its conclusions are inputs here, not competitors.
2. Classify every top-level feature against that definition: required at boot, required on first
   interaction, or genuinely on demand. The per-feature table above supplies the cost column; this
   step supplies the necessity column.
3. Record which classifications are contested. A contested one is a product decision, not a
   bundling decision.

Verification: a written definition of boot and a classification table covering every feature
directory in the per-feature table, with no row left unclassified. Nothing in this phase is
measurable in a browser and nothing in it should be claimed as measured.

## Phase 2 — candidates, from the report

1. **Teach the instrument per-owner attribution.** Add a column to
   [`bundle-report.ts`](../apps/web/scripts/bundle-report.ts) that folds a module under
   `apps/web/src` to its feature directory and a module under a workspace or linked package to that
   package, instead of collapsing all of it to `app` (lines 246 and 277). The tables in this
   document are the expected output; if the column does not reproduce them, the column is wrong.
   Follow [`scripts/web-layering.test.ts`](../scripts/web-layering.test.ts)'s shape for the test:
   fixture files, exact JSON, including a case that must not be misattributed.
2. **Intersect with Phase 1.** The candidate list is the "not required at boot" set intersected
   with the per-owner table. Nothing outside it is considered.
3. **Discard on mechanism before measuring.** For each candidate, check whether its heavy modules
   are also reached from an always-mounted provider, a module registry or a static sibling import.
   Two candidates already died this way; a third would have cost a week.
4. **Estimate before implementing.** Predicted saving is read off the report first. A candidate
   whose prediction is under the cost of the code is dropped with the number recorded.

Two candidates survive today.

| Candidate          | Entry point                                                                                                                                                                                                                                                                                                | What the report says                                                                                                                                                               | What must be measured                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The terminal panel | [`terminal-tabs.tsx:28`](../apps/web/src/features/workbench/components/terminal-tabs.tsx) already guards on `panels.terminalTabs.length === 0` and returns an `EmptyState`, so the boundary point exists and needs no new condition                                                                        | `ghostty-webgpu` 443,345 rendered in the entry chunk (450,877 counting its vendored `@tanstack/hotkeys`), `features/terminal` a further 34,268 — 3.72% of the entry chunk together | How much of that is exclusive once `TerminalPanel` is behind `lazy()`, and whether `ghostty-vt-C8gTGUjq.wasm` follows it out of the boot path                                                                      |
| Settings           | Two: [`command-provider.tsx:25`](../apps/web/src/keymap/providers/command-provider.tsx) imports `SettingsDialog`, and [`editor-surface-tab-body.tsx:23`](../apps/web/src/features/workbench/components/editor-surface-tab-body.tsx) imports `SettingsPage`. Point both at one module so they share a chunk | `features/settings` 324,154 rendered / ~57,273 gz modelled across 125 modules, 2.53% of the entry chunk                                                                            | The audit predicted roughly 131,000 raw bytes exclusive. **This report does not establish that figure.** Phase 3 measures it by cutting the boundary and re-running the command, and records the miss if it misses |

Verification: `bun run --cwd apps/web bundle:report` prints per-owner rows that reproduce the
tables in this document; the reporter's new test passes; the candidate list is ranked and costed,
and the drop list names the mechanism that dropped each entry.

## Phase 3 — land the boundaries

1. **Error boundary first (D7).** Before any `lazy()` ships, a scoped boundary renders a retry in
   place of the failed subtree. Prove it against the real failure: deploy, hold a page open, deploy
   again, and confirm the stale chunk request degrades to a retry inside the panel with the
   terminal still running, rather than a blank workbench. Errors come from the feature's
   `structured-errors.ts` per [AGENTS.md § Logs](../AGENTS.md#logs), never `new Error`. If
   [Plan 127](127-compiler-and-lifetime-repairs.md) lands the scoped boundary first, consume it;
   do not write a second one.
2. **Terminal.** `TerminalPanel` loads behind `terminal-tabs.tsx`'s existing zero-tab guard. The
   panel's own visibility model does not change: hidden terminals stay `invisible` + `inert`, because
   a remount replays scrollback. The comment at lines 14–15 of that file gives a second reason, a
   `display:none` host measuring 0×0, which [Plan 128](128-react-19-patterns.md) found ghostty
   already guards against; the first reason is enough on its own. Do not reach for
   `<Activity mode="hidden">` here — it destroys
   effects, and the PTY socket and ghostty instance live in an effect
   ([`features/terminal/components/panel.tsx`](../apps/web/src/features/terminal/components/panel.tsx)
   cleanup → detach → server-side dispose). [Plan 128](128-react-19-patterns.md) owns the
   `<Activity>` rule; this is the counter-example it should carry.
3. **Settings.** Both entry points import one lazily-loaded module so the dialog and the tab body
   share a chunk. The dialog's pending state is `LoadingState`, whose own 120 ms delay does the
   work; no second conditional (D5).
4. **Prefetch on a real signal (D4).** Terminal prefetches on hover of the Terminal tab in the
   bottom panel bar; settings prefetches when the command palette surfaces its command or the tab
   is about to open.
5. **Prove each chunk exists (D9).** After each boundary, the build listing shows a new non-entry
   chunk containing first-party modules — today that count is zero — and no
   `[INEFFECTIVE_DYNAMIC_IMPORT]` warning names it.
6. **Record the miss.** Drop any candidate whose measured saving materially misses its prediction,
   and record why the prediction was wrong. A wrong prediction is information about the report.

Verification: `bun run --cwd apps/web bundle:report` before and after each boundary, with the
first-load total and the per-owner rows from both runs; the build listing shows a non-entry chunk
holding first-party modules; `grep INEFFECTIVE_DYNAMIC_IMPORT` over the build log names nothing
new. In the browser, once a dev server is running:
`bun run agent:browser look` on the terminal panel and on settings, and
`bun run agent:browser trace <scenario> --compare <baseline>` for each deferred interaction, with
evidence in `/work/tmp/fregat-evidence/plan109-<yyyymmdd>/`. The retry path is proven against a
real release swap, not a simulated 404.

## Phase 4 — the gate

1. **Pin now, re-pin after 108 (D6).** Pin the first-load gzip total achieved by Phase 3 plus a
   margin, from `bundle:report --json`. Record the reading's source ([stats] or [disk]) in the same
   file, because the two differ by 3,925 gzip bytes on the entry chunk and Vite's own log prints a
   third figure at a different compression level. A gate that silently switches readings is noise.
2. **Pin per owner, not only the total.** The gate stores a row per owner from Phase 2's column.
   The failure message names the owners whose contribution grew: a gate that says
   "2.4 MB > 2.3 MB" sends the next person back to the report by hand, and this plan exists partly
   because roughly 95 KB gz arrived over a week with nobody able to name it.
3. **Run the command, never the file.** The gate builds. It does not read whatever
   `bundle-stats.json` happens to be on disk, which was a week stale and 4.6% low the last time
   anyone looked. `--dir` is for reporting a build you just made, not for reading a cache.
4. **Wire it into `verify` and CI.** Follow the design census's shape in
   [`scripts/lint/web-design-census.mjs`](../scripts/lint/web-design-census.mjs): one exported
   target table, a `--check` flag that sets `process.exitCode`, a `--json` form, and an allow file
   whose entries carry a real reason. A bundle gate is ratio-free and deterministic, so unlike
   `bench:editor-open:gate` it can run on a shared CI runner; say so in the step's comment, next to
   the existing note explaining why the other benchmarks cannot.
5. **Correct the lane headline.** `PLAN.md:344` still quotes 2421 KB gz as the deployed first-load
   number and `PLAN.md:376` repeats it. Replace both with the gated number in the same pass, so the
   roadmap and the gate cannot disagree.

Verification: a deliberate regression — add a static import of a deferred package — fails CI and
the failure message names the owner that grew; reverting it passes. The gate's own run is the
`bundle:report` build, not a cached file, and that is checked by deleting `bundle-stats.json`
before the gate runs and confirming it still produces a reading.

## Handoffs

These are D8 items: real bytes, measured here, owned elsewhere. Neither carries a chunk boundary,
a Suspense fallback, an error boundary or deploy-swap risk, so neither is blocked by Phases 1–4 and
neither may be folded into them.

**Handoff A — `@phosphor-icons/react` weights.** 477,197 rendered bytes in the entry chunk, of
which 128,873 is `thin` + `light` path data that no call site in the repository can render. There
is no per-weight subpath export, so the fix is a build-time transform, generation from
`@phosphor-icons/core`, or a local icon module that imports only the weights in use. This is a
dependency-shape change with no runtime loading behaviour attached, and it is the cheapest large
win in the bundle. It is **not** the Phosphor icon font: Plan 106 Phase 3 removed
`@phosphor-icons/web` from `packages/editor-find`, which is a different dependency and is already
gone.

**Handoff B — the Editor's inline module workers.** 579,386 gzip bytes of first load, 25.5% of the
first-load JavaScript, produced by `inlineModuleWorkers` in
[`/work/projects/Editor/scripts/build-package.ts`](../../Editor/scripts/build-package.ts). The fix
belongs to the Editor checkout that owns that script. Phase 4's per-owner gate will show it the day
it lands.

## Evidence and limits

- **No before/after measurement in a browser has been taken, and this plan claims none.** The dev
  server is down: ports 5173 and 3001 are closed, and only the mesh on 3301 answers, serving
  release `20260920T125946Z-b915d3e0` with 78 dirty files over a server bundle from
  `20260920T125500Z-02885149`. Every `bun run agent:browser renders|trace|look|scenario` line in
  this document is a prescription for whoever implements it, never evidence that something was
  observed.
- Every byte figure comes from one production build of this checkout on 2026-09-20 at `12:18:52Z`,
  cross-checked against the release built 41 minutes later at `b915d3e0` (4,064 raw bytes and three
  modules apart in the entry chunk). It is one build on one machine, not a distribution.
- The working tree carries substantial unrelated in-flight work — orchestration, chat, chat-mode,
  `packages/contracts`, Plan 126 — so the measured tree is `b915d3e0` plus those changes, not a
  clean checkout.
- `renderedLength` is post-treeshake and pre-minify, and the gzip column is that proportion applied
  to the chunk total. It is measurably wrong by 1.87× on the inline worker literals. Treat every
  modelled gzip figure as a ranking, not a budget, and treat the direct [disk] measurements as the
  only byte claims.
- Because gzip share is apportioned across a fixed total, the 1.87× understatement of the workers
  means every other owner row is proportionally overstated. The Editor's true share is higher than
  the 29.7% in the table, and the two surviving boundaries' 6.25% is an overstatement, not an
  understatement.
- The settings boundary's expected saving is not established. The ~131,000 raw bytes figure is an
  audit prediction carried forward for Phase 3 to confirm or refute.
- The editor-stack refutation's 3,345,606-of-3,933,985 reachability figure is a module-graph count
  from the audit, not a measurement in this report. The four import chains it rests on were
  re-checked at `b915d3e0` and hold; the byte total was not recomputed.
- The Phosphor weight table is a byte count over the 134 shipped definition files on disk, not over
  their post-minify form in the chunk. It establishes that `thin` and `light` are unreachable from
  any call site in `apps/web/src` or `packages/ui/src`; it does not establish what a prune would
  save after minification and gzip, which is bounded above by the 71,733 bytes the definitions gzip
  to in total.
- Not measured and not estimated: when the runtime fetches `ghostty-vt-C8gTGUjq.wasm`; the
  post-minify share of any individual non-worker module; whether any of the 244 shiki-language
  dynamic imports fire at boot; and whether either surviving boundary is perceptible as a stall.

## Verification boundaries

- Every claimed reduction comes from `bun run --cwd apps/web bundle:report`, run against a real
  production build, before and after. The command builds; a stale `bundle-stats.json` is not
  evidence of anything.
- A boundary is proven by a new non-entry chunk containing first-party modules, not by the presence
  of an `import()` (D9).
- Each boundary is checked in the browser for the interaction it defers, with
  [Plan 119](119-agent-verification-tooling.md)'s CLI, against a running dev server. There is no
  dev server today; a report that cannot run these says so rather than substituting a build number.
- The retry path is proven against a real release swap, not a simulated 404: deploy, hold a page,
  deploy again, and confirm the terminal survives.
- The gate is proven by a deliberate regression — add a static import of a deferred package,
  confirm CI fails and names the owner, revert.
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No bundler configuration (D1).
- No second instrument. Phase 2 adds a per-owner column to Plan 106's reporter in place; Plan 106
  still owns it. This narrows, and does not contradict, the original "no re-measurement
  infrastructure".
- No change to the Editor's `?worker&inline` package build (Handoff B, D8).
- No `@phosphor-icons/react` weight prune (Handoff A, D8). Plan 106 removed the icon font, which is
  a different dependency.
- No `@base-ui/react` or `lexical` removal. Both are static and both have a single importer cone,
  but replacing a UI primitive library or a chat composer is a product change, not a loading
  boundary.
- No editor-stack or `uiMode` boundary. Both are refuted above; re-proposing one needs new evidence
  about the provider stack, not a new estimate.
- No `<Activity>` adoption. Hidden Activity preserves state and destroys effects, so a pane whose
  resource lives in an effect — the PTY socket, the file tree controller's timer, the editor's
  scheduled dispose — cannot take it. That is the whole disqualification for the terminal:
  [Plan 128](128-react-19-patterns.md), which owns the rule, read ghostty's fit path and found that a
  zero-size measurement under `display: none` is discarded rather than reflowed to, so measurement is
  not a second reason here.
- No grammar-chunk work. `tree-sitter-sql` at 14,754,667 raw bytes is the largest chunk in the
  build and it is lazy; it belongs to the native-syntax coverage work, not to first load.
- No first-paint or restoration work. Plan 085 owns that.
- No performance work beyond transferred bytes. Render throughput is a separate question with its
  own benchmarks.
