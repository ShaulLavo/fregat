# Performance Trace Report And Plan

## Scope

This report is based on the Chrome DevTools trace at:

`/Users/shaul/Downloads/Trace-20260520T074751.json`

Trace metadata:

- Source: Chrome DevTools trace events
- Trace start time: `2026-05-20T04:47:51.336Z`
- Captured app: `http://localhost:5173`
- Trace file size: about 70 MB
- Trace events: 314,756
- Recording window: about 20.1 seconds
- Main renderer process: `80180`
- Renderer main thread: `4368837`
- Renderer compositor thread: `4368874`
- Dedicated workers present:
  - `4395506`
  - `4408046`
- Host DPR: `2.200000047683716`

The trace and source URLs point at the Editor repo:

`/Users/shaul/Desktop/Editor`

This plan intentionally covers steps 1-4 only. Production testing / prod validation is excluded for now and should be handled later as a separate phase.

## Executive Summary

The app is slowed down by main-thread editor input work, not by network, layout, or paint.

The biggest bottleneck is the keyboard fallback path in `inputSelectionController.ts`. A zero-delay timer callback performs edit application and triggers a large cascade through session changes, rendering, syntax refresh, minimap updates, contribution notifications, and memory allocation. During the trace, those callbacks dominate long tasks and are amplified by severe V8 heap pressure and major garbage-collection pauses.

The highest priority is to make a single keypress cheap and bounded. After that, reduce allocations in the edit/render path, shrink minimap messages, and deprioritize expensive secondary work while the user is typing.

## Key Metrics From The Trace

Main-thread health:

- Trace window: about 20.1s
- `RunTask` count on renderer main thread: 649
- Total `RunTask` time: about 17.54s
- Long `RunTask` count, using >=50ms threshold: 25
- Total long-task time: about 17.17s
- Total blocking time estimate: about 15.92s
- Top long task: about 6.28s

Frame health:

- `BeginFrame`: 1,224
- `DroppedFrame`: 1,053
- Dropped-frame ratio: about 86%
- `DrawFrame`: 101
- `ActivateLayerTree`: 66

User-visible event latency:

- `keydown`
  - Count: 106
  - Max duration: about 4,344ms
  - p95 duration: about 2,876ms
  - Average duration: about 794ms
- `keypress`
  - Count: 106
  - Max duration: about 4,344ms
  - p95 duration: about 2,876ms
  - Average duration: about 794ms
- `keyup`
  - Count: 106
  - Max duration: about 4,125ms
  - p95 duration: about 2,718ms
  - Average duration: about 786ms
- `pointerdown` / `mousedown`
  - Count: 5 each
  - Max duration: about 3,362ms
  - Average duration: about 1,345ms
- `pointerup` / `mouseup` / `click`
  - Count: 5 each
  - Max duration: about 3,245ms
  - Average duration: about 1,285ms

The important detail is that most of the event duration is queueing delay. The browser is often waiting for already-running main-thread work to finish before it can process the next input.

## Main Thread Time Breakdown

Top renderer-main-thread trace event totals:

- `v8.callFunction`: about 18.30s
- `RunTask`: about 17.54s
- `FunctionCall`: about 17.22s
- `v8::Debugger::AsyncTaskRun`: about 17.00s
- `TimerFire`: about 15.08s
- `MajorGC`: about 9.19s
- `V8.GCCompactor`: about 8.78s
- `V8.GC_MARK_COMPACTOR`: about 8.77s
- `V8.GC_MC_MARK`: about 8.65s
- `EventDispatch`: about 1.10s
- `RunMicrotasks`: about 1.07s
- `PageAnimator::serviceScriptedAnimations`: about 1.04s
- `FireAnimationFrame`: about 1.03s
- `MinorGC`: about 0.90s
- `Paint`: about 0.14s
- `UpdateLayoutTree`: about 0.03s

Interpretation:

- JavaScript and GC dominate.
- Rendering/layout/paint are not the primary bottleneck in this capture.
- The app is saturated by long JavaScript tasks and heap churn.

## Top Long Tasks

The worst long tasks all point back to editor input handling.

Representative long tasks:

