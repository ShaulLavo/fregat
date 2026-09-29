# E023: Inspect editor timing and retained memory

- Status: Approved
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: M
- Dependencies: [E001](../examples/stress/README.md)
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`

Decided 2026-09-25: owner — parked. Not scheduled until the owner revisits it.

## Outcome

Open one diagnostic panel and see which editor operation is slow and which subsystem retains
resources. Filter recent operations, inspect a timing breakdown, and export a small reproducible
capture. Keep diagnostics cheap when disabled and bounded when someone leaves the panel open.

## Current code

- [Performance diagnostics](../packages/editor/src/editor/performanceDiagnostics.ts) already
  supply an opt-in global sink and lazy detail construction. This is a seed, not a per-editor panel API.
- [Logging](../packages/editor/src/logging/index.ts) and
  [its evlog adapter](../packages/editor/src/logging/evlog.ts) provide existing event boundaries.
- [The debug export](../packages/editor/src/debug.ts) exposes piece-table inspection and has
  a deprecated containment comment. It does not define a registry of switchable debug flags.
- [Tree-sitter results](../packages/tree-sitter/src/treeSitter/types.ts) already include timings;
  [the worker client](../packages/tree-sitter/src/treeSitter/workerClient.ts) owns worker requests.
- [E001](../examples/stress/README.md) supplies repeatable scenarios and measurement definitions.

Inventory real emitters and available counters before promising panels. JavaScript does not expose
an exact per-subsystem allocator ledger or arbitrary click-to-allocation source mapping by default.

## Scope

Deliver a reusable diagnostic collector and standalone Editor example panel: searchable event
names, pause/resume/clear, bounded capture, timing details, supported retention counters, and export.
Use declared controls only where a real consumer exists. Platform integration and persisted user
settings are separate host work; a panel-local filter is not a new global configuration system.

## Design

Use explicit editor/document/runtime identity so concurrent editors cannot share an accidental
active-editor global. Adapt existing emitters to a scoped collector at the owning boundary.
Choose one event schema with operation/revision identifiers, duration units, subsystem, outcome,
and optional counters. Correlate worker durations without subtracting unrelated process clocks.

Store small records in a capped ring with dropped-event counts. Do not retain document snapshots,
DOM nodes, source text, worker payloads, or editor instances in event details. Labels distinguish
exact counts, estimated bytes, unsupported metrics, and aggregate heap observations. Logical text
bytes and physical retained buffers differ when snapshots share storage.

Render the panel in bounded batches, virtualize long event lists, and use tabular numerals for
updating values. Disabling collection prevents detail construction and unsubscribes optional probes.
Panel visibility, recording, and timing instrumentation are separate states with explicit lifetimes.

## Steps

1. Map existing timing/logging events to the E001 scenarios. List missing attribution and
   counters, their owners, sampling cost, and whether values are exact or estimates.
2. Define and prove the bounded collector, stable export format, scoped subscriptions, and
   lifecycle. Preserve one operation's context when integrating existing wide events.
3. Wire timing and resource probes incrementally. Reuse counters from E005/E006 if available;
   their deep inspector is optional and must not become a hidden hard dependency.
4. Build the standalone example panel with keyboard access, filtering, pause, and export.
   Show unsupported memory metrics explicitly rather than displaying misleading zero values.
5. Measure disabled, recording-only, and visible-panel overhead on E001 typing and scroll cases.
   Document the instrumentation cost beside exported results and remove probes that distort them.

## Verification

Prove ring capacity and dropped counts, independent collectors for two editors, stable export,
and release after disposal. A disabled detail callback must not execute. Export validation must
reject retained source payloads and non-serializable references rather than stringify arbitrary objects.

Use the real-browser core test project for keyboard navigation and an open panel during typing,
scrolling, and document replacement. Verify bounded event/list growth during a sustained capture.
Acceptance requires useful attribution of a known slow control case and measured overhead within
an agreed tolerance; counting animation frames alone does not measure input-to-visible-paint latency.

## Risks and decisions

Sampling can hide outliers; retain exact slow-operation records within a bounded policy and label
aggregations. Decide export schema evolution when implementing; no compatibility migration is
needed now. Keep the panel's diagnostics API narrow and avoid making internal piece-tree types
part of every consumer's public contract.
