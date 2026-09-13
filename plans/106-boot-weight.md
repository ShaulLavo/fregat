# First-load weight: the instrument, mermaid, and the icon font

Status: proposed, implementation not started. Requested 2026-09-13.

The production web build sends **2421 KB gzip of JavaScript before the first frame**, 2311 KB of it in a single chunk. Nothing in this repository reports that number, so every claim about what is inside that chunk — including the ones that motivated this plan — is a guess read off a file listing. This plan builds the instrument first, then lands the two boot-path removals that depend on no other decision.

It is deliberately small. The duplicate Shiki install belongs to [Plan 107](107-workspace-markdown.md) because `@streamdown/code` is what drags it in; real loading boundaries and a size gate belong to [Plan 109](109-boot-boundaries.md), after 107 and 108 have already moved the number. [Root PLAN.md](../PLAN.md) owns scheduling.

## What first load costs today

Measured on release `/work/platform-production/current-web`, 2026-09-13.

| Piece               | Current state                                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-load JS       | 2421 KB gz across the 18 files `index.html` names. `index-CIPLciZw.js` alone is 7.5 MB raw / **2311 KB gz** — 95% of it.                                                                                                                                                                              |
| Chunk count         | 552 JavaScript chunks, 29.4 MB raw. The whole release directory is 37 MB.                                                                                                                                                                                                                             |
| CSS                 | `index-*.css`, 240 KB raw / 43 KB gz.                                                                                                                                                                                                                                                                 |
| Bundler             | Vite 8 on Rolldown 1.2.8. The build already emits `rolldown-runtime-*.js`. Nothing to migrate.                                                                                                                                                                                                        |
| Chunking config     | [`vite.config.ts`](../apps/web/vite.config.ts) has no `rollupOptions` and no `advancedChunks`. Chunk boundaries come only from dynamic `import()` in source, and outside the Shiki language map there are almost none.                                                                                |
| Mermaid             | [`assistant-markdown.tsx:5`](../apps/web/src/features/chat/components/assistant-markdown.tsx) imports `@streamdown/mermaid` statically. Mermaid's core lands in the entry chunk, `rough.esm-*.js` (8.6 KB gz) is in the `<head>` modulepreload list, and `cytoscape.esm-*.js` is a top-ten asset.     |
| Phosphor icon font  | [`packages/editor-find/src/style.css:1`](../packages/editor-find/src/style.css) is `@import '@phosphor-icons/web/regular'` — the complete regular icon font. 144 KB woff2 transferred, plus 477 KB woff, 477 KB ttf and 2926 KB svg emitted into every release and never fetched by a modern browser. |
| Phosphor components | `@phosphor-icons/react` is imported by 163 files and tree-shakes correctly. It is not implicated and does not change.                                                                                                                                                                                 |
| Attribution         | None. There is no per-package size report, no first-load total, and no record of either in CI or `verify`.                                                                                                                                                                                            |

## Decisions

