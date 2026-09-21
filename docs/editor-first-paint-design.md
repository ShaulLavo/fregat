# Provisional editor display state

Status: implemented and verified across Editor and Platform. See [implementation and verification results](editor-first-paint-verification.md). This replaces the separate preview-owner proposal and refines [workspace reload delivery](instant-reload-implementation.md).

A saved snapshot supplies provisional display state inside the editor's native view. The first authoritative paint replaces that state in one commit. There is one viewport, one painter, and one presented set of rows. Platform persists opaque paint and supplies authoritative file data.

The document may already be available at mount while highlighting is still pending. Document arrival is not the replacement trigger. The real document becomes authoritative immediately; saved paint remains the provisional presentation until the real document's highlighting and required layout can produce the replacement frame. File loading is another supported wait, not a prerequisite for using the snapshot.

Keep the existing synchronous Editor constructor and live command API. This design does not introduce a separate preview object, DOM handoff, universal asynchronous construction, or snapshot-shaped objects on every edit.

## Caller experience

The React adapter accepts:

```tsx
const controller = useEditor({
  documentKey: targetKey,
  document: authoritativeDocument,
  snapshot: eligibleCacheRecord?.paint ?? null,
  ...editorOptions,
})

return <EditorHost controller={controller} />
```

The host mounts whether its document is available immediately or still null. The adapter scopes the restore attempt to the requested file identity and editor incarnation. Platform validates environment/workspace/path and known revision in the cache envelope. Snapshot contents stay opaque.

The native API adds an optional snapshot at construction and keeps existing attachment:

```ts
const editor = new Editor(container, {
  ...editorOptions,
  snapshot: eligiblePaint,
  documentKey: targetKey,
})

editor.attachSession(authoritativeSession, sessionOptions)
```

The existing open-document and prepared-document paths remain authoritative inputs too. Snapshot support adds no mandatory constructor promise or replacement live-editor interface.

Changing the snapshot prop to null withdraws eligibility while restoration is pending. Repeated equivalent props do not decode or restore again. Once a document generation is live, later snapshot props cannot overwrite its text or scroll. A new requested target invalidates the previous attempt before another can start. Preserve normal controller/session reuse; do not force ordinary tab changes to remount solely for snapshots.

Capture remains an explicit operation. It returns opaque paint plus mounted document identity/revision metadata. Platform compares that metadata with its current clean file before storing it. Editor returns no capture during provisional display or incomplete authoritative paint. Capture and identity checks must refer to the same synchronous operation.

## State model

Conceptually the painter uses authoritative display state when it exists, otherwise the saved display state. Internally keep the existing live model and a restore-only record; do not materialize a second complete live frame object on every update:

```ts
document = realDocument
display = readyLivePaint ?? provisionalPaint
```

```ts
type RestoreProgress =
  | { readonly kind: 'awaiting-document' }
  | {
      readonly kind: 'preparing'
      readonly documentGeneration: number
    }

type ProvisionalDisplay = {
  readonly attempt: RestoreAttempt
  readonly paint: DecodedSnapshot
  progress: RestoreProgress
}

// A field on the existing native view, null outside restoration.
provisional: ProvisionalDisplay | null
```

RestoreAttempt represents the requested target and editor incarnation, using existing identity/generation concepts. The decoded data contains only paint facts. The provisional field does not become a document, session, text buffer, undo state, worker input, or line index.

| Event                                                                | Result                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Valid saved paint with no authoritative frame                        | Present provisional rows through the native painter.                                           |
| Default empty constructor state or initial null document prop        | Keep provisional state. Bootstrap emptiness is not a file response.                            |
| Explicit document attachment, including an empty file                | Bind preparation to that authoritative generation.                                             |
| Document available at mount, highlights pending                      | Use the real document immediately and retain provisional paint until its render data is ready. |
| Authoritative document/syntax/structural data ready                  | Commit the authoritative presentation and release provisional state.                           |
| Known target/revision mismatch, incompatible appearance, or disposal | Invalidate the attempt; old completions cannot publish.                                        |
| Slow load, retryable failure, pointer/key/wheel/focus activity       | Retain eligible saved display with truthful pending status; queue no input.                    |
| Snapshot update after that generation becomes live                   | Do not restore it again.                                                                       |

