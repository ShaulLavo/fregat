> Historical Plan 126 source and scope record. [Plan 343](../343-t3code-nightly-orchestration.md)
> owns the Approved, deferred nightly rewrite at `bd2346eda2e2c380d1844869c7fd16c279d2190f`.
> Preserve these receipts and remaining requirements. Recheck affected contracts and provider
> behavior against nightly before implementing them.

# Plan 126 finite closeout, October 3, 2026

Status: Approved; finite engineering and reconciliation pass complete. The owner requested
this bounded pass before the keymap wave. The larger alignment program remains open.
Planned against Fregat `ea344b775`. Root [PLAN.md](../../PLAN.md) owns scheduling.

## Scope and finish line

Reconcile the ledger with delivered scenarios and later bounded deliveries, attempt one
fixture reproduction of the monitoring/draft ownership report, and place remaining work in
explicit follow-on batches. Preserve the frozen upstream oracle, state-loss authorization,
real-account and physical-device boundaries. This pass does not finish the larger alignment
program or begin Grok, Antigravity, forge, browser/device or workspace implementation.

- [x] Reconcile all 57 ledger groups with their later delivery evidence.
- [x] Correct the root roadmap's generic engineering-closeout wording.
- [x] Run a bounded fixture check of Monitoring, navigation, submit and draft ownership.
- [x] Read screenshots, native turn receipts and captured problems; record any failure honestly.
- [x] Give remaining engineering and gated follow-ons explicit scope and placement.
- [x] List owner-only checks separately and retire the completed Plan 114 desktop gate.

## Evidence and disposition