- At about 12.64s into trace:
  - Duration: about 6,281ms
  - Root: `TimerFire`
  - Main function call: `inputSelectionController.ts`
  - Source URL: `http://localhost:5173/@fs/Users/shaul/Desktop/Editor/packages/editor/src/editor/inputSelectionController.ts`
  - Vite output line/column: `662:59`
  - Source maps / original source indicate this corresponds to the `setTimeout` callback in `scheduleKeyboardTextFallback`
  - Included about 5,978ms of major GC / compaction

- At about 8.15s into trace:
  - Duration: about 1,308ms
  - Root: `TimerFire`
  - Same keyboard fallback source
  - Included about 996ms of major GC / compaction

- At about 10.26s into trace:
  - Duration: about 1,208ms
  - Root: `TimerFire`
  - Same keyboard fallback source
  - Included about 911ms of major GC / compaction

- At about 11.48s into trace:
  - Duration: about 1,159ms
  - Root: `TimerFire`
  - Same keyboard fallback source
  - Included about 893ms of major GC / compaction

- At about 3.68s into trace:
  - Duration: about 1,005ms
  - Root: `FireAnimationFrame`
  - Main function call: `packages/minimap/src/workerClient.ts`
  - Source location: `workerClient.ts:93:37`
  - Included about 999ms in minimap-related callback work

## Primary Source Locations

### Keyboard Fallback

File:

`packages/editor/src/editor/inputSelectionController.ts`

Important region:

```ts
private scheduleKeyboardTextFallback(event: KeyboardEvent, text: string): void {
  const start = eventStartMs(event);
  const nativeInputGeneration = this.nativeInputGeneration;

  this.options.el.ownerDocument.defaultView?.setTimeout(() => {
    const session = this.session;
    if (!session) return;
    if (!this.options.canEditDocument()) return;
    if (this.nativeInputGeneration !== nativeInputGeneration) return;

    const selectionChange = this.selectionChangeBeforeEdit();
    this.options.view.inputElement.value = "";
    this.options.applySessionChange(
      mergeChangeTimings(session.applyText(text), selectionChange),
      "input.keydownFallback",
      start,
    );
  }, 0);
}
```

Local file lines at time of analysis:

- `inputSelectionController.ts:866`: `handleKeyDown`
- `inputSelectionController.ts:883`: `scheduleKeyboardTextFallback`
- `inputSelectionController.ts:887`: zero-delay `setTimeout`
- `inputSelectionController.ts:893`: `selectionChangeBeforeEdit()`
- `inputSelectionController.ts:896`: `session.applyText(text)`
- `inputSelectionController.ts:895-899`: `applySessionChange(...)`

Why this matters:

- `setTimeout(..., 0)` puts the real input work into a later task.
- When the main thread is already busy, many input events queue.
- Each queued callback can perform a full edit/update cascade.
- The trace shows this timer path as the largest source of long tasks.

### Session Text Application

File:

`packages/editor/src/documentSession.ts`

Important region:

```ts
public applyText(text: string): DocumentSessionChange {
  const start = nowMs();
  if (text.length === 0) {
    return appendTiming(this.createChange("none", []), "session.applyText", start);
  }

  const result = applyTextToSelections(this.history.current, this.history.selections, text);
  return appendTiming(
    this.commitEdit(result.snapshot, result.selections, result.edits),
    "session.applyText",
    start,
  );
}
```

Local file lines:

- `documentSession.ts:139`: `applyText`
- `documentSession.ts:145`: `applyTextToSelections(...)`
- `documentSession.ts:147`: `commitEdit(...)`
- `documentSession.ts:251`: `setSelection`
- `documentSession.ts:259`: `setSelections`

Why this matters:

- Every fallback key path calls `session.applyText(text)`.
- The issue may not be the edit primitive alone, but the total cascade after it.
- This needs allocation and timing instrumentation.

### Apply Session Change / Render Cascade

File:

`packages/editor/src/editor/Editor.ts`

Important region:

```ts
private applySessionChange(
  change: DocumentSessionChange,
  totalName = "editor.change",
  totalStart = nowMs(),
  options: SessionChangeOptions = {},
): void {
  let timedChange = change;
  const renderStart = nowMs();
  this.renderSessionChange(change);
  timedChange = appendTiming(timedChange, "editor.render", renderStart);

  if (options.revealOffset !== undefined) {
    const revealStart = nowMs();
    this.view.revealOffset(options.revealOffset, options.revealBlock);
    timedChange = appendTiming(timedChange, "editor.reveal", revealStart);
  }

  if (options.syncDomSelection !== false) {
    const selectionStart = nowMs();
    this.inputSelection.syncDomSelection();
    timedChange = appendTiming(timedChange, "editor.syncDomSelection", selectionStart);
  }
  const finalChange = appendTiming(timedChange, totalName, totalStart);
  this.sessionOptions.onChange?.(finalChange);
  this.refreshSyntax(this.documentVersion, finalChange);
  this.notifyEditorFeatureContributions(finalChange);
  this.notifyViewContributions(viewContributionKindForChange(finalChange), finalChange);
  this.notifyChangeWithTiming(finalChange);
}
```