| Decision                                       | Proposed behavior                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — the instrument comes first                | Phase 1 lands before any removal, so Phases 2 and 3 report a real delta instead of an assertion. Per [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work), an optimization without a measurement is a guess.                                          |
| D2 — attribution is per-package, not per-chunk | The report answers "which dependency costs what," summed across chunks. A per-chunk listing cannot tell Mermaid apart from Katex when both live in `index-*.js`.                                                                                                            |
| D3 — first-load is the headline number         | The reported total is the transitive closure of the entry and its `modulepreload` links, gzipped — what a cold browser downloads before the first frame. Total build size is recorded but is not the metric.                                                                |
| D4 — mermaid is deferred, not removed          | Diagrams keep working. The plugin loads on the first mermaid fence. Following [t3code#9621](https://github.com/pingdotgg/t3code/pull/9621), a fence renders as a diagram only once it is no longer streaming; until then it stays a code block.                             |
| D5 — the icon font leaves, the icons stay      | The eleven find-widget glyphs become inline path data, as [`fold-icon.ts`](../apps/web/src/features/editor/utils/fold-icon.ts) already does. Its comment states the reason: path data keeps the icon library off the editor boot path.                                      |
| D6 — no bundler configuration                  | No `advancedChunks`, no manual chunk map. Rolldown reports the module graph faithfully; splitting a boot-path chunk into several boot-path chunks changes file count, not transferred bytes. Boundaries are declared in source or not at all.                               |
| D7 — no gate yet                               | The number still has 107 and 108 ahead of it. A threshold pinned now would be re-pinned twice. Phase 1 emits and prints the number; Plan 109 pins it.                                                                                                                       |
| D8 — the duplicate Shiki is named, not fixed   | `@streamdown/code@1.1.1` hard-depends on `shiki@^3.19.0`, resolving to a complete second install at 3.23.0 alongside the editor's 4.4.3 (`bun.lock:951`, `bun.lock:2493`). Phase 1's report must show it. Removing it is Plan 107's, since it dies with `@streamdown/code`. |

## Phase 1 — the instrument

1. **Stats emission.** A Vite plugin under `apps/web/scripts/` uses the `generateBundle` hook to write `bundle-stats.json` beside the build: for every emitted chunk, its file name, raw size, gzipped size, and each contributing module with its `renderedLength`. Sizes come from `node:zlib`, not from an estimate.
2. **First-load closure.** A reporter parses the emitted `index.html`, collects the entry script and every `modulepreload` href, and sums their gzipped sizes. That total is the headline number. It must reproduce 2421 KB against the current release before it is trusted — calibrate the instrument on a known reading per [AGENTS.md § Debugging](../AGENTS.md#debugging).
3. **Package attribution.** Modules are folded to their owning package by resolving the `node_modules/<name>` or `node_modules/@scope/name` segment of their id, workspace packages to their workspace name, and everything else to `app`. Output is a table sorted by first-load gzip contribution, with a second column for total build contribution.
4. **Duplicate detection.** The report flags any package name resolved at more than one version and any chunk basename emitted more than once. Today that must report `shiki` at 4.4.3 and 3.23.0, and 123 duplicated chunk basenames — `typescript-BydbNFcO.js` and `typescript-CkrWeWcv.js` are both exactly 181,146 bytes. If the report does not show this, the report is wrong.
5. **One command.** `bun run --cwd apps/web bundle:report` builds and prints the table. A `--json` flag writes the machine-readable form for Plan 109 to gate on later.

Completion: the command prints a first-load gzip total matching the deployed release, a per-package table whose top rows can be checked by hand against the chunk listing, and the Shiki duplication as a named finding.

## Phase 2 — mermaid off the boot path

1. **Defer the plugin.** `assistant-markdown.tsx` stops importing `@streamdown/mermaid` at module scope. The plugin object is loaded on demand and memoized per module, not per component.
2. **Load on demand.** The markdown pipeline detects a mermaid fence and triggers the load; until it resolves, the fence renders through the existing `AssistantMarkdownCodeBlock` path, which already handles every other language. A failed load leaves the code block in place and logs one wide event, never an empty box.
3. **Do not render mid-stream.** A mermaid fence renders as a diagram only when its message is no longer streaming (D4). A half-written graph definition is not a diagram and must not be handed to the library.
4. **Confirm the removal.** `rough.esm-*.js` and `cytoscape.esm-*.js` leave the `modulepreload` list, and the Phase 1 report shows `mermaid` at zero first-load contribution.

Completion: a chat with no diagrams downloads no mermaid; a chat with one renders it after the message settles; the reported first-load total drops by the measured amount.

## Phase 3 — the icon font

1. **Inline the glyphs.** The eleven entries of `FIND_ICONS` in [`findWidget.ts`](../packages/editor-find/src/findWidget.ts) — `text-a-underline`, `x`, `caret-down`, `text-aa`, `caret-up`, `asterisk`, `swap`, `arrows-clockwise`, `caret-right`, `selection`, `textbox` — become inline SVG path data in a module beside the widget, in the shape `fold-icon.ts` already uses.
2. **Replace the construction.** `createPhosphorIcon` builds an `<svg>` from that data instead of setting `className = 'ph ph-<icon>'`. The widget is plain DOM, so this is element construction, not a React change.
3. **Delete the import.** `@import '@phosphor-icons/web/regular'` leaves `style.css`, and `@phosphor-icons/web` leaves the dependency list once nothing else references it.
4. **Confirm.** No `Phosphor-*.woff2`, `.woff`, `.ttf` or `.svg` is emitted; the CSS drops its `@font-face`; the find widget renders identically in light and dark at both densities.

Completion: 144 KB of font transfer and 3.9 MB of dead font formats leave every release, with no visual change to the find widget.

## Verification boundaries

- Phase 1 is verified against the currently deployed release before anything is removed. A reporter that cannot reproduce today's 2421 KB is not yet an instrument.
- Phases 2 and 3 each record a before and after first-load number from Phase 1's command. A phase that cannot show its delta is not complete.
- Mermaid behavior is proven in the browser project: a fence that is streaming stays a code block, the same fence renders after the stream ends, and a forced load failure leaves the code block visible.
- The find widget keeps its existing coverage; icon rendering is asserted on the produced element, not on a class name.
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No duplicate-Shiki removal. `@streamdown/code` owns it and dies in Plan 107 (D8).
- No streamdown replacement, no `@workspace/markdown` package. That is Plan 107.
- No editor markdown changes. That is Plan 108.
- No route or feature loading boundaries, and no size gate. Those are Plan 109, after 107 and 108 have moved the number (D7).
- No language prefetch change. The editor preloads all 53 grammars and every theme after first paint; narrowing that needs a workspace language census and belongs to Plan 110.
- No bundler migration. Rolldown is already in use.
- No change to `@phosphor-icons/react`, which tree-shakes correctly across 163 files.
