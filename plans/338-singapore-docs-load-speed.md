# Plan 338: Faster Singapore docs in the editor

## Status and ownership

- Status: Approved. Owner request, 2026-10-08, after choosing the docs-in-editor prototype and observing that it is "slightly slow".
- Parent: [Plan 336](336-packages-as-products.md), Singapore docs implementation.
- Order: measure the chosen prototype now. Apply the low-cost load changes while Plan 336 moves the prototype into `editor/site`. Shared editor changes follow a measured site need and their package tests.
- Deliverable here: one plan-only PR. Implementation follows the phases below.

## Outcome

Readers get the complete static guide immediately. The real Singapore editor takes over in place with the same visible text, colours, wrapping and scroll position. Reduce the work needed to reach that state, especially on slower CPUs and cold mobile connections. Keep the whole guide usable when JavaScript, a worker or a grammar fails.

The owner chose the real editor. This plan preserves that choice. An earlier "ready" timestamp is useful only when the visible guide, links and editor input actually work.

## Scope and constraints

Work covers the hand-written Markdown guides, their prerenderer, the editor entry and its grammar/worker startup. Generated API reference remains static under Plan 336. Preserve the prototype's phone/touch policy, static by default with an explicit editor action, and measure forced takeover on phones. Accessibility and visual parity remain release gates owned with Plan 336. A speed improvement must preserve the accessible article until the editor has a verified reading order and heading structure.

Keep sources and tests portable. The local prototype and evidence paths below identify experiments; implementation must bring the relevant scripts into the repository with checkout-relative inputs. Do not create a permanent hosting route, new tuning setting, service worker or alternate editor engine for this work. No package-wide redesign is required by this plan.

## Current evidence

### Original prototype baseline

The retained prototype is `/work/reports/plan-336/designs/singapore/docs-in-editor/`. Read `NOTES.md`, `_src/docs.ts`, `site.js`, `_src/verify.mjs` and `shots/measurements.json`. Its editor build came from `prototype/singapore-real-embed` at `ca180036`.

These are experiments from 2026-10-08 on an Intel i7-14700K, Linux 7.2.8, headless Chromium 153.0.8010.12. The server used local HTTP without compression; gzip sizes came from zlib level 9. Cold-cache median of five runs:

| Observation | Baseline |
| --- | --- |
| Static first load | 42,376 bytes gzip, about 42 KB |
| First contentful paint | 44 ms |
| Total files through takeover | 862,046 bytes gzip, about 862 KB |
| Editor takeover | 249 ms, 418 ms with 4x CPU throttling |
| Preview readiness after mount | 145 ms |
| Largest compressed files | Editor entry 271 KB, shell grammar 185 KB, TypeScript grammar 139 KB, Tree-sitter runtime 93 KB, two Markdown grammars 85 KB, worker 39 KB |

Reading already precedes takeover. The remaining problem is how much code, initialization and analysis precede interaction.

### Quick profile of the chosen prototype

A fresh experiment ran the same built prototype on 2026-10-08. Evidence is `/work/reports/plan-336/measurements/singapore-load-20261008/`, containing `profile.mjs`, `profile.json`, `trace-1x.json` and `trace-4x.json`.

Method: Playwright 1.63.0, Chromium 153.0.8010.12, the same CPU and kernel, headless 1280 x 900, Quick start, `?editor=on`, fresh browser context per run, five runs at 1x and five at 4x CPU. A local server bound `127.0.0.1:5849` and stopped in `finally`. It served the unchanged build with extra timestamps added to `site.js` in memory. HTTP caching and compression were off. Trace collection ran only in the first repetition of each rate. The host was scheduled through its browser-job wrapper, without a quiet-machine qualification. Treat this as diagnostic evidence, not a public speed claim.

| Stage, median milliseconds | 1x CPU | 4x CPU |
| --- | ---: | ---: |
| `site.js` start to idle callback beginning takeover | 27.5 | 56.9 |
| Dynamic import, Markdown/font wait and subsequent CSS load | 27.7 | 49.4 |
| Synchronous editor mount, document adoption and caret setup | 29.1 | 112.0 |
| `ready()` wait for syntax, preview markers and two animation frames | 124.7 | 162.8 |
| Scroll restoration and final frame before swap completes | 16.8 | 19.3 |
| Navigation to completed takeover | 232.6 | 428.7 |