Local file lines:

- `Editor.ts:1113`: `applySessionChange`
- `Editor.ts:1121`: `renderSessionChange(change)`
- `Editor.ts:1137`: `refreshSyntax(...)`
- `Editor.ts:1138`: `notifyEditorFeatureContributions(...)`
- `Editor.ts:1139`: `notifyViewContributions(...)`
- `Editor.ts:1140`: `notifyChangeWithTiming(...)`
- `Editor.ts:1143`: `renderSessionChange`
- `Editor.ts:1156`: `projectTokensThroughEdit(...)`

Why this matters:

- A single text edit is not just a text edit.
- It renders, refreshes syntax, notifies multiple extension/contribution layers, updates view contributions, and emits timing.
- This is the core cascade to make cheaper or split across priorities.

### Token Projection

File:

`packages/editor/src/editor/tokenProjection.ts`

Local file lines:

- `tokenProjection.ts:25`: `projectTokensThroughEdit`
- `tokenProjection.ts:31`: `projectIndexedTokensThroughEdit`
- `tokenProjection.ts:34`: fallback to `scanProjectTokensThroughEdit`
- `tokenProjection.ts:59`: scan projection loop
- `tokenProjection.ts:68`: iterates over every token in fallback mode

Trace CPU samples:

- `appendUnchangedTokens`: about 1.16s sampled self time
- `appendShiftedTokens`: about 213ms sampled self time

Why this matters:

- Token projection is on the edit/render path.
- If the indexed path is missing or invalid, fallback scanning can become expensive on large token arrays.
- Even the indexed path may allocate heavily if it copies large unchanged ranges.

### Piece Table / Text Snapshot

Files:

- `packages/textbuffer/src/tree.ts`
- `packages/editor/src/documentTextSnapshot.ts`
- `packages/textbuffer/src/reads.ts`

Trace CPU samples:

- `collectTextInRange`: about 981ms sampled self time
- `getTextInRange`: about 308ms sampled self time
- `getPieceTableText`: about 191ms sampled self time

Why this matters:

- Text extraction from snapshots is showing up in hot samples.
- Repeated range extraction or full materialization during every keypress can create large strings and heap pressure.

### Line Start Index

File:

`packages/editor/src/virtualization/lineStartIndex.ts`

Local file lines:

- `lineStartIndex.ts:5`: constructor allocates `length + 1` array
- `lineStartIndex.ts:22`: `offsetAt`
- `lineStartIndex.ts:33`: `materialize`
- `lineStartIndex.ts:36`: maps entire `lineStarts`

Trace CPU samples:

- `LineStartOffsetIndex`: about 343ms sampled self time
- `offsetAt`: about 162ms sampled self time
- `materialize`: about 84ms sampled self time

Why this matters:

- Full line-start materialization during repeated edits can allocate large arrays.
- This contributes to GC pressure.

### Minimap

File:

`packages/minimap/src/workerClient.ts`

Important regions:

- `workerClient.ts:74`: `update(...)`
- `workerClient.ts:80`: `applyImmediateViewport(...)`
- `workerClient.ts:81`: `pendingUpdate = mergePendingUpdate(...)`
- `workerClient.ts:137`: `scheduleFlush`
- `workerClient.ts:140`: `requestFrame(...)`
- `workerClient.ts:146`: `flushPendingUpdate`
- `workerClient.ts:184`: `postUpdate`
- `workerClient.ts:210`: `singleLineEdit(change)`
- `workerClient.ts:219`: fallback to `replaceDocument`
- `workerClient.ts:267`: `documentPayload`
- `workerClient.ts:277`: `documentEditPayload`
- `workerClient.ts:285`: `decorations`
- `workerClient.ts:291`: `tokens`
- `workerClient.ts:411`: `post`

Trace CPU samples:

