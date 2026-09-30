# Bounded foundations closeout, 2026-09-30

Status: Approved. This delivery finishes the assigned two-owner proofs, fixture Settings repair,
and a scoped idle-cleanup guard. [PR #210](https://github.com/ShaulLavo/fregat/pull/210) merged it
as `4edb43b18` after independent review, with all PR checks green. On the final PR head
`614e672fe`, which contains main `3ca862a4b`, a throwaway source server passed `look --doctor`,
native background liveness, two-owner bulk failure/Undo and the scoped silent-terminal guard.
Production server deployment is still pending.
Plan 126 remains open for its other acceptance and owner gates.
The ledger's row statuses stay in progress because these cases do not certify each whole group.

## Delivered behavior

A partially successful bulk snooze clears selection before the first command and puts only
successful receipts in Undo. The prior behavior left failed rows selected. A real-server DOM
regression failed before the fix; the three-row browser proof interrupts the middle remote
command, shows `2 snoozed, 1 failed`, restores the two successful rows, then interrupts a
three-row delete and retains only the failed remote row as selected.

Settings mounts a provider's update controls only while that instance is enabled. Disabled
built-in Codex/Claude instances have no registry adapter, so their former automatic update
queries returned HTTP 500. The retained structured events say `Provider instance not found`.
The same fixture scenario failed with those disabled requests before the repair and passed
with no disabled update request, console error, or failed HTTP response afterward. Its enabled
fixture still updates from 0.1.0 to the intercepted npm release 99.0.0. No account or installed
provider binary is updated.

Codex idle cleanup now asks the existing process for `thread/backgroundTerminals/list`, scoped
to its root provider thread. It validates the response and follows pagination until it finds a
live terminal or an exhausted list. A live terminal preserves the ready process; an empty list
allows cleanup. Pending foreground work, RPCs, approvals and input preserve it as well. The
service rechecks child/task liveness, launch ownership, runtime epoch, timestamp and shutdown
after the asynchronous read. Explicit user stops keep their existing behavior.

Malformed/unsupported/error responses reject the stop. The existing reaper gives up after two
identical failures and retains that binding. A repeated cursor or exhausted read budget also
preserves the process. This guard publishes no synthetic Monitoring event. Parent-owned live
shells are protected even when their native protocol produces no task notification.

## Fresh proof by acceptance case

All paths below are under `/work/tmp/fregat-evidence/`. Screenshots were read back.

| Row              | Case proved                                                                                                                                                                                                          | Evidence directory                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| LIFE-03/04       | Same-ID local settle leaves remote twin active; pin/snooze/settled shelves, custom six-second timer wake, bulk Undo, held native turn snooze without interrupt                                                       | `20260930T153135Z-scenario-session-lifecycle`           |
| LIFE-04/10       | Two owners with native fixture providers, three-row middle transport failure, exact snooze counts, success-only Undo, failed delete selection retention                                                              | `20260930T162506Z-scenario-session-bulk-failures`       |
| LIFE-05          | Same-ID second owner, pointer shelf transitions, distinct materialized active keys, keyboard pin and persisted ordering after reload                                                                                 | `20260930T163050Z-scenario-session-ordering`            |
| LIFE-08          | Same IDs on two owners; native reply on the remote owner is found from the primary rail; changed query clears stale matches; cached query keeps the correct owner                                                    | `20260930T163109Z-scenario-session-search-environments` |
| LIFE-10          | Same-ID background archive preserves remote route; current archive opens owner draft; delete chooses owning survivor and keeps remote twin                                                                           | `20260930T163029Z-scenario-session-navigation`          |
| RUNTIME-07       | Native parent complete plus live child, idle child release, late metadata/reload remains Ready                                                                                                                       | `20260930T153413Z-scenario-background-liveness`         |
| EXT-05           | Actual throwaway API process restart; two separate viewer contexts replay history and share the surviving shell token; history clear survives reconnect; explicit shell restart replaces that token for both viewers | `20260930T153528Z-scenario-terminal-history`            |
| Fixture Settings | Disabled update reads absent; enabled fixture installation and post-update version                                                                                                                                   | `20260930T152150Z-scenario-settings-provider-update`    |
| Shell smoke      | `look --doctor`, healthy app, no problems                                                                                                                                                                            | `20260930T162657Z-look-1440x1000`                       |

The terminal run intentionally records refused/dropped requests during API restart, then proves
both viewers reconnect. Its staged restart marker is a harness release; it does not certify a
production deployment or surviving historical production PID. Its isolated histories/processes
are cleared and killed in cleanup.

## Codex source and contract evidence

The installed executable reports **codex-cli 0.159.2**. Only `--version` and offline
`app-server generate-json-schema --experimental` ran, with an empty isolated `CODEX_HOME` at
`/work/tmp/foundations-126/codex-offline-home`. No app-server conversation or account call ran
against it. Generated schemas remain at `/work/tmp/foundations-126/codex-0.159-schema`; the two
list-contract JSON files are retained under `evidence/codex-0.159.2/`.

Exact source tag `rust-v0.159.2` resolves to `8b9fa496bbf2c47aebd62e85a080b9a522a455b5`.
`codex-rs/app-server-protocol/src/protocol/common.rs` marks list/terminate experimental.
`protocol/v2/thread.rs` defines required `threadId`, optional `cursor`/`limit`, response `data`
and `nextCursor`, and terminal `itemId`, `processId`, `command`, `cwd` plus optional nullable
metrics. `app-server/src/request_processors/thread_processor.rs` loads that one thread and
paginates its terminal list. `core/src/unified_exec/process_manager.rs:list_processes` filters
out exited processes. `ServerNotification.json` has no dedicated monitor/background-terminal
lifecycle notification. The adapter already initializes with `experimentalApi: true`.

Historical protocol pin `00c972ed5d6ff6499317fd41b7f23605b8e6850d` has Cargo version 0.157.0 and
already declares experimental background-terminal list/terminate. That differs from current
installed 0.159.2 and upstream model-manifest recommended minimum 0.159.0. The main protocol pin and
generated bindings are unchanged; this delivery adds only a validated experimental list read.

The clean T3 Code reference was fetched and fast-forwarded from `d15210cd` to
`c2fa9fc911daeac97df4760f95fc57dca42b84c8`, 30 commits. Drift includes Codex 0.159 binding
regeneration, managed ChatGPT authentication, Grok crash recovery, OpenCode stop/install
compatibility, terminal/PTY fixes and UI PR/mobile fixes. The three scoped files
`ThreadBackgroundLiveness.ts`, `ProviderSessionReaper.ts` and `CodexSessionRuntime.ts` have no
source delta across those two heads. This is a scoped reconciliation, not a full drift audit.
Acceptance oracle `7445aa733ada33e45289e5aa5055f79142556513` stays frozen.

## Validation and remaining scope

- Focused provider service/reaper/Codex/Claude and pagination checks: 217 passed.
- Real-server DOM component lifecycle, bulk snooze and session-removal checks: 11 passed.
- Exact upstream session vocabulary inventory: 10 passed. Only new experimental RPC and
  utility/test occurrences were added.
- Review strengthened the transport proof to record all three request-time selections. Moving
  selection clearing after the first awaited command fails at the first snapshot; actual code
  passes. Red/green logs are retained at `/work/tmp/foundations-126/repair-late-clear-red.log`,
  `repair-lifecycle-before.log`, `repair-lifecycle-green.log`, `repair-vocabulary-before.log`
  and `repair-vocabulary-green.log`. The stale component expectation for retained archived
  selections was migrated to the approved clear-before-command behavior.
- Native RPC fixture covers thread scoping, pagination, empty/completed lists, malformed and
  unsupported methods, parent-complete pending child requests, and pending foreground RPCs.
- A native fixture process stays ready and alive through an injected 35-minute reaper sweep,
  then is released after its terminal list empties. Periodic cleanup without another launch,
  runtime activity during a check, new child work, concurrent resume and shutdown are checked
  with the service's injected adapters and clock boundaries.

Remaining: no live installed-Codex background command or account was run. Nonterminal monitors,
child-owned silent shells after the child's liveness becomes idle, automatic settlement, live
account/reset-credit redemption, physical devices and native desktop/macOS surfaces are not
certified. Broader row matrices, including descriptor/DST lifecycle cases, order failure rollback,
partial disconnect search, independently removed failed rows and upstream full navigation
comparison retain their owning historical evidence and remaining acceptance. LIFE-06's schema
and state-loss gate, desktop Plan 114, TUI redesign and the frozen oracle are unchanged.