Total navigation-to-takeover ranges were 229.5–268.5 ms at 1x and 401.8–449.0 ms at 4x. Stage medians are independent and do not add exactly to the total. The total also includes navigation to `site.js` and small gaps between marks. The prototype's original `takeoverMs` clock starts in `site.js`, so keep that clock and the navigation clock separate in future reports.

The traced 4x run gives these further observations:

- The 1,021,054-byte raw editor entry fetched in 2.5 ms on loopback. The CSS request started only after import resolved. Network latency here is much smaller than on a phone connection.
- Aggregate `v8.evaluateModule` duration was 24.9 ms, compared with 9.4 ms at 1x. `v8.compileModule` was 3.2 ms and 4.4 ms respectively. These cover traced modules across threads, and leave lazy function compilation outside the import window. Aggregate `V8.CompileCode` across startup was 106.9 ms at 4x and 33.5 ms at 1x. Nested trace events overlap; never add these values into a wall-clock breakdown.
- The worker script resource began around 266 ms after navigation at 4x, after synchronous mount. The first worker-side WASM requests establish that a worker was executing, but the trace has no explicit worker-ready handshake. Worker creation-to-ready remains unmeasured.
- Runtime, Markdown, inline Markdown, shell and TypeScript WASM request-to-finish spans were 1.81, 1.53, 1.32, 4.72 and 4.80 ms at 4x. They overlap and measure local fetches, not compilation. Use CDP network events for these spans. The page's worker resource timing had a negative duration and is excluded from conclusions.
- WASM compilation/instantiation, root Markdown parse, injected fence parse and first correct highlight are still inside the 163 ms readiness window without separate marks. The existing predicate accepts any syntax records plus one inline-preview element, then waits two frames. It does not establish complete visible syntax coverage.

The measured first targets are synchronous mount and the readiness window. Entry splitting also matters: startup compiles functions after import, and 862 KB on a cold network is substantial. Shell is the largest grammar, but Quick start uses shell fences. Remove only work the current viewport can safely postpone. Introduction and prose-only pages are the controls for avoiding shell and TypeScript completely.

## Goal metrics

These are acceptance targets for the implementation, not current product claims. Phase 1 freezes the fixture and exact byte accounting before comparing changes.

| Metric | Target |
| --- | --- |
| Static guide resources, gzip | At most 45 KiB, including its font; keep the current 42,376-byte baseline visible |
| Initial editor entry, gzip | At most 160 KiB, down from about 271 KB |
| Cold resources through correct visible takeover | Quick start at most 550 KiB; Introduction at most 400 KiB, including static resources |
| Complete Quick start language set after background settlement | At most 650 KiB gzip cumulative; report deferred bytes separately |
| Cold takeover on the fixed desktop at 4x CPU, loopback | Median at most 250 ms and p95 at most 350 ms from navigation, with a correct visible preview and usable input |
| Warm reload takeover, same 4x setup | Median at most 180 ms |
| Static first contentful paint | At most 100 ms on the local 4x setup; no material regression from its frozen before run |
| Cold mobile network model | At 4x CPU, 10 Mbps download, 1 Mbps upload and 80 ms RTT, static FCP at most 750 ms and forced takeover median at most 1,000 ms |
| Swap quality | CLS at most 0.001, unchanged visible rows/scroll anchor, zero unexplained pixel differences |

Use at least 20 untraced navigations per accepted cell for medians and p95. Trace separate paired runs for diagnosis. A 4x-throttled desktop is a repeatable slower-CPU model, not proof of a mid-range phone's speed. Record a real mid-range phone's model, OS, browser, network and cold/warm results before claiming those targets on phones. Real-device access is a later verification receipt; it does not block profiling or low-cost implementation.

## Ranked techniques

Expected gains below are hypotheses. Measure each independently, keep it only when the paired result improves, and report bytes moved after takeover as well as bytes removed.