- Main-thread minimap client `post`: about 729ms sampled self time
- Minimap worker `globalThis.onmessage`: about 1.38s sampled self time
- One minimap animation-frame callback: about 999ms

Why this matters:

- Worker offload does not make large structured-clone messages free.
- Posting full text, full tokens, full line starts, or full decorations can block the main thread while serializing.
- Minimap work should be incremental and should never compete with keystroke responsiveness.

### Scope Lines / Merge Conflicts / Contributions

Files:

- `packages/scope-lines/src/index.ts`
- `packages/editor/src/mergeConflicts.ts`

Trace CPU samples:

- `scopeGuidePlacement`: about 416ms sampled self time
- `scopeGuideGeometryKey`: about 235ms sampled self time
- `scopeGuideGeometries`: about 205ms sampled self time
- `iterateLines` in merge-conflict parsing: about 454ms sampled self time
- `parseMergeConflicts`: about 113ms sampled self time

Why this matters:

- These are likely editor contribution layers notified after changes.
- They should not all run synchronously on every rapid keypress if they are not needed to show immediate typed text.

### Tree-Sitter Worker

Worker trace samples:

- `collectMatchCaptures`: about 1.80s sampled self time
- `postResponse`: about 1.26s sampled self time
- `web-tree-sitter.wasm`: about 1.46s sampled self time
- `collectCaptures`: about 243ms sampled self time
- `sortCaptures`: about 62ms sampled self time

Why this matters:

- Worker CPU does not directly block the main thread.
- It still competes for CPU and memory.
- Large worker responses can create main-thread pressure when received and applied.

## Garbage Collection Findings

Main-thread major GC:

- Count: 10
- Total: about 9.19s
- Max pause: about 1.45s

All renderer major GC:

- Count: 15
- Total: about 9.60s

Main-thread major GC types:

- `allocation failure`: 6
- `finalize incremental marking via stack guard`: 2
- `last resort`: 2

Representative GC events:

- About 16.29s into trace:
  - Duration: about 1,451ms
  - Type: `last resort`
  - Heap before: about 2,545 MB
  - Heap after: about 2,545 MB

- About 14.96s into trace:
  - Duration: about 1,323ms
  - Type: `allocation failure`
  - Heap before: about 2,545 MB
  - Heap after: about 2,545 MB

- About 17.74s into trace:
  - Duration: about 1,157ms
  - Type: `last resort`
  - Heap before: about 2,545 MB
  - Heap after: about 2,545 MB

- About 13.88s into trace:
  - Duration: about 1,079ms
  - Type: `allocation failure`
  - Heap before: about 2,562 MB
  - Heap after: about 2,545 MB

- About 8.17s into trace:
  - Duration: about 996ms
  - Type: `allocation failure`
  - Heap before: about 2,738 MB
  - Heap after: about 2,127 MB

Interpretation:

- The renderer is operating near multi-GB heap sizes during the trace.
- Several major GCs recover little memory, which suggests retained objects or long-lived large structures.
- The app must reduce allocations and retained data on the edit path. Optimizing layout/paint will not solve this class of slowdown.

## What Is Not The Main Problem In This Trace

Network:

- No resource timing pattern was visible as a bottleneck.
- The app was already loaded from localhost.

Layout and style:

- `UpdateLayoutTree`: about 31ms total.
- `Layout`: small.
- `PrePaint`: about 48ms total.

Paint:

- `Paint`: about 136ms total.

React rendering:

- React is involved in event dispatch and the app is running in dev mode.
- The trace does not point to ordinary component rendering as the main bottleneck.
- The dominant source is editor document/update internals and GC.

Extensions:

- React DevTools and another extension appear in the trace.
- React DevTools added measurable profiler/extension work.
- We are not doing the clean production retest yet, per current scope.

## Multi-Step Plan

### Step 1: Fix The Keyboard Fallback Input Path

Goal:

Make each keypress cheap, bounded, and non-accumulating. The zero-delay fallback timer should not become a queue of expensive full editor updates.

Primary files:

- `packages/editor/src/editor/inputSelectionController.ts`
- `packages/editor/src/documentSession.ts`
- `packages/editor/src/editor/Editor.ts`
- Existing editor input tests under `packages/editor/test`

Tasks:

1. Confirm why the fallback path is being used so often.
   - Determine when native `beforeinput` is skipped.
   - Check whether the focused input element path should allow native input for more cases.
   - Review `preventBrowserTextKeyDefault(...)` and `keyboardFallbackText(...)`.

