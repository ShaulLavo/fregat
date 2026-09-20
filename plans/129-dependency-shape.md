# Dependency shape: the bytes no loading boundary reaches

Status: Phase 1 implemented and deployed 2026-09-20, uncommitted in both checkouts; Phases 2 and 3
not started. Requested 2026-09-20. Planned against Platform
`b915d3e0` and Editor `21c17e8`, both with unrelated working changes present.

[Plan 109](109-boot-boundaries.md) measured the entry chunk per owner and found that its own
boundaries are worth at most 6.25% of it. The larger items are large because of how a dependency is
built, not because of when it is needed. 109 named them, measured them and handed them off (its D8,
Handoffs A and B) without an owner. This plan is that owner.

It covers the Editor's inline worker blobs, the unreachable `@phosphor-icons/react` weights, and a
costed look at what is left after both. It does not cover loading boundaries or the first-load gate
([Plan 109](109-boot-boundaries.md)), the instrument ([Plan 106](106-boot-weight.md)), the markdown
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

## What this plan does not do

- No Lexical removal. [Plan 111](111-editor-decorations.md) question 7 decides whether the composer
  can run on our editor; "Composer de-Lexical" is listed there as a plan of its own, not yet written.
- No `@base-ui/react` or `react-dom` replacement. `PLAN.md` already rejected the second, and the
  first is a product change.
- No bundler chunking configuration (109 D1).
- No grammar-chunk work. `tree-sitter-sql` at 1,176,809 gz is lazy and outside first load.
- No threshold of its own (D6).
