# Plan 125: Reduce logging and measurement overhead without losing failure evidence

Status: implementation deployed and production checks passed 2026-09-20.
Development baseline and live mock-provider streaming evidence remain pending. Requested 2026-09-20.

Implementation: [observability admission and retention](../docs/observability-overhead.md).
Evidence: `/work/tmp/fregat-evidence/plan125-20260920/`. Keep this plan until its remaining
evidence gates are satisfied; do not read the original checklist below as an updated completion ledger.
Planned against Platform `9a7d77d2`, with unrelated working changes present.
Priority: P1. Effort: M. Risk: medium, because filtering can hide failures.

Root `PLAN.md` owns scheduling. This plan owns its internal execution order and does not
reorder other work. Reconcile overlapping observability helpers with Plan 091 and verification
tooling with Plan 119; neither requires an unrelated refactor before this work can start.

## Outcome

Normal app use should pay for useful operation summaries and actionable failures. Detailed
editor events, console formatting, render counts, and traces should require deliberate activation.
Disabled diagnostics should stop before payload construction, sanitization, serialization, timers,
or geometry reads. Preserve application behavior and enough context to diagnose failures.

This is a measured reduction of unnecessary work, not a request to remove all instrumentation,
move it wholesale into a worker, replace evlog, or add another telemetry service.

## Evidence and limits

The 2026-09-20 development run opened a file and scrolled down and back. Evidence:
`/work/tmp/fregat-evidence/20260920T050018Z-trace-editor-fast-scroll/`.
Read `summary.md`, `trace-summary.json`, `trace.json`, and `page.png`.

- The run completed in 4252.6 ms, with 1040 ms scripting, 167 ms layout, and 336.1 ms paint.
- Three tasks attributed approximately 10.5, 19.3, and 13.8 ms of sampled intervals to
  `emitClientLog`, including its callees. Logger stacks include `prettyPrintWideEvent` and
  `writeLine`. These are inclusive sampling estimates, not measured exclusive function time.
- This is one development run under browser automation, with console capture, other app activity,
  and GPU warnings. It establishes a suspect, not a production slowdown or a promised speedup.
- A shared-log snapshot contained 1880 events / 1,554,934 bytes in ten minutes. Other app/test
  instances contributed. Do not use that total as this user's event rate or this scenario's rate.
- Production already suppresses console output. Shared server defaults sample info at 25%, debug
  at 0%, and retain warnings/errors. Client preparation and upload happen before server sampling.
- Detailed editor frame/long-task tracing is already opt-in through `editorPerfTrace`.

## Current implementation and hazards

