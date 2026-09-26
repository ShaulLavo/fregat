# Observability admission and retention

Plan 125 implementation, 2026-09-20. Evidence and the full census live at
`/work/tmp/fregat-evidence/plan125-20260920/`. See its `summary.md` for the served release,
matched production comparisons, verification, and outstanding evidence.

## Normal operation

`client-logging.ts` resolves the existing environment controls once at initialization.
`OBSERVABILITY_ENABLED=false` prevents HTTP drain and visibility-listener installation and
prevents URL trace installation. The default direct-log level is info in development and
production. `VITE_CLIENT_LOG_LEVEL=debug` explicitly enables detailed editor logs, chat projection
summaries, and successful editor-key command logs. No new setting or environment variable exists.

Admission precedes lazy payload evaluation, ID allocation, environment enrichment, sanitization,
and evlog dispatch. Successful operation summaries are lazy too. Error annotations and cancellation
classification remain independent of whether output is enabled. Captured operation ownership does
not follow a later machine switch.

Routine editor callbacks retain the lifecycle summary at info; other detail uses debug. Warnings
and errors keep their severity. Scroll context remains available for failures and is released when
the editor is disposed. This host filter does not eliminate event construction inside Editor.

Fast, handled editor keybindings do not construct a diagnostic scope by default. Unhandled or failed
commands still produce evidence. Commands taking at least 500ms emit a warning with the measured
command duration before their final summary. Other command sources and asynchronous operations keep
an eagerly captured scope. This preserves their original machine attribution and lifetime.

A failed browser scope that ends within 5s is one line: its final summary. One still open after
5s, or when the page hides, first writes a `checkpoint:"failure"` line with the `scopeId` its final
summary shares. Counters keep their lifetime meaning; a successful start cannot discard a late
failure. The browser drain stamps IDs on scope events as well as direct events so retries retain the
same identity. Server validation, redaction, deduplication and existing sampling remain independent.
The client adds no probabilistic sampling, avoiding a second random sampling stage.

Development console output receives sanitized warn/error events by default, with detailed output
only in explicit debug mode. Production suppresses routine console output. The existing bounded
HTTP pipeline reports dropped batches to the console without recursively using the logger.

## Retention and lifecycle

- Accumulated diagnostic collections retain the latest 25 items per array. Structured error
  cause/data remain with evlog because they can reference application-owned objects. Warning records use the same bound;
  `warningCount` preserves the total. Numeric counters are not truncated.
- `editorPerfTrace=1` remains a separate, explicit collector switch subject to the master switch.
  It does not turn on debug uploads. Trace events use a 5000-entry ring, frame statistics use running
  aggregates, and target counts retain at most 100 labels plus an overflow label. Reinstall stops
  the prior trace; stop removes the frame callback, observer and listeners. Hide/resume excludes
  the background interval from frame statistics.
- Snapshot persistence is unchanged. Its diagnostic User Timing measure requires explicit debug
  mode and retains only the latest owned entry. No other marks or measures are cleared.
- Chat projection logging rejects ordinary traffic before constructing per-item summaries. Explicit
  debug mode flushes on a trailing throttle. Projection state and cache persistence remain functional.
- Coalesced read/tree logs flush at a fixed deadline from the first event. A continuous stream cannot
  postpone emission indefinitely. Disabled info output skips success-queue work.
- The log viewer already subscribes only while active and retains 500 rows. Its pending batch now
  flushes at 500 items even if the browser delays the scheduled timer, preserving event totals.
- The initial-paint row geometry audit remains enabled, including its mismatch warning.

## Verification tools

`agent:browser --no-console` omits console listeners for a capture-overhead control. `observed.json`
records upload requests, bytes, event counts and client instance IDs. These count attempted uploads,
including retries; they are not stored server-event counts. Server info sampling remains 25% in the
measured production deployment. Its log directory is `/work/platform-production/logs`, separate from
the checkout's development logs.

`scenario editor-diagnostics-lifecycle` opens and closes editors, opts into tracing, exceeds the
retention bound, stops collection, and reloads without diagnostics. It waits for app readiness after
reload before sending keyboard input. The first drive exposed that missing wait in the verifier;
its failed evidence remains in the report.

Real-evlog tests cover early filtering, skipped payload/ID work, late failures, captured attribution,
redaction, scope bounds and visibility flushing with stable event IDs. Command tests cover skipped
fast success, explicit debug, slow/unhandled commands and late failures. Chat subscription and
projection tests exercise the existing in-process server path.

Production query-cache inspection is unavailable because its inspection registry is development-only.
The development server was unavailable during the baseline. Production measurements cannot prove
development-console performance. No paid agent turn was started; a live mock-provider streaming
browser drive remains pending. Server file-scan optimization and upstream Editor producer gating
were deferred because this work does not establish their cost. No server speedup is claimed.
