# Plan 198: Keep editor analysis with the document

Status: Approved; implementation partly landed. Foundations publication, cancellation,
configuration, range and retention contract proofs merged in
[PR #203](https://github.com/ShaulLavo/fregat/pull/203) (`cf4e84419`) and shipped in web release
`20260930T153009Z-cf4e8441-main` on 2026-09-30. The full acceptance matrix below remains open:
chat/workbench pixel-level token comparison, retained parser/WASM byte accounting, an inactive
analysis budget, the memory-pressure/first-frame matrix and physical hardware. See [current proof and limits](../docs/document-contributions/foundations-publication-proof.md). The owner superseded the fixed “first after wave 2” priority on 2026-09-28.
Schedule by the [current dependency order](../PLAN.md#wave-2-closeout-and-dependency-order).
Owners: Editor for analysis and view attachment; Platform for document retention and file opening.

## Landed code and remaining proof

At Editor `401d30cd` and Platform `cf7bc9343`, `editor/documentAnalysis.ts` exposes retained
structural/highlighter sessions and `workspace-document-service.ts` retains an
`EditorDocumentAnalysis` beside each buffer. Editor `7edf180c` and Platform `e94c62fae` include
retained analysis/Markdown integration; `documentAnalysis.node.test.ts` covers shared sessions.
The old “implementation has not started” status is obsolete.

This source check does not close the contracts below. Inventory acquisition/preparation callers,
range/configuration admission, cancellation, eviction and attachment behavior before changing
them. Run the first-frame/dirty-buffer/multiple-view/memory proofs against today's implementation.
Each sequence item is now “verify landed behavior, implement the missing part,” not permission
to create a second analysis resource.

099 unit 1 delivered the canonical revision-tagged publication contract and retained-analysis
subscriber in PR #203. 198 consumes that event contract. The remaining attachment and memory
acceptance checks exercise this landed owner. Full minimap/LSP
migration, the installed-app path and binary viewers are independent. Plan 197 owns standalone/diff highlighting;
200 consumes the relevant retained-source and attachment guarantees as they become proven.

## Outcome

A document keeps its syntax analysis when a tab stops displaying it. Hovering a file, opening it,
and returning to its tab acquire the same document and request work through the same path.
If its current visible range already has valid highlights, the first frame displaying that range
includes those highlights. This holds for saved and dirty documents, chat and workbench layouts,
and multiple views of one document.

The shared highlighting service in Plan 197 exposes highlighting outside the editor. It is
independent of this work and is neither a prerequisite nor part of this plan.

## What the investigation established

The two layouts already render through the same `CodePanel`, `EditorGroup`, `FileEditorBody`, and
Editor implementation. We did not establish a separate highlighting implementation or a reliable
timing advantage for editor mode. The owner's remaining impression of a difference needs a
controlled comparison.

The lifetime mismatch is concrete:

- React Query caches disk snapshots. Platform's `WorkspaceDocumentService` retains live buffers,
  including local edits and undo history.
- Editor's `syntaxController.startDocument()` disposes the previously attached structural and
  highlighter sessions. Returning to a retained buffer can recreate analysis.
- `EditorPreparedDocument.take()` transfers prepared work once. Preparation and subsequent
  attachment therefore have different ownership paths.
- Runtime `EditorViewSnapshot` already carries text and token snapshots, but also carries view
  state. Its JSON serialization reads the full text. `EditorVisibleSnapshot` is a bounded saved
  picture of visible rows, with separate admission and handoff rules.

The small fix in Platform `e72820fff` retained several saved visible paints within the existing
256 KiB aggregate limit. The measured production revisit changed from text at 37 ms and colors at
60 ms, with one uncolored frame, to both at 34 ms with zero uncolored frames. Both the 2-second and
35-second hover cases were already colored on their first text frame before that fix.

Evidence is local under `/work/tmp/fregat-evidence/`:

- `20260927T172628Z-trace-editor-tab-hover-live/inspection.json` and `trace.json`.
- `20260927T173524Z-trace-editor-tab-hover-live/inspection.json` and `trace.json`.

Those results prove the narrow saved-paint improvement. They do not prove this architecture.
Capture waits 350 ms, replay accepts clean files with matching appearance and geometry, and the
current scenario waits one second on the other tab. Its color probe detects the presence of color;
it does not validate every visible token. Rapid switching, dirty files, and partial coloring need
stronger checks below.

## Ownership

| Owner               | Retained state                                                                | Lifetime                                                                   |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| File snapshot query | Disk content and server version, pending/error state, revalidation            | Query policy                                                               |
| Live document       | Authoritative buffer, revisions, undo, save/sync identity, attached analysis  | Workspace document lifetime                                                |
| Document analysis   | Structural/highlighter sessions, pending work, immutable results and coverage | Retained with the document, subject to explicit inactive-analysis eviction |
| Editor view         | Selection, scroll, viewport, wrapping, layout, DOM, view subscriptions        | View attachment                                                            |
| Saved visible paint | Bounded serialized visible rows and appearance identity                       | Reload/startup fallback policy                                             |

Keep the existing buffer as the text authority. Query eviction must not dispose a dirty document,
undo history, or analysis pinned by a visible view. A file path alone is insufficient identity:
environment, document identity, buffer incarnation and revision all matter.

Analysis belongs to Editor. Platform retains the Editor-owned resource beside its existing live
document and controls when that document is released. Worker/provider lifetime remains separate:
releasing one document cannot terminate a provider borrowed by other documents.

## Usage and API shape

Keep the existing buffer and view-session APIs. Add an Editor-owned analysis handle to the live
document record. These are proposed signatures; execution must reconcile them with wave 2's APIs.

```ts
// Hover and activation enter the same operation with different demand priority.
await workspaceDocuments.prepare(target, {
  priority: 'background',
  range: reopenRange,
  signal: hoverInterest.signal,
})
const document = await workspaceDocuments.prepare(target, {
  priority: 'interactive',
  range: reopenRange,
  signal: tabInterest.signal,
})

// View state remains separate; both panes can borrow the same analysis handle.
editor.attachSession(viewSession, { analysis: document.analysis })

// Ordinary embeds retain their existing entry point.
const standalone = new Editor(element)
```

`prepare` resolves once the authoritative buffer is available and the analysis demand is registered.
It does not wait for a cold worker to finish. A live buffer and its analysis are reused together.
The view binding synchronously reads compatible ready results, or observes pending work through
the existing loading contract. Hover completion and highlight readiness are distinct facts.

```ts
interface EditorDocumentAnalysis {
  readonly buffer: EditorTextBuffer
  prepare(request: AnalysisRequest): Promise<HighlightOutcome>
  dispose(): void
}

type AnalysisRequest = {
  readonly configuration: AnalysisConfiguration
  readonly range: SourceRange
  readonly priority: 'background' | 'interactive'
  readonly signal: AbortSignal
}

type HighlightOutcome =
  | { readonly kind: 'ready'; readonly frame: HighlightFrame }
  | { readonly kind: 'plain'; readonly identity: AnalysisIdentity }
  | { readonly kind: 'failed'; readonly identity: AnalysisIdentity; readonly error: AnalysisError }

// Internal read used by the view binding before its first render.
type HighlightRead =
  | HighlightOutcome
  | {
      readonly kind: 'pending'
      readonly identity: AnalysisIdentity
    }
```

`AnalysisIdentity` contains buffer incarnation/revision and effective configuration identity.
`HighlightFrame` contains that identity, the immutable text snapshot and token store, and covered
source ranges. Structural results have their own readiness; they do not gate `HighlightOutcome`.
Reuse existing range, configuration, error and scheduler types wherever they express these rules.
Existing buffer indexes and view configuration remain authoritative for line starts, tab size and
layout. The analysis frame references those inputs where needed; it does not become their owner.

The resource's `prepare` settles when that requested generation/range reaches a terminal outcome;
the workspace operation registers this work without making attachment wait for it. Both operations
use existing async ownership mechanisms. Abort releases the caller's interest. Superseded work
settles as cancellation and cannot publish a ready result for the new generation.

Editor privately binds the analysis resource to each view's configuration and range demand.
The attachment boundary validates that the supplied session and resource reference the same buffer.
Borrowing a resource never transfers its provider sessions or its disposal authority. Standalone
Editor creates and owns its buffer and analysis resource internally.
Speculative preparation uses the same resource registry as retained documents. Opening a tab adds
a retained interest to that resource; it does not create a second resource or transfer its tokens.

## Contracts

1. A view attachment reads the current text snapshot and compatible analysis together, then
   publishes them in one render. It must not render the new text and install an already available
   token store in a later effect. The old tab header and body remain paired until the new subject
   can paint.
2. Every reusable result identifies the buffer incarnation, text revision, language, provider
   configuration, appearance where applicable, and covered source ranges. Validate worker replies
   at the document boundary. An old reply cannot republish after an edit, reconfiguration, buffer
   replacement, or disposal.
3. Hover, activation, and revisit reach one preparation operation. Activation promotes or joins
   compatible pending work. It does not consume the results or create another syntax session.
   Canceling a hover releases that interest; it cannot cancel work a view now needs.
4. Multiple views contribute their required ranges. Closing or scrolling one view cannot erase
   another view's demand or invalidate its data. Compatible views share analysis; differing
   configurations get explicitly keyed results.
5. Edits publish through the existing document revision mechanism. Analysis updates incrementally;
   incomplete or rebased ranges remain distinguishable from exact results. Typing never waits for
   a worker, and a pending structural parse does not delay already valid syntax colors.
6. Parse data and theme-resolved styles are separate where the provider supports it. Reuse parse
   data on theme changes when valid. Providers that require retokenizing still obey the same
   revision and publication rules. No promise of universally free theme changes.
7. Attach retained immutable token stores directly. No full-text serialization, DOM snapshot
   round-trip, or mandatory worker response on a warm tab switch. Selection and layout stay local
   to the view.
8. Standalone `new Editor(element)` and ordinary text setting remain simple. Editor supplies an
   internally owned buffer and analysis when the caller does not provide them. Hosts with retained
   documents use explicit ownership; no global active-editor pointer or hidden process-wide document map.

Cold documents can lack analysis. Distinguish `pending`, `ready`, `plain` and `failed` so an empty
token set for plain text is a completed result. Hold an existing subject according to the app's
loading contract while preparing a switch. An unavailable highlighter must settle into an
interactive fallback. Never retain an inert snapshot indefinitely or delay typing to meet a color
metric. The first-frame guarantee applies when compatible visible-range analysis is ready.

## Retention and snapshots

Retain current results for open documents across ordinary tab switches. Visible views pin the
analysis they need. Under a measured memory budget, reclaim speculative work first, then inactive
analysis. Reclamation may make the next attachment cold; record that reason. Never reclaim dirty
text or undo as a side effect of freeing syntax data.

Measure token arrays, indexes, parser/tokenizer state and worker memory separately from text.
Packed token offsets and style IDs are compact, but parser sessions can dominate. Reuse immutable
storage across views; do not assume analysis has negligible cost or keep every document forever.
Choose the budget from the baseline and register any new configurable policy in settings.

Runtime analysis and serialized visible paint have different jobs. Keep the saved-paint path for
reload/startup with its current validation and handoff. Normal retained-tab correctness must pass
with saved paint disabled. This plan does not turn `EditorViewSnapshot` JSON into a document cache.

## Implementation sequence

Each unit ends with a working, reviewable contract and its narrow checks. Reconcile the exact API
names against the landed code; the ownership and observable behavior above are the required result.

### 0. Reconcile and establish the baseline

- Record Platform and Editor HEADs, dirty diffs, the CI `editor-ref`, and the actual linked build.
  Planning inspected Platform `ae3bf6d92` and Editor `f97fdad99`.
- Read current landed changes before designing replacement types. Reuse the buffer revision
  publication from Plan 099 units 0–1 if landed. This work covers syntax lifetime and tab
  attachment; it does not require the broader minimap/LSP contribution migration.
- Inventory all callers of `startDocument`, `createEditorPreparedDocument`, prepared `.take()`, and view
  snapshot restore, including standalone Editor, React, diff views and examples. Record each
  caller's owner and disposal boundary.
- Extend the existing tab scenario to calibrate the first-frame probe with a deliberately delayed
  token-install control. Record a known-good fully colored frame too. Capture chat and workbench
  baselines, session creation/disposal counts, worker requests, input latency, and retained bytes.

Exit: a failing control is detected, the known-good case passes, and the remaining flash can be
classified as missing analysis, attachment ordering, or saved-paint fallback.

### 1. Give analysis document lifetime in Editor

- Extract session ownership and reusable results from the view-bound syntax controller into the
  document-owned analysis resource. Keep view-specific range demand and painting in the view.
- Subscribe once to authoritative buffer changes. Reuse existing revision/edit-chain machinery;
  avoid a second edit journal or competing content-version counter.
- Implement exact-result admission, shared range demand, incremental updates, and explicit
  ownership of cancellation and disposal. Preserve provider independence and worker queues.
- Keep ordinary standalone Editor construction working through internally owned buffer and analysis.

Exit: two views share compatible analysis, detaching either leaves the other working, late replies
cannot corrupt current data, and disposing the final document owner frees its sessions exactly once.

### 2. Attach a view with text and analysis together

- Make attachment synchronously read a matching text/result pair and install it before the first
  visible text frame. Restore selection and scroll independently.
- Apply the same path to recycled views, React mount/unmount, split groups and mode changes.
- Reuse the runtime token store from document analysis. Preserve saved-paint admission and live
  handoff only where that fallback is needed.

Exit: a ready document attaches fully colored with no worker round-trip and with serialized paint
disabled. Different split-view ranges remain correct after edits and scrolling.

### 3. Unify Platform acquisition and preparation

- Retain the analysis resource with `LiveEditorDocument` in `WorkspaceDocumentService`.
- Route hover and open intents through the same document acquisition/preparation operation with
  different priorities. A warm live buffer wins over an older disk snapshot, including dirty files.
- Keep disk reads and other app async reads in TanStack Query using shared query options and the
  repository's imperative API. Keep existing intent queues where they own sequencing. Do not add
  a promise cache or React effect bridge to represent ownership.
- Remove one-shot prepared claims and the separate live-buffer branch that drops prepared analysis.
  Migrate all affected callers in the same unit; delete the replaced APIs and tests.

Exit: hover then click joins the same work; no hover and immediate revisit reuse retained analysis;
rapid repeated requests cannot create duplicate compatible sessions.

### 4. Bound retention and retire obsolete paths

- Measure and implement the inactive-analysis budget. Pin active demand, evict by explicit policy,
  and retain document text/undo independently. Cancel abandoned speculative work.
- Exercise close/reopen, buffer replacement, rename, external reload, theme/language changes and
  workspace/environment disposal. Preserve existing save and conflict behavior.
- Remove old view-owned syntax session teardown, transfer-only preparation plumbing and redundant
  state. Keep the reload snapshot feature and its checks. Do not introduce compatibility aliases.

Exit: no monotonic growth after repeated open/close cycles; expected eviction recreates analysis
without losing edits, history, view state, or provider resources used by another document.

### 5. Verify and ship the paired change

- Run the acceptance matrix below with real workers and the relevant input-latency checks. Compare
  against the unit 0 baseline. Attribute any regression before changing budgets or thresholds.
- Run affected Editor and Platform tests, builds and repository gates. Land Editor first, then
  update Platform's linked contract and CI `editor-ref` in its integration commit.
- Verify on the dev route, commit and push the owned paths, deploy through the mesh, check the
  served release, and run the production read-only tab scenario. Read back the screenshots.
- Record results and accepted limits in a permanent document. Retire this executable plan under
  the repository's completed-plan convention.

## Acceptance matrix

| Case                                                                   | Required observation                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ready A → B → A, no hover; repeat faster than the 350 ms capture delay | Zero frames with missing or stale expected colors; no new compatible syntax session for A                  |
| Hover then click at 0, 200, 2,000 and 35,000 ms                        | Same document/work ownership; priority promotion; first-frame colors whenever the required result is ready |
| Chat, workbench, and crossing between layouts                          | Same attachment contract; layout timing cannot change analysis identity                                    |
| Dirty A, edit, switch away and return; undo/redo                       | Correct current text and colors; preserved history; saved paint disabled                                   |
| Two views, different ranges; scroll/close one; edit from either        | One compatible document analysis; both ranges correct; independent selection and scroll                    |
| Edit/theme/language/provider change with an old worker reply held      | Reply rejected; no stale result labeled ready; input remains responsive                                    |
| Cold document, plain text, highlighter failure                         | Honest terminal readiness/fallback; no indefinite frozen overlay                                           |
| Memory pressure and speculative cancellation                           | Active demand survives; inactive eviction is observable; no lost buffer or borrowed-provider disposal      |
| Large file and repeated open/close cycles                              | Bounded retained analysis; no full-text serialization on warm attachment; input-latency limits preserved   |
| Reload with and without saved paint, including slow font loading       | Existing reload behavior and safe live handoff preserved                                                   |

Extend `editor-tab-hover-highlights` and the real-worker browser tests in
`apps/web/src/features/editor/tests/prepared-open.browser.tsx`. Record document/revision/configuration
and coverage with the frame samples. Compare all expected visible token runs against a settled
reference, including style and source offsets. One colored span must not count as a fully correct
frame. Plain-text fixtures need an explicit expected-plain result.

Use `bun run agent:browser trace editor-tab-hover-highlights` for the baseline and
`bun run agent:browser trace editor-tab-hover-highlights --compare <baseline-directory>` after the
change. Run reload scenarios and the native/Shiki syntax scenarios from the current scenario list.
Use `look` and read its image for each layout, and `caches` when validating Query ownership.
Collect worker/session counters and memory evidence alongside traces; a screenshot alone cannot
prove resource reuse. Production inspection uses the existing read-only `editor-tab-hover-live`
scenario against the affected app URL.

## Source map for execution

| Area                                   | Current entry points                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disk read ownership                    | `apps/web/src/lib/file-snapshot-query-cache.ts`                                                                                                                                          |
| Retained documents and views           | `apps/web/src/features/editor/state/workspace-document-service.ts`, `runtime.ts`                                                                                                         |
| Open and hover preparation             | `apps/web/src/lib/file-open-intent/state/service.ts`, `apps/web/src/features/editor/utils/prepared-document.ts`                                                                          |
| Syntax session ownership               | `../editor/packages/editor/src/editor/syntaxController.ts`, `preparedDocument.ts`, `Editor.ts`                                                                                           |
| Immutable tokens and runtime snapshots | `../editor/packages/editor/src/syntax/tokenStore.ts`, `../editor/packages/editor/src/editor/viewSnapshot.ts`                                                                             |
| React attachment                       | `../editor/packages/react/src/index.tsx`                                                                                                                                                 |
| Reload fallback                        | `apps/web/src/features/workbench/hooks/use-editor-visible-snapshot.ts`, `apps/web/src/features/workbench/state/snapshot-capture.ts`, `apps/web/src/lib/editor-visible-snapshot-cache.ts` |
| Frame evidence                         | `scripts/agent/scenarios/editor-tab-hover-highlights.ts`, `scripts/agent/press-timing.ts`, `scripts/agent/selectors.ts`                                                                  |

## Design decision and remaining measurements

Two sketches were compared. The selected design retains an analysis resource beside the existing
buffer. It preserves the buffer/view contracts while moving worker lifetime and result validity
behind one owner. The alternative introduced a public document object around buffer and analysis;
it expanded the migration into existing document APIs without improving the first-frame contract.
Its useful part, one workspace preparation path, is included here. Independent review agreed with
the resource design and identified the need to separate color readiness from structural readiness.

Keeping every tab's Editor mounted would retain DOM and plugin state as well as analysis, while
leaving hover ownership separate. Expanding serialized snapshots would retain presentation without
fixing live session ownership. Both alternatives lose to direct reuse of document analysis.

The accepted cost is more retained analysis in exchange for warm attachment. Unit 0 must measure
that cost and provider configuration behavior before choosing eviction thresholds. It must also
identify syntax callbacks that require a mounted view and leave those callbacks with the view.
These are implementation measurements, not reasons to introduce another document owner.
