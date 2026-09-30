# Progress

Last reconciled: 2026-08-27

## Status

The original storage, anchors, selection, Tree-sitter, display-transform, and
browser-virtualization phases are implemented. The later Monaco/CodeMirror
parity programme completed M1-M16 and both review passes; its executable plan
was deleted under repository policy. BiDi geometry Tiers A and B are also
complete. The old instruction to start Phase 4 Tree-sitter work was stale and
has been removed.

Cross-project execution order is authoritative in
[Platform's `PLAN.md`](../platform/PLAN.md). This file records Editor state; it
does not define another sequence.

## Completed Baseline

- E002 input-latency work completed on 2026-09-07: correlated input/view/deferred diagnostics,
  bounded source-range indexing, and document-generation guards are live. The
  [local browser gate](examples/stress/results/input-latency/README.md) accepts the optimized candidate
  and independent unchanged run across 108 blocking timing limits, and detects a real 20 ms delay
  in every dispatch group. Screenshot timing is advisory; one excess remains recorded. Mounted
  geometry buffers and chunk reuse cut long-line multiple-view dispatch p95 from 4.1 to 2.7 ms
  for typing and 9.8 to 6.9 ms for paste. Calibration uses the controls' full observed timing range;
  earlier failures and runs affected by concurrent checkout edits remain preserved.
  Lasting contracts live in
  [the measurement reference](docs/performance/input-latency.md); the executable plan was deleted.
- Persistent piece-table documents, durable anchors, multi-selection editing,
  undo/redo, folds, wrapped and virtualized rendering, minimap, diff, and merge
  editing are live.
- Tree-sitter syntax, highlighting, structural selection, indentation,
  injections, bracket/tag matching, worker scheduling, and stale-result guards
  are live.
- Language configuration, auto-close/type-over/surround, snippets with linked
  mirrors, completion filtering and resolution, signature help, document links,
  semantic tokens, word-part and line operations, column selection, cursor
  history, and clipboard behavior are live.
- Editor documents support multiple views and explicit read-only editability.
- BiDi geometry Tiers A and B are complete: browser-derived run geometry,
  affinity-aware caret placement and hit testing, visual character-step motion,
  pixel-goal vertical movement, and RTL-safe selection paint are live. Permanent
  behavior is documented in
  [`docs/editing/selections-and-undo.md`](docs/editing/selections-and-undo.md) and
  [`docs/display/browser-virtualization.md`](docs/display/browser-virtualization.md).
- Broad block-surface APIs and temporary recovery bridges were deliberately
  removed. They are not compatibility targets.
- Typed transactional WorkspaceEdit parsing, planning, inversion, and document application are live
  and consumed by Platform's transaction coordinator.

## Active Executable Work

The remaining shared work is scheduled by the [Platform roadmap](../platform/PLAN.md): visible
snapshot persistence, prepared editor opens, the diagnostic-peek composition gate, and the final
editor-native keymap takeover. Each relevant milestone must verify both repositories in lockstep.
There is no active standalone Editor plan.

The [Editor backlog](plans/README.md), authored on 2026-09-05, turns all 22 topics from
[`TODO.md`](TODO.md) into 30 stable entries, including completed implementation references.
It records suggested priorities and dependencies; it does not schedule implementation.

## Superseded Sources

- `docs/parity-plan.md`: deleted after completion; Git history is the archive.
- [`docs/architecture-recovery-plan.md`](docs/architecture-recovery-plan.md):
  retained for architectural rationale, superseded as an execution source.
- Older phase-by-phase validation logs in this file: superseded by the live
  packages, focused tests, and commit history.

## Verification Boundary

- Pure Editor behavior: run the narrow package test and typecheck that could
  catch the change.
- Geometry, paint, hit testing, clipboard, or browser-worker lifecycle: use the
  real-browser Vitest project.
- Architecture-sensitive changes: run `bun run health` in addition to the
  focused checks.
- Cross-project contracts: verify the Editor producer first, then the Platform
  contracts/server/web consumer and the already-running app. Do not leave a
  compatibility alias between repositories.