The bounded Wave 2 scope was closed by [PR #325](https://github.com/ShaulLavo/fregat/pull/325).
The machine ledger had 24 verified, 25 in-progress and 8 open rows. It lagged later scenario
receipts in [September 26 status](status-2026-09-26.md) and the merged October 1 batches in
[October 2 reconciliation](status-2026-09-28.md). Counts describe recorded scope, not progress
percentages or current runtime certification.

The ledger now records 36 verified, 16 in-progress and 5 open groups. Twelve entries move to
verified within their recorded acceptance: archive LIFE-01/02, PR lookup EXT-13, overflow
RUNTIME-04, native permissions RUNTIME-11, fixture credit redemption RUNTIME-08, composer
INTERACTION-01/02/03/04/08 and accepted usage/pricing EXT-17. Grok/Antigravity RUNTIME-02,
browser context INTERACTION-09 and machine policy EXT-16 move from open to in-progress with
their delivered portions explicit. Every row now names its remaining scope and owner-only
checks in a `closeout` field. Original execution evidence remains intact and historical.

These promotions use the named historical scenario receipts; this pass does not rerun them.
For example, `stream-overflow` proves ACK-timeout reconnect/cursor recovery and exact text;
the item/byte caps remain separate server-test evidence. RUNTIME-08 remains fixture scope,
and INTERACTION-03's stash receipt does not prove reload-persistent queued comments.

The [September 30 proof](bounded-closeout-2026-09-30.md) retains wider-row limits. Later
merged `289ad2c27` from #275 specifically covers descriptor arrival/removal, skipped DST time,
9 AM across DST, middle-owner order rollback, partial-disconnect search, failed-current-delete
selection and a route chosen during pending deletion. Those cases are delivered and no longer
appear as missing engineering. #284 covers both durable provider-release crash windows and
re-engagement. These are bounded receipts; remaining target-specific conformance stays explicit.

## Remaining work and placement

Root ordering schedules the following units. Existing plan authorization remains authoritative.
Contract preparation may proceed independently where owners and files do not overlap.

| Unit                                     | Exact retained scope                                                                                                                                                                                 | Placement and entry condition                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Grok                                  | Production driver config/auth/status/models, invoke/resume, supported requests/stop/errors, account isolation and reachable UI. Reuse delivered ACP transport.                                       | Separate provider batch after keymap. Refresh [Grok contract](protocol-grok.md), implement the fixture-backed path, then record any owner-only account gap.                                                                                                                               |
| G2 Antigravity                           | Production ACP driver, install/profile/temp ownership, non-spawning status, supported filesystem/approval/auth/resume/cancel behavior.                                                               | Separate batch after G1 in the default provider order. Refresh [Antigravity contract](protocol-antigravity.md); verify installation destination and exact upstream support before large downloads.                                                                                        |
| G3 supported driver cases                | Remaining supported capability/account branches for delivered drivers. No invented steering, rewind or authentication capability.                                                                    | Follow the relevant driver's implementation; name the exact missing case before running it. Historical fixture proof does not close real-account smoke.                                                                                                                                   |
| I forge interactions                     | Replies/resolution, reactions, reviewers, applicable labels and viewed-file ownership. Discussion, review submission and activity are delivered.                                                     | Coherent feature batches after keymap through existing Git ownership and [EXT-02](adjacent.md). Refresh per-forge support; unsupported operations remain explicit. Agent review under 169 is a separate delivered scope.                                                                  |
| B/E/J target-specific proofs             | Ledger's bounded lifecycle/terminal/machine/settings rows preserve wider acceptance limits. Their completed two-owner, restart, DST, rollback and project-settings units are removed from the queue. | Add proof with the affected feature/host unit only after naming a concrete uncovered case. No generic A–F/J engineering closeout blocks keymap.                                                                                                                                           |
| J subprojects; E per-session auto-settle | Real scoped repository membership/commands and the separate per-session switch. Existing grouping/global/project policy is delivered.                                                                | Approved and parked at their live identity/index/schema/state-loss gates. This finite pass authorizes no reset or deletion.                                                                                                                                                               |
| H pairing scopes/revocation; relay       | Required scoped access and revocation beyond delivered pairing/capacity/preferences.                                                                                                                 | Required scope change waits for owner-authorized re-pair of existing device records. Relay remains later.                                                                                                                                                                                 |
| F browser annotations and rich composer  | Browser element/screenshot context; remaining rich composer work. Existing review/citation context and touch send behavior are delivered.                                                            | Annotation follows EXT-07's delivered capture owner. Rich composer follows [171](../171-composer-on-our-editor.md) and its declared widget prerequisites.                                                                                                                                 |
| Preview/device/native/mobile             | EXT-07/09 operation, capability and OS matrices with actual host adapters. Reuse delivered installed-app contracts.                                                                                  | Separate larger programs in root order. Completed Plan 114 Mac acceptance stays closed; other physical-device coverage needs its actual device.                                                                                                                                           |
| Background/workflows                     | EXT-10 power/activity/resource policy and INTERACTION-12 workflow phase/script inspection.                                                                                                           | Retained [EXT-10](adjacent.md) and [144](../144-unattended-agent-work.md) scope; define bounded measured units through existing provider/runtime and observability owners when scheduled. Historical Plan 125 is absent from the current plan inventory and is not a launch prerequisite. |
| Page-departure reporting                 | Completed recency writes can lose their client response around departure; the October 2 diagnosis establishes warning noise, not data loss.                                                          | Later design under existing mutation/operation observation. No retry of incrementing recency writes, healing, keepalive or logging filter is introduced.                                                                                                                                  |

The original ghost-draft cause remains an unconfirmed report. This pass adds a fixture scenario
for Monitoring plus draft ownership and records its attempt below. A passing control does not
close the original cause or establish real-account/device coverage.

## Owner-only receipts

| Receipt                                    | Expected observation                                                                           | Current boundary                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cursor/OpenCode/Claude/Codex account smoke | Authentication, model discovery and one completed turn with the supported driver capabilities. | Real accounts were not exercised by this pass. Driver fixture proof remains separate.             |
| Real reset-credit redemption               | Confirmed credit consumed once, updated quota state and cancellation that spends nothing.      | Fixture acceptance is delivered; a real credit requires the owner's account decision.             |
| Remaining physical device/OS matrix        | Actual capture, input, rendering, activation and reconnect on each named target.               | Plan 114 Mac installed-app acceptance is delivered. No universal mobile/OS claim follows from it. |

## Verification

The pinned inventory check passes with 47 contract modules, 146 RPC methods and all 57 plan
groups validated. `plans:check` passes with all 216 top-level documents indexed. A local-target
scan of 284 root/nested roadmap/plan files finds no missing targets. Changed-file formatting,
configured Oxlint and `git diff --check` pass. A preservation check confirms every original
row ID, title, report, wave, acceptance string and execution-evidence entry remains intact.

Cold read-only review found no unsupported status promotion, dropped work or authorization,
or causal-closure claim. The browser scenario covers two existing sessions created by the
fixture helper. It does not exercise fresh-draft promotion into a new session on first submit.
That trigger and the real-account surface remain unproved.

Publication runs normal commit hooks, path-only staging, push and Mesh deployment. Commit and
served-release receipts belong to the publishing run; its checklist is kept outside the repo
so recording a release does not require modifying the release being verified.

### Bounded monitoring/draft attempt

The collaborative preview reported no automation host in this headless environment on status
and open. The repository's fixture browser runner supplied the fallback.

- `look --doctor`: run `20261003T131246Z-look-1440x1000`, ready, healthy, no captured problems
  or warn/error events. Its screenshot was read.
- `scenario monitor-draft-ownership`: run `20261003T131300Z-scenario-monitor-draft-ownership`,
  completed in 7,629 ms. The new committed scenario exercises one Claude fixture repository
  and two sessions. No real account or provider executable ran.
- The first prompt was visibly observable before submit. Its completed session entered
  Monitoring and held an unsent marker. The second session opened with an empty composer,
  sent its distinct prompt once and reloaded empty. Returning to the original session restored
  only its own unsent marker. Native log recorded exactly two prompts/turns; each rail row
  appeared once, and the first session remained Monitoring. Screenshots 01–06 were read.
- Raw evidence retains four `provider_registry.instance_failed` warnings rejecting the
  built-in Codex/Claude/Cursor/OpenCode providers in the fixture-only runner. It also retains ten
  aborted navigation/event/log requests, with frame provenance; no failed HTTP response,
  console warning/error or scenario problem was captured. This is not a zero-request-failure claim.
- Both throwaway API state homes were removed by the runner, and the scenario owns cleanup of
  its sessions, project, fixture provider/processes and repository. Existing owner state was untouched.

Evidence was created under the runner's OS-temp default, then preserved under the same run
IDs in the host's `/work/tmp/fregat-evidence/` directory. `draft-ownership.json`, `observed.json`,
`logs.txt` and screenshots preserve the raw result; no capture was discarded.

Disposition: **not reproduced in this bounded fixture check**. Retain the original unconfirmed
report under RUNTIME-07. A future report needs the session/owner, workspace, navigation/submit
sequence and surrounding structured log window. This finite pass makes no product fix, causal
closure, live-account claim or blanket monitor/child-shell lifecycle certification.