| Owner                                                                                     | Current behavior / what to check                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/lib/client-logging.ts`                                                      | Configures browser evlog and HTTP drain; creates event IDs and sanitizes before evlog checks minimum level. `observeClientOperation` prepares success summaries even when logging is disabled. Preserve its error annotation and abort handling. |
| `apps/web/src/lib/wide-event-scope.ts`                                                    | Adds environment context and creates a shared scope. It is a separate emission path from `log.info`.                                                                                                                                             |
| `packages/observability/src/scope.ts`                                                     | Sanitizes scope updates, merges fields, counts events, emits at completion. Late warnings/errors must survive routine-success sampling. Check long-lived scope growth.                                                                           |
| `packages/observability/src/config.ts`, `runtime.ts`, `env.ts`                            | Existing sampling, batching, console policy, file retention, optional remote drain, and master switch. Do not assume stored event count equals work avoided.                                                                                     |
| `apps/server/src/observability/client-ingest.ts`                                          | Validates and sanitizes client input, hashes dedupe IDs, then emits through evlog. Keep this independent trust boundary.                                                                                                                         |
| `apps/server/src/observability/logging.ts`, `runtime.ts`, `elysia.ts`                     | Request summaries and persistence filters. Health/ingest/dashboard success filters currently act late; investigate cost before moving them.                                                                                                      |
| `apps/web/src/features/editor/utils/plugins.ts`                                           | Installs Editor logging plugins. The callback caches scroll context before filtering; disposal removes cache entries. `editorLogLevel` promotes non-warning/error events to info while payload level can say debug. Audit this mismatch.         |
| `apps/web/src/features/editor/state/performance-trace.ts`                                 | URL-activated trace, frame loop, observers, event arrays, stop lifecycle. Verify bounded retention and complete teardown.                                                                                                                        |
| `apps/web/src/features/editor/hooks/use-row-height-audit.ts`, `utils/row-height-audit.ts` | Initial-paint diagnostic reads computed styles and all mounted row rectangles. Preserve mismatch warnings; do not mistake it for a per-frame loop.                                                                                               |
| `apps/web/src/features/workbench/state/snapshot-capture.ts`                               | Snapshot persistence emits an unconditional `performance.measure('editor.visible_snapshot.capture', ...)`. Check consumers and retention before gating/clearing it; snapshot persistence itself is product behavior.                             |
| `apps/web/src/features/chat/utils/pipeline-logging.ts` and transport callers              | Chat summaries and lifecycle scopes. Audit stream update frequency without conflating conversation data with diagnostic logs.                                                                                                                    |
| `apps/web/src/lib/coalesced-log.ts`                                                       | Existing debounce queue; repeated events reset timers and can postpone a flush indefinitely. Reuse only if those semantics fit.                                                                                                                  |
| `apps/web/src/features/logs/`, `apps/server/src/observability/log-reader.ts`              | Separate cost of viewing/tailing logs. Verify active-only subscriptions, bounded cache/list growth, and file scan cost.                                                                                                                          |
| `scripts/agent/browser.ts`, `observe.mjs`, `trace-profile.ts`, `trace-summary.ts`         | External browser recording and reporting. Capture itself can add overhead. Keep it outside normal app execution.                                                                                                                                 |

Reconcile these excerpts against current code before editing:

```ts
// apps/web/src/lib/client-logging.ts:120
function emitClientLog(level: ClientLogLevel, event: ClientLogInput): void {
  if (!clientLoggingEnabled()) return
  try {
    evlog[level](safeClientEvent(withClientEventId(event)))
  } catch {
    // Logging must never affect user-facing app flows.
  }
}