| Rank | Technique | Expected gain and cost | Decision gate |
| --- | --- | --- | --- |
| 1 | Slim editor entry and feature code splitting | High byte/compile benefit, medium cost. Use exact exports. Defer find UI, authoring helpers and unused language-catalog loader code to command or editing intent. Keep the real editor and preview in the first editor chunk. | Bundle graph identifies retained modules; the first typed key and first find command still succeed while their chunk loads. Splitting alone can move code without saving startup work. |
| 2 | Page- and viewport-demand fence grammars | High cold-byte benefit, medium cost. A build manifest lists languages actually present. Load Markdown first; request fence grammars only for the page's visible fences and bounded lookahead, then on scroll demand. | Prose-only pages request no shell/TypeScript. Visible code keeps correct prerendered colours until matching live colours exist. Long scrolling and editing activate delayed languages correctly. |
| 3 | HTTP compression and immutable caching | High network benefit, low cost. Hash JS, CSS, queries and WASM; serve `Cache-Control: public, max-age=31536000, immutable`. HTML and its manifest revalidate. Use Brotli/gzip negotiation. | Verify actual headers and transfer bytes, then repeat with a warm cache. No stale grammar/query combination after a release. No assumed CPU saving on a cold run. |
| 4 | CSS and dependency hints | Moderate startup benefit, low cost. Make the editor CSS address available in build metadata so it can load beside the import. Add targeted module preload and WASM hints only for the imminent editor and current visible languages. | Compare delayed-network traces. Static FCP stays within budget and mobile static mode does not download an editor. Avoid duplicate or unused preloads. |
| 5 | Worker prewarm after static paint or pointer intent | Moderate overlap benefit, medium cost. Reuse one worker and one language session when takeover begins. Explicit editor actions trigger eager demand; idle prewarm remains bounded. | Worker count stays one, repeated intents are idempotent, navigation/disposal cancels abandoned work. Include idle wait in navigation totals. Prewarm must not compete with the font/static page. |
| 6 | Streaming WASM and shared compiled modules | Potential medium readiness benefit, medium cost. Confirm the current loader first. Use `application/wasm` and streaming compilation where its API allows it; reuse compiled `WebAssembly.Module` within a live session. | Separate fetch, compile and instantiate marks prove a gain. A WASM grammar is already compiled source code; portable build-time native browser code is unavailable. Avoid a persistent engine-specific module cache. |
| 7 | Smaller Markdown preview startup | Potential high mount/readiness benefit, medium-to-high cost. Measure syntax record scans, full-document decorations, preview installation and row layout. Delay authoring-only work and redundant scans; retain the shared Markdown renderer. | Before/after traces identify eliminated work, and preview/authoring tests plus first-edit parity pass. Keep existing package architecture unless the profile demonstrates a specific bottleneck. |
| 8 | Reuse prerendered token/preview records | Potential high readiness benefit, high cost. Build with the same Tree-sitter queries. Carry source hash, grammar/query/theme versions and bounded visible token records into startup. | Exact source and version match, invalidation on first edit, token/preview equality controls, bounded bytes and no second document truth. Adopt only if simpler changes miss the goals. |
| 9 | Visible-region takeover first | Potential high benefit on long guides, high correctness cost. Paint the visible rows and lookahead, then continue analysis and delayed fences while preserving static content elsewhere. | Explicit preview coverage, fast scroll, folds, wrapping, find, edits and cancellation pass. Markdown context and injection boundaries require a correctness design before implementation. |