The React adapter distinguishes initial waiting from an explicit clear so a null document cannot erase provisional paint. A clear/missing-target action still withdraws the attempt; a genuinely empty authoritative attachment replaces it normally.

## Native paint and replacement

The existing [native view](../../Editor/packages/editor/src/virtualization/virtualizedTextView.ts) already batches updates through runAtomicRender. Its [row painter](../../Editor/packages/editor/src/virtualization/virtualizedTextViewRows.ts) owns row pooling, chunk reuse, gutters, and same-line patches. Build the restore path at that boundary.

Decode saved text/control parts, projected styles, and geometry into the inputs needed by native drawing helpers. Reuse the existing row/chunk DOM and highlight ownership rules. Extract the smallest helpers needed by both sources. Preserve the live projector and incremental update algorithm.

Provisional and authoritative rows use the same presented row owner and native node pool. DOM reuse must not imply document identity: provisional rows have no invented source offsets or buffer rows. At replacement, clear provisional geometry/token caches before associating reused nodes with authoritative metadata. Reusing a node merely because its visible row number matches is insufficient.

While provisional paint is presented, authoritative model, syntax, and structural updates can proceed. They must not incrementally overwrite individual visible rows, styles, guides, or folds. Keep invalidation until the first authoritative commit. Do not duplicate the entire document or create a hidden second editor tree for preparation.

### Avoid a readiness cycle

Current paint-completion signals depend on mounted rows and contribution updates. Waiting for those signals while suppressing authoritative rows would deadlock.

Use authoritative document, syntax outcome, and structural data to decide when the first real presentation can be built. Then perform one synchronous commit:

1. Apply authoritative layout and reconcile the existing row slots.
2. Install authoritative text, highlights, gutter/fold paint, and scroll geometry.
3. Update required DOM-dependent contributions against those real rows.
4. Finalize the authoritative presentation, clear provisional data/resources, and publish actual paint readiness before yielding to the browser.

The existing atomic-render mechanism is a starting point. Today it primarily batches row renders; inspect direct style, gutter, decoration, selection, and plugin writes too. Every supported visible contribution must respect the same provisional/commit boundary. Do not hold an atomic transaction open across a promise or wait for already-painted events to begin it.

The commit selects the authoritative paint source before flushing rows, so its own provisional guard cannot suppress replacement. Retain the saved record locally until the commit succeeds. If a required contribution fails after rows change, finish a supported degraded authoritative frame or repaint still-eligible provisional state before yielding. Preserve the real document model and report the failure; do not retry indefinitely or leave partial real rows under a provisional flag. If neither presentation is valid, clear partial paint and expose an explicit failure state instead of publishing success.

A required contribution that cannot prepare from real data or finish synchronously against the newly mounted rows needs an explicit supported contract. Until then, that presentation cannot claim seamless restoration. Do not hide another overlay or indefinite completion wait behind the state model.

Prepared documents may make the authoritative frame ready immediately. Skip unnecessary provisional painting when the real frame wins; do not force an extra browser frame to demonstrate a cache hit. Supported plain/degraded syntax outcomes can complete normally. A timer must not fabricate readiness.

## Authoritative state stays separate

Data availability and presented geometry are different during restoration. Snapshot text never enters the editable buffer, highlighting workers, line indexes, or minimap input.

Model-only state may reflect the attached real document before the display changes. Geometry-dependent view subscriptions must not combine that document with provisional row metadata. They report unavailable/uncommitted geometry or wait for the first authoritative presentation, using a narrow native contract. Audit direct view-inspection and contribution calls as well as event subscribers.

Suppress misleading text-painted/highlight-painted diagnostics while only data has been prepared. Publish saved-paint visibility separately from authoritative data readiness and actual authoritative paint. This must not starve model-driven syntax work.

Input remains unavailable against provisional geometry. Use native editability/input ownership; no action queues for later replay and no command mutates a fake snapshot document. Release the restore-specific input restriction in the authoritative commit. Ordinary editors retain their existing input behavior.