2. Add focused timing instrumentation around the fallback path.
   - Time `selectionChangeBeforeEdit`.
   - Time `session.applyText`.
   - Time `mergeChangeTimings`.
   - Time `applySessionChange`.
   - Keep instrumentation lightweight and easy to remove or gate.

3. Prevent stale fallback callbacks from doing work.
   - Coalesce or cancel pending fallback callbacks when newer native input generation supersedes them.
   - Avoid running a fallback callback if the editor state already reflects the input.
   - Ensure repeated keypresses do not create a backlog of independent expensive timer tasks.

4. Consider replacing `setTimeout(..., 0)` with a more explicit scheduling model.
   - If fallback must wait for native input, use a single pending fallback slot instead of one timer per key.
   - If fallback does not need to wait, apply synchronously inside the key event only when safe.
   - If waiting is required, make the callback check state aggressively and exit quickly.

5. Keep the immediate typed-character path separate from secondary work.
   - The visible text update should happen first.
   - Syntax, minimap, scope lines, and non-critical contributions should not block the keystroke.

6. Add regression tests.
   - One test for fallback cancellation/coalescing.
   - One test for native input generation preventing stale fallback.
   - One test that rapid keydown sequences do not apply duplicate text.

Acceptance criteria:

- No single fallback keypress creates multiple edit applications.
- Rapid typing does not queue many expensive zero-delay callbacks.
- Existing keyboard behavior remains correct for normal text, space, IME/native input, and fallback text.
- Local test coverage passes for editor input behavior.

Expected impact:

- Removes the largest trace source: `TimerFire` / `input.keydownFallback`.
- Reduces input queueing delay.
- Reduces chance of multi-second long tasks.

Risks:

- Text input behavior can regress in browser edge cases.
- IME/composition/native input behavior must be handled carefully.
- The fallback path likely exists for real browser behavior, so changes need precise tests.

### Step 2: Reduce Allocations In Edit And Render

Goal:

Make a small text edit avoid large copies, full scans, and full materialization wherever possible.

Primary files:

- `packages/editor/src/editor/Editor.ts`
- `packages/editor/src/editor/tokenProjection.ts`
- `packages/editor/src/documentSession.ts`
- `packages/editor/src/documentTextSnapshot.ts`
- `packages/textbuffer/src/tree.ts`
- `packages/textbuffer/src/reads.ts`
- `packages/editor/src/virtualization/lineStartIndex.ts`

Tasks:

1. Instrument the edit/render cascade.
   - Measure `session.applyText`.
   - Measure `renderSessionChange`.
   - Measure `projectTokensThroughEdit`.
   - Measure `documentSessionChangeTextSnapshot`.
   - Measure line-start update/materialization.
   - Measure `refreshSyntax`.
   - Measure contribution notification time by contribution group.

2. Verify whether token projection is using the indexed path.
   - Check how often `projectIndexedTokensThroughEdit(...)` returns `null`.
   - If it falls back to `scanProjectTokensThroughEdit(...)`, find why the index is absent or not sorted.
   - Ensure token arrays preserve index metadata when copied/projected.

3. Reduce token projection allocation.
   - Avoid copying unchanged token ranges more than necessary.
   - Preserve structural sharing where safe.
   - Avoid full token-array scans for single-character edits in large documents.
   - Keep live range correctness intact.

4. Reduce text snapshot/string extraction.
   - Audit repeated `getTextInRange` and full string materialization on the edit path.
   - Prefer snapshot/range APIs over building full strings.
   - Avoid creating large temporary strings for work that can operate on the piece table.

5. Reduce line-start materialization cost.
   - Avoid `lineStarts.map(...)` over the full file during rapid single-line edits when possible.
   - Preserve lazy offset updates longer.
   - Materialize only when a consumer truly needs a full array.

6. Split mandatory render work from optional notifications.
   - The minimum path for one typed character should update document state and visible view.
   - Non-critical features should be scheduled after the frame or after the input burst.

Acceptance criteria:

- A single-character edit in a large document does not allocate proportional to full document size unless unavoidable.
- Token projection stays on the indexed/incremental path for normal typing.
- Line-start updates do not force full-array materialization on every keypress.
- Heap growth during rapid typing is materially lower.

Expected impact:

- Reduces major GC frequency and pause length.
- Reduces long-task duration even when the fallback path is triggered.
- Makes Step 1 durable rather than just moving the bottleneck.

Risks:

- Token projection correctness is subtle.
- Text snapshots and line starts are shared infrastructure.
- Need focused unit tests around edits near token boundaries, line boundaries, folds, and selections.

### Step 3: Make Minimap Updates Incremental And Smaller

Goal:

Ensure minimap updates never block the main thread for hundreds of milliseconds or post huge structured-clone payloads during typing.

Primary files:

- `packages/minimap/src/workerClient.ts`
- `packages/minimap/src/minimap.worker.ts`
- `packages/minimap/src/renderer.ts`
- Minimap tests under `packages/minimap` and editor integration tests that cover minimap behavior

Tasks:

1. Add instrumentation around minimap payload building and posting.
   - Time `documentPayload(snapshot)`.
   - Time `documentEditPayload(snapshot)`.
   - Time `decorations(snapshot)`.
   - Time `tokens(snapshot.tokens)`.
   - Time `worker.postMessage(request)`.
   - Log payload type and approximate sizes in dev diagnostics.

2. Verify update classification.
   - Confirm normal single-character typing hits `singleLineEdit(change)`.
   - Identify cases that fall back to `replaceDocument`.
   - Fix classification if simple edits are incorrectly treated as full replacement.

3. Avoid full payloads during frequent typing.
   - Do not send full `text`, full `lineStarts`, full `tokens`, or full decorations unless required.
   - Prefer edit deltas, selection deltas, viewport deltas, and token deltas.
   - Ensure `updateSelection` remains cheap.

4. Throttle or defer minimap rendering during input bursts.
   - Let immediate viewport/selection feedback stay cheap.
   - Defer expensive background/image rendering until after a quiet period or idle slot.
   - Drop obsolete pending minimap renders when newer edits arrive.

5. Review worker response size and main-thread handling.
   - Ensure responses from the worker are not creating new main-thread pressure.
   - Avoid transferring large image data repeatedly if it can be reused or transferred.

Acceptance criteria:

- Minimap `postMessage` is not visible as a major main-thread CPU sample during typing.
- Single-line edits use incremental minimap messages.
- Full document replacement is rare and intentional.
- Minimap can lag briefly during rapid typing, but editor input stays responsive.

Expected impact:

- Removes the ~999ms minimap animation-frame spike.
- Reduces structured clone and worker-message overhead.
- Reduces memory churn from repeated full minimap payloads.

Risks:

- Incremental minimap state can drift if deltas are incomplete.
- Need versioning/sequence checks to discard stale worker responses.
- Visual minimap correctness must be verified after edits, scroll, theme changes, and token updates.

### Step 4: Deprioritize Syntax, Tree-Sitter, Minimap, And Contribution Refresh During Rapid Typing

Goal:

Protect input responsiveness by moving non-critical work out of the immediate keystroke task.

Primary files:

- `packages/editor/src/editor/Editor.ts`
- `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts`
- `packages/tree-sitter/src/treeSitter/source.ts`
- `packages/scope-lines/src/index.ts`
- `packages/editor/src/mergeConflicts.ts`
- `packages/minimap/src/workerClient.ts`
- Feature contribution infrastructure under `packages/editor/src`

Tasks:

1. Classify work after `applySessionChange`.
   - Immediate:
     - update editor document state
     - update visible text
     - maintain selection correctness
     - keep undo/history correct
   - Deferred:
     - syntax refresh
     - tree-sitter capture collection
     - minimap full render
     - scope line recomputation
     - merge conflict scanning
     - expensive contribution notifications

2. Introduce a scheduler for editor secondary work.
   - Coalesce work by document version.
   - Cancel stale work when newer edits arrive.
   - Run lower-priority work in `requestIdleCallback`, delayed tasks, or a project-local scheduler abstraction.
   - Keep deterministic behavior in tests.

3. Add version guards.
   - Every deferred result must check document version before applying.
   - Worker responses should be ignored if stale.
   - UI should never flicker back to old syntax/minimap/contribution state.

4. Reduce tree-sitter response pressure.
   - Avoid sending huge response payloads if the result is obsolete.
   - Batch or chunk expensive capture collection.
   - Consider limiting parse/capture work while rapid input is active.

5. Defer expensive contribution work.
   - Scope lines should not recompute synchronously for every keypress.
   - Merge conflict scanning should not scan the full document during normal typing unless relevant.
   - Contributions should receive enough information to skip irrelevant changes.

