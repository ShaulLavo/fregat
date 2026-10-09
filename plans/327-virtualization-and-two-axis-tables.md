# Plan 327: Virtualization costs and two-axis tables

## Status and ownership

- Status: Approved, 2026-10-03. Scheduled later; outside the current execution queue.
- Owner: Fregat web and shared UI, with Editor owning text projection and geometry changes.
- Authorization: the owner approved the virtualization audit follow-up for later execution and made two-axis table virtualization a requirement. CSV is the first implementation target.
- Inspected source: Fregat `6d8e768703c1bfc92091dbdd41c9171d5942f263`; source findings establish investigation targets, not a current performance baseline.
- Upstream reference: [cerious-scroll](https://github.com/ceriousdevtech/cerious-scroll/tree/a455a3e4e2a1a128e53b8673f78db8f72ecbbc4d), inspected at `a455a3e4e2a1a128e53b8673f78db8f72ecbbc4d`.

## Outcome

Large editors, search results, lists and tables keep visible content responsive while bounding DOM, retained view state and scroll-path work. Record separately the cost of preparing data and the cost of rendering a viewport.

Data tables with independently scrolling rows and columns virtualize both axes. CSV mounts only intersecting rows and columns plus bounded overscan and any retained editing cell. Increasing total columns must not multiply the mounted cell count for an unchanged viewport. Parsing, width calculation and editing remain separate measured responsibilities.

Keep TanStack for ordinary lists and the existing custom editor, tree, search and terminal renderers. An engine change follows an equivalent-content comparison and documented behavior checks. The required CSV column windowing proceeds regardless of that comparison's outcome.

## Current code and evidence

| Area             | Current implementation                                                                                                                                                                                                                                   | Work to investigate                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shared lists     | [VirtualList](../packages/ui/src/patterns/virtual-list.tsx), TanStack React Virtual 3.14.13, fixed/measured rows, 12-row overscan, active-row retention, anchoring and follow behavior                                                                   | Dataset-size metadata, row-array invalidation and forced geometry reads                                           |
| CSV              | [csv-table.tsx](../apps/web/src/features/workbench/components/csv-table.tsx), one two-axis scroller and vertically virtualized rows                                                                                                                      | Every visible row mounts every column; snapshot parsing and column-width scans cover the full table               |
| Editor           | [fixedRowVirtualizer.ts](../editor/packages/editor/src/virtualization/fixedRowVirtualizer.ts), indexed display projection, bounded row cache, recycled DOM, horizontal text windows and capped native scroll space                                       | Whole-document wrapping reconstruction on width/font changes; source-position anchoring during reconstruction     |
| Full search      | [result-virtual-window-store.ts](../apps/web/src/features/search/state/result-virtual-window-store.ts) and [result-editor-pool.ts](../apps/web/src/features/search/state/result-editor-pool.ts), velocity-sensitive overscan and pooled per-file editors | Repeated editor document-switch, viewport, syntax and layout work                                                 |
| File tree        | Indexed projection, sticky ancestor occlusion, retained active/drag rows and compositor-driven window positioning                                                                                                                                        | Verify its existing behavior as a control; measure filtered projection work only if a current trace implicates it |
| Terminal/minimap | Ghostty viewport cells and dirty rows; Editor worker/canvas minimap with overlapping raster reuse                                                                                                                                                        | Preserve these separate rendering models; investigate only costs demonstrated by current evidence                 |

[Editor projection evidence](../editor/docs/performance/e031-projection.md) establishes bounded row materialization and documents historical wrapping costs. [Plan 182](182-search-view-rendering.md) records earlier search traces in which editor/layout work dominated window selection, and subsequent delivered editor pooling. Those timings use older commits and different machines. Capture a fresh baseline before claiming a gain.

Cerious-scroll's ordinary-list camera stores an item index and an offset, with a nearby measurement cache and pinned tail measurements. Its scrollbar maps fractional row progress; this differs from exact accumulated pixel geometry. Pooling wrappers does not preserve their children. Its canonical masonry layout has dataset-dependent preprocessing and a resumable construction path. Borrow bounded caches, reusable storage, separated cost reporting and time-budgeted construction where appropriate. Its unvirtualized benchmark baseline does not establish superiority over our engines.

## Scope and existing owners

- This plan owns the measurement matrix, required two-axis data-table windowing and bounded shared-list improvements.
- [156](156-documents-in-the-editor.md) retains CSV format fidelity, document ownership, editing and later Office presentation. Coordinate this plan's table geometry with those contracts. Include future spreadsheet/data-grid presentations when they become executable under 156's gates.
- [182](182-search-view-rendering.md) retains the selected recycled per-file editor architecture. Execute the search unit against that direction; replacing the selected search renderer with one editor or a multibuffer remains unscheduled. Approved [229](229-multibuffer-excerpt-model.md)/[230](230-aggregated-source-views.md) retain their separate engine and aggregated-view scopes.
- [E052](e052-proportional-font-extents.md) retains proportional font extents and compact blank-line work; [111](111-editor-decorations.md) retains rich block-widget geometry. This plan's rewrap measurement and scheduling work preserves those owners.
- [282](282-fast-paired-input-latency-check.md) supplies paired input evidence when a change affects typing. It is not a prerequisite for the initial scroll/table baseline.
- [Issue #491](https://github.com/ShaulLavo/fregat/issues/491) tracks the disabled tail-follow geometry read. Confirm its browser cost and behavior before fixing or closing it.
- Inventory table presentations by rendering path. Apply the two-axis contract to application data grids; document-rendered tables retain their content-isolation and fidelity contracts. Record oversized document tables requiring their own follow-up in 156 or 111.

## Measurement design

At execution start, record checkout, package versions, browser, viewport, density, font, device scale and machine. Use deterministic fixtures and production builds. Run interleaved baseline/candidate rounds on the same machine; preserve distributions and raw evidence.

| Case           | Bounded baseline                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapped editor | 100k and 500k lines, monospace and proportional fonts, tabs/folds, wrap toggle and repeated split-pane resize; plain no-wrap control                      |
| Shared list    | 1k, 100k and 1M items with fixed rows; measured rich rows at feasible sizes, growing rows and prepended history; identical content for engine comparisons |
| Search         | Existing broad and dense fixtures, vertical fling, document switching, per-file horizontal position and keyboard match reveal                             |
| CSV            | Tall 100k × 10, wide 200 × 1k, mixed 10k × 100, plus ragged/quoted/multiline cells and edits at distant coordinates                                       |

Collect first useful paint, per-frame work and frame intervals, longest tasks, forced-layout time, mount/reuse counts, mounted rows/columns/cells, retained metadata/cache size, source reads and anchor movement. Attribute parsing/indexing, view construction, browser layout and paint separately. Wall time includes deferred work; publishing a quick first frame must not hide indefinite reconstruction or incorrect navigation.

Use the existing [Editor transform](../editor/packages/editor/bench/displayTransforms.ts) and [virtualization](../editor/packages/editor/bench/virtualization.ts) benches, then prove browser behavior through `verify-fregat`. Heavy suites, builds, browser runs and measurements use the repository heavy runner; paired timing runs use quiet admission. Store evidence under the existing Fregat evidence directory and record relative report links in this plan when units land. Fixtures and committed runners must work from a fresh clone on any supported machine.

## Execution units

### P0: Refresh the baseline and table inventory

- [ ] Reconcile current source and delivered 156/182/E052 work; pin the tested cerious-scroll and TanStack versions.
- [ ] Capture the matrix above with bounded run lengths and separate data/render costs.
- [ ] Inventory application table/grid presentations, their row/column windowing and scroll owners. Record the consumer and owning plan for each gap.
- [ ] Set numerical frame/latency budgets from the measured controls before tuning. Record the dominant bottleneck for each unit.

Exit: a repeatable baseline and explicit work ordering. CSV's two-axis requirement is already approved; baseline numbers select its design and verify improvement.

### P1: Deliver two-axis CSV and table geometry

- [ ] Define one row/column geometry authority for cell positions, total extent, visible ranges, headers, hit testing and keyboard reveal. Use the existing single scroller for both axes.
- [ ] Window body columns and headers alongside rows. Size DOM from the two visible ranges, with bounded directional overscan and explicit retention of an active editing cell. Preserve alignment while moving diagonally and resizing.
- [ ] Preserve editing state/source identity across row and column recycling. Reveal a distant cell on both axes before focusing it; a scroll must not silently commit, discard or apply an edit to a recycled cell.
- [ ] Separate parsing and width indexing from viewport updates. Reuse versioned parse results, retain the existing column sizing behavior, and incrementally update affected metadata where safe. Measure any unavoidable full rebuild after an edit independently.
- [ ] Keep role-appropriate logical row/column counts and indices, sticky header occlusion, text/table switching, Undo/Redo and save behavior correct.
- [ ] Put domain-free reusable grid windowing in `packages/ui` when the inventory establishes shared consumers; keep CSV parsing/editing with its feature. Register runtime tunables through the settings registry if needed.

Exit: CSV has genuine row and column virtualization. At fixed viewport/density, doubling total rows or columns does not grow mounted cells except at bounded retained-cell/edge cases. Add coverage for far-cell reveal, boundary edits, sticky headers and diagonal flings; capture screenshots and mounted-cell evidence.

### P2: Reduce disruptive editor reconstruction

- [ ] Attribute wrap-toggle and resize cost to projection construction, source reads, geometry or paint before selecting a change.
- [ ] If exact projection reconstruction blocks input, prototype resumable, time-budgeted construction while holding the previous complete view. Track document/projection/font/width revisions, cancel superseded work, and publish only a matching complete result.
- [ ] Preserve a source position and its screen-relative offset across resize/fold/layout changes where appropriate. Caret reveal follows its explicit navigation contract.
- [ ] Prove edits during reconstruction, rapid successive resizes, font arrival, folds, diff rows and proportional/RTL geometry. Compare end-to-end completion and retained memory as well as first paint.
- [ ] If profiling implicates warm proportional horizontal lookup, benchmark binary lookup of existing pixel checkpoints. Account for the renderer's intentional full-width calculation before proposing lazy prefix construction.

Exit: a measured reduction in the demonstrated reconstruction stall with correct source/display coordinates, or a recorded bounded investigation showing that the hypothesized bottleneck is absent. Preserve the current row cache, DOM reuse and browser-based text geometry.

### P3: Reduce repeated search-editor work

- [ ] Refresh broad/dense traces against the delivered per-file editor pool and inner excerpt windows.
- [ ] Attribute document-switch work to viewport/padding reads, projection, syntax acquisition, caret geometry and paint. Improve the measured owner while keeping parked documents released.
- [ ] Preserve selection, per-file sideways position, all-match reachability, stream settlement, reload position and focus while slots park or change files.
- [ ] Record results in 182 and link the completed unit here, avoiding a second search architecture checklist.

Exit: repeated view-switch costs improve on the implicated tier and remain within the dense/control budgets.

### P4: Shared-list cost and engine comparison

- [ ] Trace issue #491 with follow disabled, then verify runtime enable/disable, prepends and active follow before applying a guard or closing it as negligible.
- [ ] Measure metadata growth and rebuilds when item arrays change. Compare fixed and measured rows with the same content and interactions under TanStack and a bounded-cache candidate.
- [ ] Change overscan policy only when current traces show blank coverage or unnecessary rendering. Use search's existing adaptive policy as another reference.
- [ ] Verify selected-row retention, logical ARIA position/size, density changes, sticky offsets, restoration, chat follow/disclosure/prepend behavior and logs following before changing the shared adapter.
- [ ] Record the engine decision. A replacement requires a measured gain at actual application scale with equivalent positioning and interaction semantics. Preserve TanStack when that comparison provides no benefit.

Exit: confirmed shared-wrapper waste is addressed, and the engine decision has evidence. Coordinate chat behavior changes with [181](181-chat-timeline-end-anchoring.md).

### P2 follow-up: Restore paint after an unchanged editor is reparented

Status: Approved investigation, recorded 2026-10-09. The failing restoration branch is unconfirmed.

The `editor-lsp-tab-switch` scenario shows syntax colors and diagnostic highlights missing after returning to an unchanged tab. Text, the caret, and the red minimap diagnostic marker remain. Waiting 30 seconds for the CSS error highlight also timed out. The retained editor connection sent no document close or new diagnostic request for that file. This affects the retained hidden-document contract in [Plan 099](099-document-contributions.md).

The failure occurs with both the new lazy-state status source at `a2d562df9` and the exact previous hook source from `534d8b582`. A scratch Vite load plugin served the previous hook while keeping the rest of the checkout unchanged. The changed status-source ownership is therefore not the cause. Initial error paint succeeds; the failure begins after switching away and back.

Evidence directories on the execution host:

- Current hook: `/work/tmp/fregat-evidence/20261009T181700Z-scenario-editor-lsp-tab-switch-mKxl9Z/`.
- Previous hook: `/work/tmp/fregat-evidence/20261009T181944Z-scenario-editor-lsp-tab-switch-ESbMlz/`.
- Previous hook with a bounded 30-second repaint wait: `/work/tmp/fregat-evidence/20261009T182205Z-scenario-editor-lsp-tab-switch-j9Q9OY/`. Its `baseline-proof/` holds the original hook and one-off server configuration.

Read each `inspection.json`, structured log, and `03-failure-before-cleanup.png`. Protocol observations must distinguish editor diagnostic connections from temporary document-symbol connections. The latter deliberately open and close their own documents; counting their closes as editor teardown hides the paint failure.

Reproduce with a direct loopback Vite server on an explicit free port. From `apps/web`, run `WEB_PORT=5219 bun --bun vite --host 127.0.0.1 --port 5219 --strictPort`. From the repository root, run `WEB_PORT=5219 bun run agent:browser scenario editor-lsp-tab-switch`. Follow the execution host's scheduling instructions and stop the private server afterwards. An intervening proxy can cause the isolated HTML bootstrap to reject its fixture API header before the app loads.

- [ ] Extend the unchanged hide/show control in `editor/packages/editor/test/virtualizedTextView.browser.test.ts:517` to reparent the existing view into and out of a hidden container, as `apps/web/src/lib/keep-alive/state/store.ts:50` does. Keep text and tokens unchanged, and add a diagnostic-style range highlight.
- [ ] Capture mounted rows, registered Highlight sizes, and `range.startContainer.isConnected` before parking and after returning. Inspect `fixedRowVirtualizer.ts:446` and `:570`, `virtualizedTextView.ts:1678`, and `diagnosticsPresenter.ts:246` for the failing restoration path. Generic unchanged hide/show already has a syntax control; reparenting with diagnostic ranges is the missing comparison.
- [ ] Fix the confirmed owner, then run the control and `editor-lsp-tab-switch`. Keep the strict paint assertion and prove that returning introduces no replacement diagnostic connection or document reopen. Do not mask the failure with an edit, token replacement, fresh diagnostic request, or an arbitrary sleep.

## Verification and completion

Extend the existing CSV table/navigation scenarios in [csv-table.ts](../scripts/agent/scenarios/csv-table.ts), and add a wide-table scenario with mounted-cell counts and two-axis reveal assertions. Use existing editor scroll/geometry tests, search pool/window scenarios and shared-list active-descendant/density tests for the owners changed. Add browser scenarios where coverage is missing.

Each implementation unit completes with its narrow checks, production-build before/after evidence, screenshots read back, required gates, patch version changes for affected shipped packages, path-scoped commits and pushes, and a verified deployment on the mesh. Use `trace --compare` for performance claims, `renders` for render-count claims and `caches` for settlement claims. Capture diagnostics as well as a screenshot; a plausible-looking viewport is insufficient proof of bounded work.

- [ ] P0 baseline and table inventory complete.
- [ ] P1 two-axis CSV/table contract delivered.
- [ ] P2 editor reconstruction measured and resolved.
- [ ] P3 search costs reconciled and delivered through 182.
- [ ] P4 shared-list fixes and engine decision recorded.
- [ ] Cross-view controls pass; roadmap, owner plans and receipts reflect what actually shipped.

Implementation is deferred. Creating this plan does not start benchmarks, package changes or deployment.