Saved scroll applies once. After takeover, late snapshot or preparation completion cannot restore an old scroll position or selection. Existing session/buffer/view identity, replacement revision, incremental update, and prepared-transfer rules remain authoritative.

While provisional, freeze the presented viewport at its captured offset and extent. Wheel, touch, scrollbar dragging, programmatic scrolling, and pending live reveal requests must not expose uncached rows or move the saved geometry. Hold authoritative scroll/extent writes until replacement. Application navigation remains available. An explicit current document scroll target wins at commit; otherwise use the admitted saved position once.

## Format, appearance, and coverage

Editor owns the private format, decoder limits, and rendering rules. Platform validates only its identity envelope and total payload size. Start with compact JSON in an opaque string, with already resolved style runs and supported geometry. Intern repeated styles where useful; binary requires a measured benefit. Discard incompatible development cache entries without a migration decoder.

Capture reads committed mounted paint only when requested. It does not tokenize again or allocate a serializable frame on every keystroke. The record contains no arbitrary HTML, callback source, DOM nodes, or global browser highlight names.

Core CSS/theme/highlight setup stays inside the editor's rendering contract. The host supplies normal appearance settings and font assets. Admit saved paint against the effective theme, loaded font metrics, typography, tab/wrap settings, gutters/layers, viewport, and zoom-sensitive geometry. Initially decline incompatible absolute paint instead of rewrapping a partial document. Recheck relevant changes only while restoration is pending.

Use actual current native contribution configuration for admission. Cached widths alone cannot establish that a minimap or gutter setting still matches. Unsupported custom widget/gutter DOM remains a capture refusal until the package supplies a replayable native representation. Do not copy Platform's fold SVG or token-span renderer into another package.

The first scope restores main text, syntax, gutters, folds, and supported guides/decorations. Preserve shared highlight range ownership across editor instances. Reserve the minimap lane when current layout is known; cached minimap imagery is separate follow-up work.

The live minimap reads the complete authoritative document and correct line index. It may wait for committed geometry, but must never interpret visible snapshot rows as the whole file.

## Performance decision

Two implementations of this state model were compared:

| Candidate                                                           | Benefit                                                                      | Cost                                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Provisional state in the existing eagerly constructed Editor        | Smallest lifecycle change; existing synchronous API, view, and model remain. | Saved paint waits for the current Editor bundle and constructor to finish.                        |
| Early document-free native view, later supplied privately to Editor | Can show saved paint before full Editor construction and module evaluation.  | Requires a view-construction split, ownership transfer, and optional deferred mounting machinery. |

Choose the first candidate. The second remains a possible response to measured constructor cost, not part of this plan. Reintroducing it by default would repeat the lifecycle expansion the user rejected.

This first version primarily covers the gap between having the document and having its highlighted presentation, and also supports delayed file data. It does not promise paint before existing Editor initialization. Synchronous DOM insertion followed by a long constructor still delays browser paint. Measure the real cost before changing constructor or import boundaries.

Ordinary startup retains its synchronous behavior. The design may add a small restore-state check at the presentation boundary and some code bytes; those costs must be measured. It must add no snapshot conversion, full-frame allocation, per-character checks, or extra rendering pass to typing. After promotion, release restore-specific listeners, decoded data, and highlight memberships.

Do not claim zero overhead or a speedup merely because React no longer paints the cached rows.

## Implementation order and ownership

1. Record actual cached-first-paint, normal startup, live-ready, typing, scrolling, and capture baselines using the [editor-open benchmark](../apps/web/scripts/editor-open-benchmark.mjs) and running app.
2. Establish the native provisional/authoritative presentation boundary, including all supported visible contribution writes. Prove normal row/chunk reuse and update behavior before expanding the API.
3. Add bounded native capture/restore, attempt/generation tracking, and the synchronous first-authoritative commit. Prove empty-file handling and data-ready versus paint-ready ordering.
4. Wire the React host for both immediately available documents with delayed highlights and delayed file data. Preserve existing document/session/prepared-open semantics and native command API; add only restoration and eligibility synchronization.
5. Replace Platform's paint renderer and readiness logic. Keep identity, clean-file capture policy, storage limits, loading/retry UI, and actual file requests.
6. Verify actual browser frames and performance deltas against the recorded baseline before declaring the migration complete. Keep baseline artifacts, not compatibility implementations.