Acceptance criteria:

- Typing stays responsive while syntax/minimap/scope lines may update slightly later.
- Deferred work is coalesced and stale-safe.
- No stale worker or contribution result can apply to a newer document version.
- Tests cover versioning and cancellation behavior.

Expected impact:

- Keeps the main thread available for input.
- Reduces contention from tree-sitter and minimap during edit bursts.
- Smooths frame delivery by spreading non-critical work across time.

Risks:

- Some features may currently assume synchronous update order.
- Deferred rendering may expose race conditions.
- Need careful version checks and deterministic tests.

## Suggested Implementation Order

1. Add temporary local instrumentation first.
   - Keep it behind a dev flag or remove before final merge.
   - Purpose: prove which sub-call dominates after the known trace-level bottleneck.

2. Implement Step 1.
   - Fix/coalesce/cancel keyboard fallback scheduling.
   - Add tests before broader refactors.

3. Re-run a local trace in the same dev scenario.
   - This is not production testing.
   - Goal: verify `TimerFire` no longer dominates.

4. Implement Step 2.
   - Target the largest allocation points revealed by instrumentation.
   - Start with token projection and line-start/text snapshot materialization.

5. Re-run local trace.
   - Goal: verify lower heap growth and fewer major GCs.

6. Implement Step 3.
   - Shrink minimap payloads and defer/drop obsolete minimap renders.

7. Re-run local trace.
   - Goal: verify minimap is no longer visible as a long animation-frame task.

8. Implement Step 4.
   - Add scheduler/coalescing/version guards for deferred editor features.

9. Re-run local trace.
   - Goal: verify input latency, long tasks, GC, and dropped frames are all materially improved.

## Local Verification Targets

Use the same kind of development scenario first, because this trace came from localhost/dev mode.

Targets after Step 1:

- `TimerFire` no longer dominates the profile.
- No multi-second `input.keydownFallback` tasks.
- `keydown` / `keypress` max latency should drop sharply.

Targets after Step 2:

- Major GC count and duration should drop.
- Heap should not repeatedly climb into the 2.5-2.9 GB range during the same scenario.
- Token projection / line-start / piece-table functions should not dominate sampled self time.

Targets after Step 3:

- Minimap `postMessage` and worker response work should not appear as large main-thread samples.
- No ~1s minimap animation-frame callback during typing.

Targets after Step 4:

- Syntax/tree-sitter/minimap/scope-lines work should be coalesced and stale-safe.
- User input should remain responsive while secondary views catch up.

## Metrics To Capture On Each Re-Trace

For each local trace, record:

- Trace duration
- Long task count >=50ms
- Total long-task time
- Estimated total blocking time
- Max `RunTask`
- Top 10 main-thread function locations by total duration
- Major GC count
- Major GC total duration
- Max major GC duration
- Heap before/after major GCs
- `keydown`, `keypress`, `keyup` max/p95/avg EventTiming duration
- Dropped frames / begin frames ratio
- Minimap `postMessage` samples or measured time
- Tree-sitter worker busy time

## Important Constraints

- Do not jump to production testing yet.
- Do not rely on layout/paint tuning as the primary fix.
- Do not assume the worker is free; worker messages and responses can still block or pressure memory.
- Do not make input correctness worse to gain speed.
- Keep all changes testable and incremental.

## Open Questions

1. Why is the keyboard fallback path being exercised for so many key events?
2. Is the editor intentionally preventing native text input for most text keys?
3. Are token indexes missing or invalidated too often?
4. Which contribution notifications are required synchronously after an edit?
5. How large are minimap payloads during a normal single-character edit?
6. Which objects retain the multi-GB heap after major GC?
7. Are tree-sitter responses applying stale work after newer document versions?

## Current Best Hypothesis

The dominant issue is a synchronous edit/update cascade being run from queued fallback keyboard timer callbacks. Each callback touches large editor state, allocates heavily, and triggers syntax/minimap/contribution work. Because the heap is already very large, V8 repeatedly enters major GC, including allocation-failure and last-resort collections. That makes individual callbacks last hundreds of milliseconds to multiple seconds, which queues more input behind them and causes visible typing and clicking lag.

The fix should start at the input path, but it must also reduce edit/render allocations and move secondary work out of the critical keystroke path.