// apps/web/src/features/editor/utils/plugins.ts:245
function logEditorEventToConsole(event: EditorLogEvent): void {
  cacheEditorScrollPosition(event)
  if (event.action === 'editor.viewport.changed') return
  // Filtering and emission follow; disposal must still release cached context.
}
```

The callback currently retains diagnostic scroll context, not demonstrated application scroll
persistence. Trace its consumers before removing anything; preserve failure context and cleanup.
Check upstream Editor producers too: filtering at this callback cannot avoid payloads they already built.

## Boundaries and conventions

- Work in the current checkout, preserving other people's dirty files. No branch, commit, push,
  dependency upgrade, or PR is required by this plan. Capture `git status --short` at entry.
- Primary edits belong to the owners above, their direct producer callers, and focused tests.
  New shared pure policy belongs in `packages/observability`; mutable configuration/subscriptions
  belong in state modules, never `utils/`. Respect Platform's two-consumer rule for web `lib/`.
- Use the TypeScript, never-nester, and verify-fregat skills. Keep nesting at most three levels.
  No compatibility aliases or parallel logging frameworks. Migrate changed call sites together.
- Retain structured errors, sanitization, redaction, event identity, environment attribution,
  cancellation classification, and retry deduplication. Do not merge divergent sanitizers by name.
- A new user-facing control must be a wired registry setting in
  `packages/contracts/src/settings/keys.ts`, read through `useSettingValue` or `readSettingsMirror()`.
  Prefer one application-scoped diagnostics mode, default off, over numerous independent knobs.
  Reuse existing deployment environment controls; do not introduce a new env/localStorage setting.
- Trace URL activation remains an explicit diagnostic path, not a competing persisted preference.
  Document precedence between that activation, diagnostics mode, and the existing master switch.
- No native Swift/TUI instrumentation rewrite, terminal renderer rewrite, log dashboard redesign,
  general Editor performance work, new log database, or remote telemetry setup.
- Linked Editor/Ghostty sources are audit dependencies. If producer gating needs changes there,
  record exact ownership and revision, read their instructions, and scope the paired change explicitly
  before proceeding. Do not disguise a host-side filter as elimination of package-side work.

## Execution checklist

### 1. Inventory every runtime path and establish reproducible controls

- [ ] Record HEAD, dirty files, linked package revisions, actual dev/production logging configuration
      without secret values, release identity, browser/GPU, and console-capture mode.
- [ ] Search production source for logger calls, scope factories, performance marks/measures,
      observers, profiler hooks, diagnostic timers, geometry audits, and console output. Exclude tests
      and build tools, then inspect those separately for accidental inclusion in the app bundle.
- [ ] Write a census beside the evidence: owner, trigger/frequency, dev/prod default, gate location,
      payload cost, retained state bound, teardown, consumer, and keep/change/defer reason. Cover web,
      server, shared packages and linked Editor/terminal producers used by web. No unclassified match.
- [ ] Attribute logs by client instance and exact time window. Record events, bytes, requests,
      logger sampled time, long tasks, and retained diagnostic entries. Measure server CPU/file scan
      work separately from browser work. Separate idle background activity from interaction bursts.
- [ ] Capture at least three matched warm runs before/after for performance claims. Use the same
      file, workspace, browser/GPU, build mode, scenario, and capture settings. Record cold opens separately.
      Add a capture-without-console-listeners control to the existing CLI if needed; do not assume its
      current console listener is free. Compare dev and production separately.
- [ ] Cover idle; file open/close churn; scrolling; typing; caret movement; paste; theme preview;
      chat streaming; terminal output; logs view open/closed; and hide/resume/reconnect. Existing drives
      include `editor-fast-scroll`, `editor-type-burst`, `editor-caret-burst`, `editor-large-paste`,
      `editor-theme-preview`, `page-lifecycle`, and `logs-search-no-flicker`. Add missing bounded scenarios
      using disposable fixtures and existing mock provider support, without starting paid agent turns.

Verify: `bun run agent:browser look --doctor` reports ready/healthy;
`bun run agent:browser list` contains each selected scenario. Run
`bun run agent:browser trace editor-fast-scroll --file=apps/web/src/features/workspace/hooks/use-events.ts`
and equivalent commands for the matrix. Evidence must include the census and repeated run IDs.
Do not restart or create a dev server. Report an unavailable target as blocked evidence.

### 2. Decide admission before doing diagnostic work

- [ ] Make level, mode, and routine-event sampling decisions before IDs, payload factories,
      environment enrichment, sanitizer traversal, and serialization. Keep policy resolution cheap;
      avoid repeatedly parsing configuration for each event.
- [ ] Preserve warnings/errors and slow/failing operation summaries. Separate optional successful
      detail from the minimal state needed to classify a late failure. Never decide at operation start
      that its eventual failure will be dropped. Do not double-sample client events on the server.
- [ ] Handle both direct logger calls and wide scopes. Do not silently redefine diagnostic counters
      that application code reads. Prove their consumers before replacing them with no-ops.
- [ ] If lazy payloads are needed, introduce one typed path and migrate the hot callers in the same
      pass. Fix actual hot producers; avoid converting every cold event into callback ceremony.
- [ ] Ensure master-off initialization creates no unnecessary drain, visibility listener, or timer.
      Preserve `observeClientOperation` execution, return values, errors, and error annotation.
- [ ] Default console output to actionable warnings/errors. Verbose diagnostic output is explicit;
      normal operation summaries may still reach the structured log. Keep development usable for debugging.
- [ ] Specify defaults and precedence in the census before wiring a diagnostics setting. If added,
      wire its consumer immediately and regenerate settings schema/reference artifacts.

Verify with focused regression tests: filtered payload callbacks never execute, no event ID is
allocated for filtered events, error/abort behavior is unchanged, production levels are honored,
and a scope that starts successfully but fails later still emits its structured failure. Include an
integration using real evlog; a mock logger cannot prove evlog level/sampling behavior.

### 3. Remove repeated work at the producers

- [ ] Classify noisy editor theme, minimap, syntax, plugin, viewport and lifecycle events. Keep a
      bounded operation/lifecycle summary where it answers the same question. Fix method/payload level
      disagreement. Keep disposal cleanup and useful scroll context even when output is suppressed.
- [ ] Aggregate stream/keystroke/frame repetition as counters and bounded timing summaries when
      needed. Do not create full records per update just to discard them later. Do not log user content.
- [ ] Gate measurement-only marks, observers, arrays and geometry scans before their work begins.
      Preserve functional snapshot capture, scroll persistence, rendering and layout correctness.
      Keep the initial-paint row mismatch diagnostic unless a measured equivalent replaces it.
- [ ] Verify trace stop/restart, editor disposal, route changes and visibility changes release
      subscriptions/timers. Bound diagnostic arrays, maps and User Timing entries during long sessions.
      Clear only owned marks/measures after consumers have read them; never clear all browser timings.
- [ ] For continuous streams, use bounded periodic/lifecycle flushing rather than debounce-only
      queues that never settle. Keep failures visible without waiting for a long-lived connection to close.

Verify: repeat the same traces with `--compare <matching-baseline-directory>`; run
`bun run agent:browser scenario editor-row-height-audit` to prove mismatch evidence survives.
Add a repeated open/close and diagnostic start/stop drive that reports stable retained counts.
Normal typing/scrolling/streaming must not produce routine per-update uploads by default.

### 4. Check delivery, storage and the log viewer independently

- [ ] Retain existing batched HTTP/file drains unless evidence calls for a change. Inspect count
      and byte bounds, retries, overflow behavior, visibility flush, endpoint failure, and recovery.
      Dropping routine diagnostics under pressure must be observable without recursively logging failures.
- [ ] Preserve server input validation, redaction and dedupe. Suppress routine health/ingest/dashboard
      work earlier only if error/slow-request evidence remains available. Verify any sampling change
      against both direct logs and request/scope emission with the installed evlog version.
- [ ] Measure the log dashboard separately: closed means no feature-owned tail/polling; live bursts
      remain bounded; filtering/pagination do not duplicate full-file work unnecessarily. Optimize only
      demonstrated costs. Reuse existing query/live-batcher owners instead of adding a cache layer by default.
- [ ] Confirm configured file rotation/retention and optional remote drain behavior. Never enable
      a remote exporter for this work or send synthetic test events to a real external account.

Verify: focused ingest/dedupe/redaction and bounded queue tests, then
`bun run agent:browser scenario logs-search-no-flicker` and `bun run agent:browser caches` where
query lifecycle changes. Inspect actual browser requests and the correlated structured log window.

### 5. Prove the gain, preserve the evidence, and ship

- [ ] Compare each matched scenario's distributions, not one best run or summed inclusive samples.
      Report event/byte reductions alongside browser scripting, long tasks, frame/input behavior, and
      server cost. Separate production results from development and trace-enabled results.
- [ ] Use ordinary browsing and tracing controls to distinguish console-capture overhead. Do not
      claim a production benefit from development-only pretty-print removal.
- [ ] Read screenshots back. Check real warnings/errors, operation correlation, explicit diagnostics,
      and post-hide/reconnect behavior. Missing failure evidence is a regression even if traces get faster.
- [ ] Keep source-level regression tests for early admission and lifecycle bounds. Do not introduce
      arbitrary millisecond CI limits from the single exploratory run; calibrate any timing gate against
      repeated controls and machine variability. Existing trace commands remain the performance proof.
- [ ] Record measurements and retained/deferred findings in a short evidence report. Every census
      item must be resolved or explicitly deferred with an owner and reason; unexplored areas are not clean.
- [ ] Deploy the completed implementation with `bun run deploy --slug=observability-overhead`.
      If server code or server-used shared modules changed, use `--server` and report that it restarts
      the unit and drops live terminal/agent sessions. Web-only work must not restart the server.
- [ ] Verify `/platform/release` identifies the candidate, mesh live check passes, and run the
      same relevant scenarios against `https://omarchy.mesh.shaulavo.dev/platform/`. Record the release
      and any production evidence still unavailable. Planning alone does not trigger deployment.