[PR #1021](https://github.com/ShaulLavo/fregat/pull/1021) supplies a relevant viewport-first experiment, not a ready-made Markdown shortcut. At this plan's writing it is open. Its provisional trees are root-only, exclude injected content, and keep Markdown/MDX on the complete-context path. Check its final merged contract before reusing anything. The small guide startup here differs from its 1–200 MiB TypeScript opens.

The [browser comparison](../editor/docs/performance/browser-compare-2026-10-08.md) and [comparison harness](../editor/bench/compare/README.md) provide calibration and regressions. Their open clocks begin after module loading and use different prerequisite parsing work per editor. This site's clock includes navigation, code loading, preview and swap. Report both; do not infer a docs takeover target or a universal Monaco/CodeMirror ranking from that comparison.

## Phases

Each phase ends with its own before/after check. Give an implementation unit two or three production/test files where practical. Split a phase further when shared package changes need a separate review. Keep the existing page available throughout.

### 1. Freeze the baseline and expose missing clocks

- [ ] Move the prototype verify flow into portable site test tooling under `editor/site/tests/`, with explicit fixture routes and local server cleanup. Keep JavaScript-off as the known-good static control.
- [ ] Reuse the comparison harness's `open-profile.mjs` probes and trace summary where they fit. Add navigation, idle, import parse/eval, stylesheet, mount, worker creation/ready, grammar fetch/compile/instantiate, root parse, injection parse, first visible highlight, preview coverage and swap marks. Worker durations use the worker clock; correlate them with message round trips, never subtract unrelated clock origins.
- [ ] Freeze both short guides plus a long Markdown guide containing below-fold shell/TypeScript fences. Record source/build hashes, versions, viewport, DPR, cache state, server headers, scheduler overlap and CPU/network settings. Emit distributions and resource totals through visible takeover and through complete background settlement.
- [ ] Run the original verify script and new probe against the same build. Inject a known 120 ms delay into mount and one worker response to prove their clocks observe it. Add an incorrect-highlight control to prove the visible-readiness predicate rejects it. Retain screenshot/trace evidence.

Exit: missing clocks are measured or explicitly marked unavailable, controls pass, and the frozen baseline reproduces. No optimization conclusions depend on the existing loose `ready()` predicate.

### 2. Remove entry weight

- [ ] Inspect the Vite output and exact package imports in the production docs entry. Replace the full catalog search from the prototype with a build-time language manifest.
- [ ] Split optional find/authoring activation without blocking the first input or losing typed text. Keep the shared preview and core editor required for takeover.
- [ ] Run the site build, entry-size test and cold 4x profile. Exercise immediate typing and find before delayed imports settle.

Exit: entry budget passes or the retained module attribution explains the next bounded change. Failed optional chunks leave reading available and report a usable action.

### 3. Make grammar demand local

- [ ] Generate page language and fence-range metadata beside the prerendered article.
- [ ] Request visible fence languages and bounded lookahead from the owning analysis runtime. Coalesce repeated demand and cancel work for closed pages. Keep static token colours until the visible live preview is correct.
- [ ] Verify Introduction sends no shell/TypeScript requests, Quick start's visible fences are correct, fast scroll loads later fences, and editing a fence changes its demanded grammar. Run the touched Tree-sitter worker tests and site cold/warm resource checks.

Exit: byte reduction is real at takeover, cumulative bytes are reported, and delayed syntax never becomes an unexplained recolour. If static-token handoff is necessary, deliver its correctness proof in phase 7 before enabling this phase's deferred swap.

### 4. Fix asset delivery and the CSS waterfall

- [ ] Emit the editor stylesheet and imminent dependency hints in the site build. Set hashed-asset immutable cache and correct WASM MIME/compression headers in the site's portable hosting configuration.
- [ ] Compare cold and warm requests at the fixed network model. Verify a new release uses its own manifest, queries and grammars.
- [ ] Run site build/link tests and before/after FCP/takeover checks, including static mobile mode and JavaScript-off.

Exit: budgets improve through measured transfers; unused preloads and duplicate fetches fail the resource test.

### 5. Overlap worker startup safely

- [ ] Use measured worker readiness to decide whether idle or intent prewarm earns its cost. Start after static paint and reuse the warmed session during takeover.
- [ ] Confirm streaming WASM support in the existing loader. Change it only when compile/instantiate timing and the public loader API support the proposed saving.
- [ ] Run worker lifecycle tests for repeated intent, page navigation, disposal and failed loads. Compare cold 4x clocks and worker counts.

Exit: one reusable worker, bounded cancelled work, and a paired latency win with unchanged static FCP. Remove a prewarm experiment that only shifts the timestamp or increases unused downloads.

### 6. Reduce measured Markdown startup work

- [ ] Attribute synchronous mount and preview readiness with the new traces. Remove the most expensive redundant setup, syntax scan or decoration pass first. Prototype `codeRows()` scans and the subtree MutationObserver are specific suspects, not established causes.
- [ ] Test a preview-first import boundary with authoring enabled on real editing intent if the bundle or mount profile warrants it.
- [ ] Run the touched Markdown/core tests, site typing/find/navigation scenario and same-fixture trace comparison.

Exit: a demonstrated mount/readiness reduction with matching preview and first-edit behaviour. Stop adding startup changes once the targets pass.

### 7. Conditional token reuse or bounded visible takeover

- [ ] If targets still fail, compare these two bounded approaches using one short and one long guide. Prefer source-hashed visible prerender records when they fit the current token/preview contract; avoid parallel renderer state.
- [ ] Design the record identity and coverage contract before changing packages. An edit invalidates seeded records through the existing version model. Hash mismatches fall back to normal parsing while static reading remains available.
- [ ] For viewport-first parsing, demonstrate Markdown cross-boundary constructs, reference links, nested fences and injected languages against complete analysis. Account for PR #1021's deliberate Markdown and injection exclusions.
- [ ] Require token/style equality, swap screenshots, rapid scrolling, edits during analysis, find outside coverage and disposal tests. Check transferred record bytes against the takeover budget.

Exit: only the smaller proven approach ships. If neither is correct and cheaper overall, retain the simpler full-context path, record the missed target and continue with a specifically measured follow-up.

### 8. Acceptance and release evidence

- [ ] Run the fixed cold/warm matrix with at least 20 repetitions per accepted cell, CPU and network settings above, separate trace runs and resource accounting. Report each page independently.
- [ ] Run the prototype verification behaviours on the built site: JavaScript-off, failed grammar/worker, forced phone takeover, tab links/back, scroll restoration, find, selection/copy and immediate typing. Inspect screenshots at the top and a scrolled fence.
- [ ] Run the [comparison harness](../editor/bench/compare/README.md) smoke for any changed shared editor path. Preserve its controls and explicit feature differences. For Fregat consumer changes use `verify-fregat`, a matching scenario and `trace --compare`; collect render counts only if React consumers changed.
- [ ] Check real phone behaviour when a device is available and accessibility reading order/headings with the Plan 336 owner. Publish public numbers only with committed method, machine, versions, date and a reproducible script.
- [ ] Run `bun run plans:check`, update this plan's phase receipts and link the final evidence from Plan 336.

Exit: goal cells pass, release gates pass, optional delayed work settles correctly, and the public wording matches what was actually measured.

## Implementation guidance

Load `how` before changing an unfamiliar loader, Markdown or worker subsystem. Use `unslop` for public prose. Load `react-development` and `web-ui` for React UI changes, and `verify-fregat` for matching consumer verification. Read the edited editor package's `AGENTS.md`; rebuild workspaces before consumer checks. Use the host's scheduler for builds/browser runs and quiet measurements for accepted performance evidence. The committed scripts themselves must remain host-independent.

Laziness Protocol places entry cleanup and asset delivery ahead of seeded tokens and partial Markdown parsing. Prove It Works requires correct visible syntax and input checks at takeover, beyond the old readiness flag. Sequence Work into Verifiable Units requires one measured treatment per phase before moving on. Preserve a decision trail with `show-me-your-work` when shared runtime changes expand, use `interrogate` for a contested coverage contract, and follow the Babysit playbook for implementation PRs. No sub-agent or live provider run is needed for this plan-only deliverable.

## Risks and decisions

- Fonts currently use `font-display: block`, which can leave text invisible on a slow network. Measure this in phase 1. Any font-loading change belongs in phase 4 and must preserve row/wrap parity; do not trade FCP for a visible takeover jump.
- Backgrounding all syntax can lower a takeover counter while leaving wrong visible colours. The new readiness check must establish preview and syntax coverage for the entire visible viewport.
- Reusing prerender tokens adds bytes and an invalidation contract. It must remove measured work, not become another permanent renderer.
- The original shell grammar is large and Quick start needs it. Page-local lazy loading proves its saving first on prose-only pages; a below-fold fence may wait only while reading and subsequent scroll remain correct.
- Headless frame callbacks are frame opportunities. They do not prove physical display presentation or phone responsiveness. Keep experiment labels and real-device receipts distinct.
- The broader Singapore research's unproven ranking, bundle and accessibility claims remain governed by [the research](../docs/research/packages-as-products/singapore.md#6-honest-gaps-vs-monaco-and-codemirror) and [performance evidence](../docs/research/packages-as-products/performance-evidence.md). These site-specific experiments prove none of those general claims.