Editor owns snapshot validation, provisional state, native painting, readiness, and input/geometry ownership. React mounts and synchronizes the native instance. Platform owns persistence and external file authority.

The migration removes Platform's former `editor-visible-snapshot.tsx` renderer, paint-layer component, copied style/fold helpers, nested paint validation, opacity selector, readiness aggregation, and timeout/interaction dismissal. Ordinary editor view inspection and secondary-view contracts with real consumers remain.

## Proof required

- No doubled glyph/guide darkness, mixed provisional/real rows, second editor text tree, or blank frame during replacement.
- Default empty bootstrap preserves saved paint; an authoritative empty file replaces it.
- Mount with the real document available in the same turn and hold highlighting independently. Provisional paint must remain until real render data is ready; releasing highlights must replace it exactly once. If document and render data are both ready immediately, skip unnecessary provisional paint.
- Prepared data can take over immediately. Delayed syntax cannot deadlock waiting for a suppressed paint event.
- All supported direct row/style/layer writes respect the provisional presentation, including guides and selection paint.
- Inject a required contribution failure after real rows begin updating. The commit must finish a valid degraded frame, restore eligible provisional paint, or expose explicit failure without a mixed frame or silent stuck input.
- Slow loads beyond 1500 ms and former dismissal events retain eligible content without queuing input.
- Wheel, touch, scrollbar dragging, and pending programmatic reveals cannot scroll the provisional viewport into uncached space.
- Known revision mismatch, stale preparation, same-file buffer replacement, disposal, and same-host A → B → A navigation cannot publish the wrong generation.
- View consumers never receive real document text paired with provisional source geometry. Test the first actual click and edit after takeover.
- Complete minimap text/line counts remain correct for cold/warm/restored opens, delayed workers, and replacements with changed newline positions. Exercise minimap click and slider drag; retain the recent attachment/version regression tests.
- Multiple editor instances retain correct shared highlight resources through capture, replacement, and disposal.
- Compare distributions for actual first visible paint, normal startup, live readiness, typing, scrolling, and capture. Include code evaluation and constructor cost, not only native DOM drawing time.

Set performance tolerances from the baseline before implementation. A repeatable material regression in ordinary editing requires redesign. If current constructor cost prevents useful early paint, return with that measurement and a targeted design; do not silently expand this into the rejected staged lifecycle.

## Implementation handoff

Implement this design across `/work/projects/Editor` and `/work/projects/platform`. Scope is editor snapshot restoration and Platform integration, not the other milestones in Plan 085. Reconcile current source, package links, both worktrees, and the build served by the existing app before editing. Preserve unrelated work and use the running server. Store browser/profile artifacts under `/work/tmp/editor-provisional-paint/`.

Start by recording the immediate-document/delayed-highlights browser case and ordinary startup/typing baseline. Then establish the native presentation boundary and implement in the order above. Keep provisional data out of document/session/line-index state, preserve synchronous construction and incremental rendering, and replace paint in one commit based on render-data readiness. Do not use a separate preview owner, second editor text tree, or document arrival as the completion signal.

Complete the paired package/adapter/Platform migration and delete the superseded renderer in the same delivery. Run only the focused native, adapter, and browser checks that prove the listed behavior. Report changed files, baseline-versus-result timings, frame/minimap evidence, and any unsupported contribution or unfinished acceptance check. A typecheck alone does not complete this work.

## Workspace reload integration, 2026-09-21

Native snapshot format 3 includes diff gutter/row paint and visible selection rectangles. It captures
visible rows rather than overscan, and external presentation readiness keeps provisional paint until
diff syntax is ready. Provisional scroll survives document installation; unchanged projections do
not reinstall the native document and clear its selection. Platform retains saved paint through
failed revalidation, with an overlaid alert that preserves pane geometry. The
[delivery record](instant-reload-implementation.md) contains paired revisions and browser evidence.