## Focused commands and test targets

Run only checks for changed behavior. The failures these tests catch are lost failure evidence,
work done after filtering, changed cancellation, unbounded retention, and duplicate ingestion.
Use existing app fixtures and real in-process routes; mock only external boundaries.

```bash
# Baseline drift and unrelated work
git diff --stat 9a7d77d2..HEAD -- apps/web/src apps/server/src/observability packages/observability scripts/agent
git status --short

# App logger/transport tests, Bun required
cd /work/projects/platform/apps/web
bun --bun vitest run --project node src/lib/tests/client-logging.test.ts src/lib/tests/coalesced-log.test.ts

# Shared policy/scope/sanitizer tests, plain Vitest
cd /work/projects/platform/packages/observability
bun x --no-install vitest run src/tests/config.test.ts src/tests/runtime.test.ts src/tests/scope.test.ts src/tests/sanitize.test.ts

# Server ingestion and reader behavior when touched
cd /work/projects/platform/apps/server
bun --bun vitest run src/observability/tests/client-ingest.test.ts src/observability/tests/runtime.test.ts src/observability/tests/log-reader.test.ts

# Per-workspace type checks, only changed workspaces
cd /work/projects/platform
bun run --cwd apps/web typecheck
bun run --cwd packages/observability typecheck
bun run --cwd apps/server typecheck

# Only if settings change
bun run settings:schema
bun run settings:reference
bun run settings:schema:check
bun run settings:reference:check

# Evidence and final diff
bun run logs --since 5m --level warn
git diff --check
```

