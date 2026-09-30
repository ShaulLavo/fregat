# E051: Fast paths pinned to their slow paths

Implemented 2026-09-21 in Editor `7a37f10`. Where the core answers one question two ways, a test
proves the answers agree.

- The incremental row-layout patches (`sameLineEditPatch`, `multiLineEditPatch`) ask the projection
  `supportsIncrementalRowPatch`. The list of features the fast path cannot handle (folds, wrap,
  inline maps, injected rows) lives in `DisplayProjection`, so a new projection kind cannot slip
  past a hand-kept gate.
- `test/fastPathEquivalence.test.ts` drives seeded random edits over plain, fold, wrap, inline,
  injected and combined projections and asserts the patched rows equal a full layout. It runs
  three fixed seeds plus one random seed; `E051_SEED` replays a failure.
- One display-row to buffer-row converter serves row reconciliation and decoration lookup.
- `scheduleFrame` (`packages/editor/src/editor/scheduleFrame.ts`) replaces the duplicated
  `requestAnimationFrame` shims and returns a cancellable handle. Scope lines always defers through
  it, so tests and production take the same path.
- The syntax controller's one-shot skip latches became a comparison against the prepared session's
  content version.

Validation: the equivalence suite, `scheduleFrame.test.ts`, the prepared-document and
provisional-paint tests, and the scope-lines plugin test.
