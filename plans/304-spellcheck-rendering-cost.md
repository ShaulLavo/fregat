# Plan 304: Reduce the input cost of spelling underlines

Status: APPROVED, 2026-10-03.

Owner: `ShaulLavo/fregat`, Editor overlay painting and spellcheck benchmarks, with Platform consumer verification. Reported in the read-only mirror as [Singapore #58](https://github.com/ShaulLavo/singapore/issues/58). Inspected baseline: Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`.

Dependencies: [Plan 201](201-cheap-overlay-marks.md) owns the shared overlay implementation and large-file typing budget. This plan supplies spellcheck workloads, attribution, and acceptance for that work. [Plan 303](303-spellcheck-correctness.md) preserves bounded input and failure handling. It does not block collecting a baseline.

## Outcome

Typing with spelling marks pays for the visible rows and the overlays that changed. It does not rebuild work for misspellings outside the mounted rows. The final report separates spelling computation, highlight updates, token adoption, and total synchronous edit cost.

## Current code and evidence

[E062](../editor/docs/editing/e062-spellcheck-hardening.md) shipped a measured reduction in repeated CSS decoration parsing. It did not complete incremental overlay painting. Its local dense-mark results improved, but the off baseline varied and background work affected reruns. Treat these as historical evidence, not a current controlled comparison.

[virtualizedTextViewHighlights.ts](../editor/packages/editor/src/virtualization/virtualizedTextViewHighlights.ts) still rebuilds the document overlay mask in `refreshHighlightOverlayMask`. [highlightOverlay.ts](../editor/packages/editor/src/virtualization/highlightOverlay.ts) already normalizes shared styles once. Preserve that shipped optimization. Coordinate the remaining mask work through Plan 201 instead of adding a second overlay engine.

[bench/typing.browser.test.ts](../editor/packages/spellcheck/bench/typing.browser.test.ts) has off, no-mark, dense, and sparse cases, controller/highlight/adoption timers, isolated tokenizer samples, and a Chromium CPU profile. It uses `FakeChecker`, so its numbers describe synchronous integration cost, not dictionary-worker end-to-end latency. The sparse fixture was corrected in E062 to one marked line in four.

[bench/engine.ts](../editor/packages/spellcheck/bench/engine.ts) already reports total evaluation pairs, target coverage, accepted typos with covered targets, eligible ranking pairs, and conditional top-1/top-5 ranking. Its defaults still carry a `NOT-PORTABLE` comment and absolute owner paths. Make this benchmark reproducible as part of the measurement work.

No benchmarks ran during this planning pass.

## Data and implementation ownership

The host continues to own one lazy dictionary service shared by editors. Each controller keeps local word verdicts, cached lines, checking windows, and current issue positions. Replacing the engine, moving dictionary work, or moving tokenization cannot serve as evidence that overlay painting became cheaper.

Plan 201 owns sorted overlay ranges, mounted-row intersection, unchanged-row signatures, overlapping style combination, surrogate boundaries, stable paint order, and style registry updates. Use those contracts for spelling underlines and LSP overlays. Do not introduce a spellcheck-only renderer.

The file default remains `off` until the final artifact has a measured input-latency result acceptable against the existing Plan 201 frame budget. A default change must use `packages/contracts/src/settings/keys.ts`, regenerate settings reference, and verify the composer and file editor separately.

## Execution checklist

- [ ] Rerun `bun run bench:typing` from `editor/packages/spellcheck/` before changing code. Record commit, runtime, browser, fixture size, mark count/density, samples, and median/p95 for all four cases. Run a quiet measurement through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill.
- [ ] Attribute controller/tokenization, underline updates, token adoption, and total edit work. Identify whether document-wide mask rebuilding or another measured path is the current bottleneck. Profile both text edits and delayed overlay updates so overlapping timings are labeled correctly.
- [ ] Land the shared overlay work through Plan 201. Compare offscreen-dense documents at fixed mounted-row count. Count the ranges/rows touched so the regression proves that unrelated offscreen marks do not add per-keystroke rebuilding work.
- [ ] Exercise sparse, dense, and empty marks during edit, scroll, remount, asynchronous verdict arrival, overlapping dim/underline/diagnostic styles, and surrogate-edge changes. Preserve paint on text that has no syntax provider.
- [ ] Make the engine benchmark derive its default corpus from the checkout and its external-data cache from a caller argument or temporary directory. Record corpus/testset identity and fetch failures. Avoid owner-specific paths and network-dependent CI quality assertions.
- [ ] Preserve the engine benchmark denominator labels. Report target coverage and missed-typo cases beside conditional ranking. Before making a cross-engine quality claim, run the same evaluation pairs for each engine and publish eligibility differences. The deliverable retains the existing engine unless a separate approved decision changes it.
- [ ] Rerun the same typing cases on the final committed build and publish baseline/after median/p95 with comparable conditions. Measure real-worker load/check/suggestion latency separately if the report discusses it.
- [ ] Decide the file default using the final measured artifact and Plan 201's existing frame budget. If the cost remains too high, record the remaining measured bottleneck and approved follow-up. Lack of a baseline is a reason to measure, not to drop the work.
- [ ] Verify the real Platform spelling flow and the package's Chromium/Firefox/WebKit paint tests. Inspect screenshots, build affected workspaces, run narrow consumer checks, commit by path, push, deploy, and attach the delivery receipt.

## Verification and acceptance

Use `bun run bench:typing` for the controlled synchronous comparison. Narrow package checks are the existing overlay mask and virtualized overlay integration tests, `test/paint.browser.test.ts` through the spellcheck `engines` project, and the real `editor-spellcheck` scenario. Run browser work through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill.

The final artifact must preserve marks in Chromium, Firefox, and WebKit, and demonstrate removal of the identified redundant work. Keep profiles and measured rows in a delivery report. Do not infer a total input-latency gain from dictionary lookup timings or a benchmark with changed mark density.