Expected: focused tests and changed-workspace checks exit zero, or a documented pre-existing
baseline failure remains unchanged. Add exact new test paths to these commands during execution.
Run changed-workspace lint and changed-file formatting checks as applicable; avoid a root-wide
test run as a proxy for verification. Existing `client-logging.test.ts` has an evlog boundary mock;
retain its useful assertions, but supplement it with the real-logger integration described above.

## Completion contract

- [ ] Census covers every runtime diagnostic path found in the scoped apps/packages and linked producers.
- [ ] Rejected events avoid expensive construction; focused tests prove lazy factories/ID work are skipped.
- [ ] Errors/warnings and late operation failures retain structured context, redaction, correlation and dedupe.
- [ ] Normal operation does not install detailed trace/profiler collectors or emit routine per-update logs.
- [ ] Queues, scope collections, owned performance entries and diagnostic listeners have verified bounds/cleanup.
- [ ] Explicit diagnostics still work; the row mismatch scenario and log viewer remain useful.
- [ ] Comparable before/after evidence exists for all changed hot paths, including production before claiming gains.
- [ ] Targeted checks pass relative to baseline, screenshots were inspected, and the served release is verified.
- [ ] Stable behavior/evidence references replace the plan when complete, following `plans/README.md` policy.

## Reassessment conditions

Reconcile drift rather than blindly applying stale excerpts. Do not remove a diagnostic path if
application correctness or a failure-only consumer depends on it; separate that dependency first.
If a benefit disappears without console capture, report that limit and narrow the performance claim.
If a suspected cost is negligible, keep it and record the measurement instead of manufacturing a rewrite.
If a linked-package change or an unavailable production baseline blocks proof, complete independent
work and report the exact remaining dependency. Do not mark the plan done with an unmeasured promise.

Future reviews should check where admission happens, whether any repeated payload is built before
that decision, and whether a long-lived scope can grow or defer warnings indefinitely. A new
diagnostic needs a consumer, a bounded lifetime, and a reason to run during ordinary app use.
