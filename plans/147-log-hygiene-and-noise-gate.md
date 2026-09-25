# Plan 147: Log hygiene and a noise gate

## Status and authorization

- Status: IN PROGRESS — lane L4 of the completion wave (`/work/worktrees/platform/L4`, PR #32).
  Phases 1 and 2 and Phase 3 steps 1–7 are done; step 8 (the evidence drives) is open. See
  "Landed" below.
- Priority: P1. The production log is the first thing read when something breaks, and today a
  real failure is buried under thousands of lines a day that need no action.
- Effort: M. Six small producer fixes, one census script, one `AGENTS.md` edit.
- Risk: LOW–MED. Lowering a level can hide a failure; every downgrade names the case that still
  logs at warn.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.
- Server changes deploy with `bun run deploy --server`.

## Outcome

A day of production use leaves a warn/error log a person can read whole. Every warn line means
something degraded; every error line means someone must act. A gate fails the deploy when a new
noise source appears.

## What exists today

Production census, warn and error only, `checkpoint:"failure"` lines excluded (see the double
count below). Source: `/work/platform-production/logs/`.

| Producer (level, area, action or route, code)                           | 09-24 | 09-24.1 | 09-25 | 09-25.1 |
| ----------------------------------------------------------------------- | ----- | ------- | ----- | ------- |
| warn fs `/fs/workspace-address` `NOT_FOUND`                             | 886   | 534     | 1189  | 938     |
| warn fs `/fs/read`, `/fs/stat`, `/fs/tree` `NOT_FOUND` + client         | ~25   | ~10     | ~300  | ~0      |
| warn lsp `lsp.connection.error`                                         | 992   | 12      | 16    | 0       |
| error orchestration `ws.subscription.summary` `ORCHESTRATION_WS_ERROR`  | 481   | 0       | 0     | 0       |
| warn orchestration `ws.connection.summary`                              | 481   | 0       | 0     | 0       |
| warn chat `provider_session_reaper.stop_failed`                         | 237   | 49      | 50    | 16      |
| warn terminal `terminal.session`                                        | 36    | 10      | 22    | 3       |
| error orchestration `ws.subscription.summary` `ORCHESTRATION_WS_CLOSED` | 18    | 0       | 11    | 2       |
| warn chat `ws.subscription.error` `LIVE_STREAM_OVERFLOW`                | 7     | 0       | 0     | 0       |

Producers, with the cause of each:

1. **Missing-path 404s.** `apps/server/src/observability/elysia.ts:22-26` maps every 4xx to warn,
   and the line carries the `FsError` stack. 93% of them are `POST /fs/workspace-address` from the
   project menu: `apps/web/src/features/workbench/hooks/use-project-menu-entries.ts:20-35` sends one
   lookup per candidate folder, with `staleTime: 30_000`. The client already reads a 404 as data
   (`missingAsNull`). 477 of 480 recents are `/work/tmp/fregat-*` scenario fixtures that Plan 146
   removes at the source.
2. **A hidden tab's reconnect loop.** On 09-24 one client (`ec4b3950…`, `browserAtStart.visibility:
"hidden"`) lost its orchestration socket every ~59s from about 11:00 to 19:00 with close code
   1006, although heartbeats were answered (`pingCount` 31, `pongCount` 31). Each cycle wrote the
   LSP error, the connection summary and the subscription error. The LSP pool logs every `error`
   event at warn (`apps/web/src/features/editor/state/language-server-connection-pool.ts:68-70`);
   998 of them are "LSP transport closed" with no close code. The orchestration client calls
   `scope.error` for a transport failure it then recovers from
   (`packages/client-core/src/transport/orchestration-rpc-client.ts:404`, error built at `:831-838`).
   Why the socket dies every ~59s while hidden is not yet known.
3. **The reaper that never gives up.** One binding, session `6029a465…`, provider instance
   `verify-session-titles-141a8f60…`, has logged every 5 minutes since 2026-09-20.
   `ProviderService` sweeps on a 5-minute interval (`apps/server/src/provider/provider-service.ts:159-167`).
   `stopRuntime` (`:517`) calls `routeSession` (`:808-815`), which calls `getByInstance`; that throws
   for a deleted instance (`provider-adapter-registry.ts:289-293`) before the `missing_binding`
   branch at `:528-534` can run. `ProviderSessionDirectory.listIdleSince`
   (`provider-session-directory.ts:109-129`) does not exclude deleted sessions, and nothing
   removes a binding when its session is deleted. The reaper logs the throw
   (`provider-session-reaper.ts:113-119`) and retries forever.
4. **Terminal exits we caused.** `terminalOutcome` (`apps/server/src/terminal/service.ts:1042-1048`)
   calls any non-zero exit `failed`, and `:938-941` logs that at warn. The exits are 129 (SIGHUP)
   and 137 (SIGKILL), the signals our own teardown sends.
5. **Restart closes at error.** `ORCHESTRATION_WS_CLOSED` (built at `orchestration-rpc-client.ts:852-857`)
   lines up with `--server` deploy restarts, and the client reconnects.
6. **An ACK timeout reported as an overflow.** `apps/server/src/orchestration/ws-rpc.ts:503` calls
   `subscription.budget.overflow()` when a delivery is unacknowledged for 30s. The real budget
   (1,000 items or 8 MiB, `live-stream-budget.ts:14`) was never reached: 7–19 events were committed
   in the 90s before each event. All 7 were `subscribeShell` on the hidden tab of item 2. The sizes
   the budget records go to `internal`, which `serializableError`
   (`apps/server/src/orchestration/orchestration-logging.ts:191-205`) drops for every chat-pipeline
   error. Server WS events do not log the client `instanceId`, and subscription ids are numbered
   per client, so two clients' events can share an id.
7. **Client failures logged twice.** A failed client scope writes a `checkpoint:"failure"` line
   (`apps/web/src/lib/wide-event-scope.ts:24`) and then its final line. 1,013 of 1,021 scoped client
   failures on 09-24 appear twice, so every client count above would double without the filter.

There is no runtime log gate. `bun run gates` covers source only (`package.json:67`).

## Scope

- Fix each producer above at its source.
- Write the level rules into `AGENTS.md` so new code follows them.
- Add `bun run logs:census` and run it from the deploy live check.

## Decisions

- **D1 — Level semantics.** Decided 2026-09-25: recommendation (completion wave). Recommended,
  added to the `AGENTS.md` "Logs" section:

  > - `error` means someone must act. `warn` means something degraded and the app recovered or
  >   gave up. A missing file the caller asked about is an answer: `info`, no stack.
  > - A failure the code recovers from logs once at `warn` when the series starts and once at
  >   `info` with a count when it ends. Never one line per attempt.
  > - Every retry loop, reaper and sweep has a give-up: after N identical failures the item enters
  >   a terminal state and logs once. A loop that can fail forever is a bug.
  > - A client failure is one line. Checkpoints are for events that never finish.

- **D2 — What happens to a binding the reaper cannot stop.** Decided 2026-09-25: recommendation
  (completion wave). Recommended: after two sweeps with
  the same error it is marked `orphaned`, logged once at warn, and skipped. Deleting a session
  deletes its bindings, so the orphan case is left for genuinely stuck processes.
- **D3 — The hidden tab.** Decided 2026-09-25: recommendation (completion wave). Recommended: stop reconnecting while `document.visibilityState` is
  `hidden` and reconnect on `visibilitychange`, the way `environment-recovery.ts:45-49` already
  wakes. Find the ~59s 1006 cause first (Phase 2 step 1); if it is the mesh proxy's idle timeout,
  that is a separate fix and pausing is still correct.
- **D4 — Gate budgets.** Decided 2026-09-25: recommendation (completion wave). Recommended: a group (level + area + action + code) fails when it exceeds
  50 lines in 24h, or repeats the same key within 10 minutes for over an hour, unless
  `scripts/lint/log-noise-allow.json` names it with a reason. An allow entry without a reason is
  itself a failure, as in the other censuses.

## Phases

### Phase 1: Server producers

1. `elysia.ts`: a 404 is `info`, and its line drops the stack. Other 4xx stay `warn`. 5xx stays
   `error`.
2. Reaper: `routeSession` uses `adapterRegistry.adapter()` and returns the binding with a null
   adapter, so `stopRuntime` marks it stopped instead of throwing. `session.delete` removes the
   session's bindings. `listIdleSince` joins on the session not being deleted. Add D2's `orphaned`
   state for any remaining repeat failure.
3. Terminal: record that we asked for the close; a signal exit after that is `closed` at info.
   An exit we did not cause still warns.
4. ACK timeout: a new `LIVE_STREAM_ACK_TIMEOUT` catalog entry at `info`, and the socket closes,
   since a peer silent for 30s is gone. `LIVE_STREAM_OVERFLOW` stays for a real cap breach. Keep
   the client's recovery at `orchestration-rpc-client.ts:320` working for both codes.
5. `serializableError` keeps `internal`, still passed through the sanitizer. Server WS events carry
   the client `instanceId`.

### Phase 2: Client producers

1. Find the ~59s 1006 close on a hidden tab: reproduce with `agent:browser` against the dev server
   with the page hidden, and read the server's `ws.close` side. Record the cause here.
2. Pause reconnect while hidden (D3). The first failure in a series warns; the rest roll into one
   summary line with a count. Code 1000 and closes during a known restart log at info.
3. `language-server-connection-pool.ts`: a close with code 1000, or one the pool initiated, is
   `info`.
4. `wide-event-scope.ts`: drop the failure checkpoint when the scope ends normally, so a failure is
   one line.
5. Project menu: one batched workspace-address lookup for all candidates instead of one POST each,
   and the server prunes a recent folder it finds missing.

### Phase 3: Rules and gate

1. Add D1's text to `AGENTS.md` "Logs".
2. `scripts/lint/log-noise-census.mjs` plus `scripts/lint/log-noise-allow.json`: read a log
   directory and a window, skip checkpoint lines, group warn/error, apply D4. `--check` exits
   non-zero; the report lists the top groups with a sample line each.
3. `bun run logs:census` in `package.json`. It reads runtime logs, not source, so it is not part of
   `gates` or `verify`.
4. `scripts/deploy/live-check.mjs` runs it over the last 24h of `/work/platform-production/logs`.
   A group the previous release already had is reported as known and does not fail the deploy,
   matching the check's existing pre-existing handling (`live-check.mjs:2`, `:71-75`).

Carried over from Plan 125, closed 2026-09-25 (its result is
[observability admission and retention](../docs/observability-overhead.md)). Measure each before
changing it, and ship a change only with the measured cost beside it:

5. Server log filter and reader throughput: the file scan behind `bun run logs` and the log viewer.
6. Gating the linked Editor packages' log producers before payload construction. The Editor half
   lands in the Editor repo.
7. Total-byte admission for the client's HTTP log queue, beside its existing count bound.
8. The two evidence drives Plan 125 left: a development-server baseline for its scenarios, and a
   live mock-provider streaming and reconnect drive with the admission changes in place.

## Landed (2026-09-25, lane L4)

Phase 1:

- Step 1: a 404 a handler answers is `info` with no stack. A route miss (Elysia's `NotFoundError`,
  or the web catch-all, now `FsError('ROUTE_NOT_FOUND')`) stays `warn` with its stack: it is a
  client or release mismatch. The stack reaches the event through up to three `logger.error`
  calls, so the enrich hook in `observability/elysia.ts` drops it once on the merged event. The
  same hook used to set the level from the status alone, so every `recordRequestWarning` on a 2xx
  was saved at `info` (production: `git.commit_message.provider_failed`, 21 lines);
  `raiseForWarning` keeps those at `warn`.
- Step 2: the reaper's throw came from a binding whose session was deleted on 2026-09-20 with its
  runtime left `ready` (52 of 70 production binding rows belong to deleted sessions; they stay,
  harmless, no healing code). `listIdleSince` skips deleted sessions; deleting a session deletes
  its binding (`session-deletion-reactor.ts`); a binding whose provider instance left the registry
  is stopped with one warn and a synthetic `runtime.exited`, so no later sweep lists it. D2's give-up
  is in memory: info on the first failure, one warn `provider_session_reaper.orphaned` on the
  second identical one, then skipped. After a restart a stuck binding is retried once more.
- Step 3: `TerminalSession.closeRequested` is set when we send the kill; any exit after it is
  `closed` at info. The language-server sessions got the same treatment.
- Step 4: `LIVE_STREAM_ACK_TIMEOUT` (408) at info, and the socket closes with code 4408
  (`live-stream-ack-timeout`). A client counts 4408 as a failure, so a stalled consumer on a visible
  page warns once per failure series. `LIVE_STREAM_OVERFLOW` stays for a real cap breach.
- Step 5: `internal` survives on chat-pipeline errors through `sanitizeErrorCause`; the web opens
  the orchestration socket with `?instance=<clientInstanceId>`, and every server `ws.*` event
  carries `client.instanceId`.
- Shutdown closes every orchestration socket with 1012 ("service restart") before anything else
  stops (`createOrchestrationSockets` in `ws-rpc.ts`, called first in `appCleanup`), so a deploy's
  reconnect logs at info on both sides.

Phase 2:

- Step 1, the cause: the browser ends a hidden page's sockets itself. After about five minutes
  hidden, every socket closed at the page's one-minute timer wake, 58.9–59.0 s after it opened; the
  page saw `error` then 1006 while the server received a 1001 close frame, which the byte-copying
  mesh proxy cannot produce. A second pattern (another browser): a socket opened while hidden
  received no frames, the server's ACK timer fired at 30 s and the client's pong timeout closed the
  socket at 44 s. Not reproducible headless; pausing while hidden stops both.
- Step 2 (D3): client-core takes an injectable `beforeConnect(signal)`; the web passes
  `untilPageShows`, the TUI nothing. The first unexpected disconnect warns; later ones log at info
  with the series count, and one `orchestration.ws.failure_series.summary` at info closes the
  series on the first answered heartbeat. 1000 is info; 1001 and 1012 are a known restart with a
  60 s grace. D3 refinement, decided 2026-09-25 (completion wave): the pause is skipped while
  `chat.notificationMode` is on, because session notifications come from the shell stream and a
  hidden tab is who they are for.
- Step 3: with LSP reconnect on for every lane (since `a985b43f`), `lsp.connection.error` fires
  only when the reconnects run out, so it stays `warn` for every close code; only this side's
  suspended environment refusing the socket is info. The pool's own closes never produce it.
- Step 4: a failed browser scope that ends within 5 s writes one line; one still open after 5 s,
  or at page hide, writes one `checkpoint:"failure"` line first. `workspace.events.summary` now ends
  a scope that only warned.
- Step 5: `POST /fs/workspace-addresses` answers every candidate in one call; the server prunes a
  recent it finds missing. Scenario `project-menu` records a live and a missing recent.
- New producer, not in the table: a chat file link to an absolute path outside the chat workspace
  opened an editor tab with that absolute path, and the files event stream retried the 403 every
  10 s for as long as the tab stayed open (163 `/fs/events` + 119 client `fs.read` warns on
  2026-09-25).

- The outside-workspace producer is fixed (`200a59d5`): chat links map through the server root, terminal
  links open the path they statted, and a 4xx on the files stream is final for that file set.
  Language servers are disposed before the first await at shutdown (`6d80564b`), because systemd
  signals them with the server and their exits were logged as crashes.
- Open leads: `/fs/events` answers HTTP 503 while its body carries the real 403, so SSE routes that
  fail before their first event lose `why`/`fix`; `clientErrors.WATCH_FAILED` names its message
  parameter `status`, an evlog override key, so its message never shows the status.

Phase 3:

- Steps 1–4: D1's rules are in `AGENTS.md`; `bun run logs:census`
  (`scripts/lint/log-noise-census.ts`, reusing `scripts/agent/logs.ts`) with
  `scripts/lint/log-noise-allow.json`; the live check runs it over production's last 24 hours and
  fails on a group the previous check did not have (a previous check without a census counts
  today's noise as known). Over 2026-09-24/25 it finds 13 noisy groups, each one a producer above.
- Step 5, measured: `readLogs` (the script reader) scans 24 h of production logs (52 MB, 56k
  events) in ~100 ms; no change. The server log viewer took 1,034 ms for a 24 h summary, of which
  ~155 ms was evlog's read: it stable-stringified and hashed every event and cached all of them.
  Ids are now computed only for events a page or the live tail returns (same material, so ids are
  unchanged): 24 h summary 1,034 → 212 ms, 1 h summary 154 → 87 ms, 24 h warn+error page 340 →
  125 ms, 24 h search 921 → 246 ms.
- Step 6, measured: the Editor gates `Editor.log` only on a logger being registered, and Platform
  always registers one. Of its 32 producers, the ones that can fire per frame are
  `editor.viewport.changed` (Platform reads it to cache scroll positions, so it must still be
  built), `editor.command.dispatched` and the decoration-change events. Building one payload the
  way `Editor.log` does costs ~165 ns in Bun, about 0.001% of a 16.7 ms frame. No gating added; the
  Editor half needs no change.
- Step 7, measured: client lines on 2026-09-25 are p50 746 B, p99 2.9 KB, max 9.3 KB, and the
  sanitizer caps strings and arrays, so the 1,000-event queue bound already caps the queue near
  9 MB. No byte bound added.

## Verification

- Server: narrow tests for `httpStatusLevel`, the reaper against a deleted instance (one warn, then
  silence, binding gone), `terminalOutcome` after our own close, and the ACK timeout code and close.
  `serializableError` keeps `internal`, and the sanitizer test in
  `apps/server/src/observability/tests/runtime.test.ts` still passes.
- Client: a `dom` test that a hidden page does not reconnect and a `visibilitychange` does; a scope
  failure writes one line.
- Census: a `scripts/lint/log-noise-census.test.ts` with a fixture log that fails on a noisy group,
  passes with an allow entry, and fails on an allow entry without a reason.
- Live: after deploy, `bun run logs:census` over the next 24h of production log, compared with the
  table above. Name the evidence directory in the report.

## Dependencies and relations

- **Plan 146** (isolated state and verification) removes the fixture recents behind most of the
  `NOT_FOUND` volume. 146 removes the source; 147 fixes the levels. Either can land first.
- **Plan 125** (closed) built logging admission and delivery; its open items are Phase 3 steps 5–8.
- **Plan 126 RUNTIME-04**: the seven 09-24 `LIVE_STREAM_OVERFLOW` events were ACK timeouts, not
  buffer overflows. They are not evidence for RUNTIME-04's overflow recovery.

## Out of scope

- A logging framework change or a new log viewer.
- Retention and rollover of the log files.
- The Mac's `ENVIRONMENT_PROTOCOL_MISMATCH` errors; that fix belongs to the remote-machine version
  check.
