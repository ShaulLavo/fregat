# Plan 126: Align Platform behavior with pinned T3 Code

Status: **IN PROGRESS; FULL PARITY EXECUTION RESUMED 2026-09-23**. Two source-audit passes and independent
cross-review completed on 2026-09-20. The audit found 48 implementation groups, and the 2026-09-24
delta added nine: **57 groups**, including paired client/server work. This is not a count of
independently reproduced bugs. On 2026-09-25, 24 groups were done (23 implemented and deployed, plus
LIFE-13 closed by its scenario in the completion wave), 8 partial and 25 not started. In the completion wave a row closes when its `agent:browser` scenario proves the
behaviour; the paired run against upstream T3 Code is dropped
([owner decision](../docs/completion-wave.md#owner-decisions-for-this-wave-2026-09-25)).

LIFE-01/02 shipped on 2026-09-20. Rewind/native permissions/PR lookup have an initial deployment and follow-up validation in [delivery evidence](126-t3code-alignment/rewind-permissions-delivery.md); bounded delivery and MCP approval implementation are recorded in [their delivery evidence](126-t3code-alignment/live-delivery-approvals-delivery.md). The active-list exceptions and automatic unarchive are removed; archive eligibility is separate from settlement. See [archive delivery evidence](126-t3code-alignment/archive-delivery.md). The source-derived archive fixture is the first focused conformance case, not completion of Wave 0 or proof of full upstream parity.

Priority: P0 for the archive defect and conformance foundation; execute the remaining work in
the dependency order below. Overall effort is large and spans multiple deliveries. No honest
date estimate is possible before provider/platform prerequisites and live comparison are measured.

A 2026-09-24 upstream delta audit against `9383f4ad` added nine groups (57 in total) and reopened four stale non-parity rejections. The acceptance baseline stays pinned; see [the delta record](126-t3code-alignment/delta-2026-09-24.md).

The user resumed all parity work on 2026-09-23, including providers, remote access, browser/device tools, mobile, desktop and distribution. The previous stop applied to the 2026-09-20 run only. See [the resumed execution record](126-t3code-alignment/resumed-execution.md) for the first batch and [the historical wrap-up](126-t3code-alignment/wrap-up.md) for completed deliveries and their limits.

## Authority and completion rule

The user's instruction is hard alignment with T3 Code. Earlier local product decisions do not
silently exempt behavior from this comparison. The archive exception is the motivating example:
a local test intentionally enforces behavior that upstream does not have.

- Platform planning baseline: `3c9b88c35784e571e706600b0cee8e95a2656f77`.
- T3 Code baseline: [`7445aa733ada33e45289e5aa5055f79142556513`](https://github.com/pingdotgg/t3code/tree/7445aa733ada33e45289e5aa5055f79142556513).
- Compare the pinned object, not `references/t3code`'s working tree. The object is available
  locally. Read it with `git -C references/t3code show <sha>:<path>`. Newer reference commits
  are a separate explicit delta and do not silently change the acceptance baseline.
- Match reachable behavior, defaults, eligibility, error outcomes, ownership, persistence,
  navigation and cleanup. Different labels, frameworks, renderer libraries and file layouts
  are implementation mappings, not evidence of parity or automatic reasons to rewrite them.
- Map upstream thread to Platform session. Preserve explicit environment/project/worktree
  ownership, the shared design tokens, TanStack mutation settlement and the settings authority
  boundary. Implement upstream behavior through these owners, rather than duplicating its
  infrastructure alongside the existing application.
- Do not promise “no divergences” until every in-scope capability/operation/default has a mapped
  acceptance case, all known gaps are closed, and every unknown is resolved. A declaration,
  endpoint, screenshot or green local test suite alone cannot close a row.
- Do not exempt mobile, desktop, remote access or additional providers by calling them outside
  the old product scope. They remain open program work. Platform-only editor/TUI features may
  remain additions; their use of shared chat behavior must pass the same scenarios.
- Upstream capability restrictions count too. Do not invent arbitrary MCP forms, direct child
  agent controls or a working Jujutsu driver because a schema or old document suggests them.

## Readable audit and machine-readable records

| Artifact                                                     | Purpose                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Lifecycle](126-t3code-alignment/lifecycle.md)               | 14 groups: archive, shelf placement, settle/snooze/pins, ordering, unread, search, grouping, navigation, titles, cleanup UI, Undo and row PR state                                                                                      |
| [Interaction](126-t3code-alignment/interaction.md)           | 14 groups: queued sends, files/drafts/stash, questions, rewind, compaction, quotas, model fan-out, context, artifacts, editing, workflows, background start and favorites                                                               |
| [Runtime](126-t3code-alignment/runtime.md)                   | 11 groups: safe rewind, native approval replies, stream bounds, providers, capabilities, compaction, liveness, usage, delivery and maintenance                                                                                          |
| [Adjacent product](126-t3code-alignment/adjacent.md)         | 18 groups: forges/PRs, clone/publish, setup, terminals, notifications, preview/devices, remote, clients/releases, background policy, cleanup, conformance, default-branch pull, submodules, load balancing, usage page and branch drift |
| [Finding ledger](126-t3code-alignment/ledger.json)           | IDs, delivery wave, source evidence level, open status and execution-evidence slots                                                                                                                                                     |
| [Contract coverage](126-t3code-alignment/coverage.json)      | Every one of 47 upstream contract modules assigned to work; assignment is not symbol-level verification                                                                                                                                 |
| [Pinned census](126-t3code-alignment/inventory.json)         | 146 RPC names, orchestration discriminants, contract exports/content hashes and upstream app inventory                                                                                                                                  |
| [Census/plan checker](126-t3code-alignment/inventory.py)     | Reproducible baseline and ledger validation; does not claim behavioral equivalence                                                                                                                                                      |
| [Audit protocol](126-t3code-alignment/audit-protocol.md)     | Shared evidence and review method                                                                                                                                                                                                       |
| [2026-09-24 delta](126-t3code-alignment/delta-2026-09-24.md) | Upstream `9383f4ad` delta: new groups, items folded into existing groups, reopened rejections                                                                                                                                           |

Each finding report contains the exact local/upstream source anchors, impact, confidence,
effort/risk, change boundaries and acceptance cases. They are executable appendices to this
plan; no conversation context is required. The ledger gives one owner to each group, and
the delivery units below join overlapping UI/server work rather than implementing it twice.

The reports describe gaps found in the 2026-09-20 source audit. Consult the ledger and linked
delivery records for subsequent implementation; an audit's absence claim does not override
a delivered capability. The 2026-09-23 reconciliation recovered historical evidence for eleven
groups. None became fully verified from that review. Historical browser evidence does not
establish the current checkout's runtime behavior.

Historical `docs/t3code-*` and `docs/chat-t3code-parity.md` are evidence of prior work, not the
acceptance authority for this baseline. Do not revive their stale absence claims or percentages.
Update their supersession pointers when application implementation updates the stable docs.

## What the second pass changed

The first pass enumerated capability paths and compared current source. The second pass traced
failure, concurrency, reload and ownership paths, then reviewers inspected reports they did not
author. Raw reviews are retained in [lifecycle review](126-t3code-alignment/review-lifecycle.md),
[interaction review](126-t3code-alignment/review-interaction.md), and
[adjacent review](126-t3code-alignment/review-adjacent.md). The coordinator independently read
the native approval, checkpoint, queue, provider, stream-budget and delivery-policy source for
the runtime report; its review is [recorded here](126-t3code-alignment/review-runtime.md).

Material additions/corrections are incorporated in the actionable reports:

1. **Archive activity:** t3code only explicitly unarchives. Remove our automatic unarchive too.
   The earlier conversational suggestion to preserve it is withdrawn.
2. **Permission approval:** recognizing a native request is insufficient. Ours sends `{decision}`
   where upstream sends a permissions grant object; add an exact native-wire regression case.
3. **Rewind:** validate rollback capability and isolated file ownership before changing files;
   conversation-only rewind and draft/attachment restoration are part of the same workflow.
4. **Stop/queue:** recover queued content before interrupt RPC; excess attachments remain held
   for explicit Send now, including when interrupt fails.
5. **Async questions:** native async-message ingestion and message-mode answer semantics are
   missing prerequisites. Adding a Dismiss button to callback questions would be wrong.
6. **Snooze:** derive wake from stored source timestamps; do not add an invented wake event.
   Running work may be snoozed. Fresh requests and completion need precise upstream rules.
7. **Terminals:** disk replay is only part of the gap. Our ten-minute detached timeout kills
   jobs upstream retains. Durable provider transcript recovery already exists and stays.
8. **Git:** indeterminate PR lookup is incorrectly treated as absence. Fix it before any
   create-on-absence workflow. Five forge implementations exist upstream; Jujutsu does not.
9. **Cleanup:** automatic worktree/storage retention is separate from settlement and the delete
   dialog. It requires its own opt-in policy and race-safe owned removal.
10. **Scope corrections:** precise diff text, plans, manual project scripts, basic PR actions,
    terminal reconnect replay, child ownership, recovery and CI already exist. The gaps concern
    missing semantics/consumers, not those entire features. Multi-model work needs isolated
    worktrees; grouping includes a third `repository_path` mode; Plan/context meters default off.

## Drift and repository boundaries

Before editing source:

```bash
git status --short
git diff --stat 3c9b88c35784e571e706600b0cee8e95a2656f77..HEAD -- apps packages scripts .github
python plans/126-t3code-alignment/inventory.py
```

Expected: the pinned census and ledger validate. Source changes since the baseline require
re-reading the affected finding and updating its evidence, not resetting someone else's work.
Unrelated source changes and scratch files were present/concurrently changing during the audit;
the initial audit edited only `plans/`. That audit made no branches, commits, pushes, deployments or installs. Subsequent implementation and deployment are recorded in the linked delivery evidence. Use the current worktree and preserve unrelated work.

Application write scope during execution: the specific feature, shared contract/client-core,
server owner, test, settings registry and browser scenario files named by the selected finding.
Do not rewrite the editor, terminal renderer, framework, storage IDs or unrelated logging code
to achieve source similarity. New provider/platform subsystems are explicit deliveries, not
incidental additions to an archive patch. Follow repository no-compatibility/no-healing rules.

## Wave 0: Establish an independent behavioral oracle

Owner EXT-11. Begin immediately and complete its archive/native-reply/rewind cases alongside
Wave 1; do not wait for every provider/platform case to exist before fixing the reported defect.

1. Convert the pinned census into an operation map: upstream operation + applicable capability,
   local UI/command entry point, domain owner, response/event/navigation mapping, defaults and
   persistence, and test/scenario IDs. Map all 146 named RPC methods and orchestration command
   discriminants. A differently named HTTP endpoint can satisfy a mapping; names alone cannot.
2. Extend `coverage.json` from domain ownership to reviewed symbol/default/negative-path
   coverage. Give inventory-only filesystem, editor/host, setup/install, authentication and
   platform branches explicit scenarios or mark them unverified. Do not let broad group rows
   stand in for checking every reachable capability.
3. Put immutable behavior fixtures under `test/parity/t3code/`, stamped with upstream commit,
   source/test anchors, operation mapping and expected normalized results. Keep transformations
   limited to IDs, clocks and paths; never normalize away a different eligibility or error.
4. Add focused conformance adapters over real local app/server code. For pure rules, execute
   pinned upstream and local helpers against the same corpus where practical. For provider/host
   boundaries use recorded or injected external protocol fixtures and retain provenance.
   Source-derived expectations stay labeled until live comparison is performed.
5. Move the durable census/checker into `scripts/parity/` during implementation and wire it into
   existing CI with focused conformance tests. New or changed upstream operations/defaults must
   produce review-required rows. Upstream revision bumps are explicit reviewed changes.
6. Add controlled negative checks: restore the bad archive exception in an isolated test fixture,
   return `{decision}` for permission grants, or ignore `restoreFiles:false`; each must fail the
   oracle. Do not weaken expected output to satisfy the current implementation.

Done: the first critical cases fail on current behavior and pass only when the corresponding
fix lands; operation/default coverage is explicit; CI can detect drift without claiming that
the static census proves parity. The durable census and CI checks are implemented. Most operation mappings and paired runtime
comparisons remain unverified; these checks do not establish behavioral parity.

## Wave 1: Correct existing unsafe or misleading behavior

| Delivery unit    | Finding IDs                | Exact implementation and proof                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive          | LIFE-01, LIFE-02           | Remove both active-list exceptions; replace blanket lifecycle reset with event-specific settle/snooze resets; only explicit unarchive clears archive. Match UI versus API eligibility separately. Replace contrary tests. Prove late approval/error/plan/completion/recovery never reopens an archive and restore retains history.                                    |
| Safe rewind      | RUNTIME-01, INTERACTION-05 | Add explicit restore-files choice; preflight native rollback and true workspace isolation before Git mutation; offer conversation-only rewind. Prepare attachments/capacity first, await canonical history change, restore prompt/payload to captured draft. Unsupported provider/shared checkout leaves bytes, index and history unchanged.                          |
| Native approvals | RUNTIME-11, RUNTIME-03     | Discriminate pending request kinds and retain native IDs/permission profiles/child ownership. Send exact grant/schema responses and supported app-access form decisions. Unknown schemas accept without content; URL and unpopulatable required forms decline. Exercise accept/deny/session acceptance, replay and duplicate response through real adapter ingestion. |
| Bounded delivery | RUNTIME-04                 | Cap queued/coalesced/in-flight subscription items and serialized bytes, release on completion/cancel, force cursor resync on overflow. Bound the client queue too. Slow shell/detail subscribers must recover the same text without unbounded retained memory.                                                                                                        |
| PR read failures | EXT-13                     | Distinguish successful absence from auth/rate/timeout/malformed failures; forbid create after indeterminate lookup. Reuse feature structured errors and show actionable retry. Prove failed read performs no remote mutation.                                                                                                                                         |

Archive pre-fix excerpts retained as the regression target:

```ts
// packages/client-core/src/chat/rail/model.ts:155
view === 'archived' ? item.archived : !item.archived || item.status === 'needs-input'
// packages/client-core/src/chat/selectors.ts:145
if (!includeArchived && session.archivedAt && session.attentionState !== 'needs-input') return []
// apps/server/src/orchestration/lifecycle-events.ts:14
if (session.archivedAt) {
  /* emits session.unarchived */
}
```

All three behaviors were changed in the archive delivery. Keep explicitly opened archived details usable. Archive does
not imply provider Stop or dropping outstanding requests. The upstream server allows archive
after existence/nonarchive checks, while UI blocks running plus active-turn-ID; compare starting,
waiting, running-without-turn-ID, stopped, pending-request and duplicate command-receipt cases.

Wave 1 units have independent behavioral tests but share contracts/adapter files. Use a single
writer per shared file and sequence contract changes; do not race unrelated agents on it.

## Wave 2: Restore sidebar lifecycle and navigation behavior

Owners LIFE-03/04/05/07/08/09/10/11/12/13/14 and EXT-06. LIFE-04's message-mode settle case depends on
the async-question core from INTERACTION-04; pull that core forward rather than making a false
completed settlement claim. LIFE-11's title-generation provider choice must be traced before
implementation, and uses the catalog work in Wave 4.

1. Separate lifecycle placement from live status. Render Pinned, Active, Snoozed, Settled with
   upstream precedence, per-owner capability fallback and row status. Idle alone is not settled.
   An unavailable capability descriptor cannot strand a row in an un-actionable shelf.
2. Give settle/snooze/archive separate guards. Manual settle may dismiss message-mode questions,
   clears pin+snooze and schedules conditional provider release. Native requests remain blocking.
   Snoozing running work does not interrupt it. Recheck stale stop before provider execution.
3. Carry distinct active order and pin order through DB/contracts/events/snapshots/writers.
   Implement every shelf drop, empty target, hidden key, history sort and optimistic acknowledgment.
   Reordering an active row must not secretly pin it. Keyboard and pointer paths share intent.
4. Match visit/unread/mark-unread and derived snooze wake. Initial unseen history is not all unread.
   Visits are monotonic. Retain wake source times and acknowledgment, including DST and timer edges.
5. Query every connected environment represented in search; preserve partial failures, current
   query generation and scoped IDs. Implement repository/repository_path/separate grouping with
   complete member refs and explicit physical versus group-wide actions.
6. Archive current row opens owner-project draft; delete chooses the upstream survivor. Retain
   failed **delete** selections; match other bulk actions' own selection/Undo rules. Do not
   extrapolate one delete rule to every action. Preserve local navigation safety explicitly.
7. Add title provenance/versioned generation and row/header/bulk actions, mark unread, copy
   identifiers, recoverable draft rows and inline last-reference worktree cleanup. Preserve
   retryable backend deletion and only close session-owned terminals, never all worktree shells.
8. Add notification settings and canonical-summary coordinator. Historical hydration/replay and
   archived activity do not notify. Input/failure/completion, sound, focus, badges and owner
   navigation follow upstream. Defaults remain off, not whatever is easiest to demonstrate.

Done: a two-environment fixture exercises every shelf/state/action, unknown capability, search
failure, grouping mode, exact wake boundary and partial deletion. Every newly exposed control
has a working domain action and persistence path, then a live browser scenario with screenshots.

## Wave 3: Preserve whole user intent through the composer

Owners INTERACTION-01/02/03/04/09/10/11/13. Deliver shared payload ownership before adding UI copies.

1. Define a complete composed-message value: text, images/files, typed source records and captured
   draft/environment identity. Migrate send, queue, stash, restore and rewind callers together.
2. Add queue-by-default follow-ups with one dequeue per eligible tool/turn boundary, gate resume,
   Send now/remove, alternate queue/steer, failed delivery and uncertain-receipt handling. Stop
   restores before interrupt RPC; excess attachments stay held until explicit user action.
3. Support advertised general-file uploads, progress/retry/cancel, preview/download, bounded
   staged persistence and expiry feedback. Draft reload and late upload completion cannot lose
   or resurrect removed payloads. Enforce the shared eight-attachment total across all paths.
4. Fix existing image/terminal stash pairing immediately; it need not wait for every new file
   type. Transfer complete snapshots atomically and retain the original on persistence failure.
5. Normalize async assistant questions into stable message-mode requests, distinct from native
   callback requests. Implement start/steer answer and resolution in one committed operation,
   then durable no-message dismissal, per-question files and guarded number shortcuts.
6. Extend the existing diff-selection-to-composer path with structured provenance and return
   navigation. Add assistant-selection citation and browser annotation through the same source
   record model. Browser capture awaits EXT-07; do not mark that subcase complete early.
7. Port artifact-template parsing/cards/actions with sanitization and streaming-partial tests.
   Wire rich editing, send-key modes, large-paste behavior and opt-in Plan/context-meter controls.
   Preserve IME, undo, mentions, existing file citations, Mermaid and current scrolling repairs.

Done: queue/stash/reload/Stop/rewind round-trip the same complete message; no attachment/context
switches owner. Both request modes have correct native behavior. Every send-key/IME combination
is driven in a real editor. Context-source absence reports unavailable rather than pointing at
different content. General file support remains provider-capability-aware.

## Wave 4: Match provider and agent capabilities

Owners RUNTIME-02/05/06/07/08/09/10, INTERACTION-06/07/08/12/14 and EXT-17.

1. Port advertised typed model option descriptors and exact selected IDs/defaults; remove the
   hardcoded fast boolean API and migrate callers. Existing Claude context support stays.
2. Deliver Cursor, Grok, OpenCode and Antigravity **one at a time** through the production registry.
   Match each driver's config/auth/status/models, invocation/resume, requests, stop and errors
   where supported, plus per-account isolation and reachable UI. Preserve explicit unsupported
   outcomes; do not require in-app authentication or history import universally. Upstream's
   history scanner supports Codex and Claude only. A registry entry is not a finished driver.
3. Add explicit compact operation and ordered follow-up lifecycle, coordinated with the queue.
   Preserve unsent draft, correlate success/failure and handle Stop/restart without duplicate work.
4. Add background child/workflow/monitor liveness to reaping and row indicators, periodic idle
   collection, workflow phase/script presentation and contained owner-aware script access.
5. Add account usage windows and verified reset-credit redemption; account-key serialization
   spans instances sharing a credential home. UI and backend use one quota model. Automated
   proof must not spend real credits.
6. Add capability-driven provider maintenance/install presentation with actual supported driver
   operations; distinguish automatic/manual-only setup, cancellation, version verification and
   catalog refresh. Installation breadth and live account flows are still open verification work.
7. Implement turn/paragraph/token answer delivery with upstream paragraph default and buffered
   reasoning. Final text and event identity must be identical across modes and reconnects.
8. Add multi-model draft sends with a separately prepared isolated worktree per target. Preserve
   per-target receipts and ambiguous outcomes; partial retry cannot duplicate a successful run.

Done: a driver/capability/account matrix is backed by adapter-boundary tests and real installed
provider smoke evidence. Full provider parity is open until those live paths run; never label
every generic capability supported because the contract permits it.

## Wave 5: Complete repository, setup, terminal and background workflows

Owners LIFE-06, EXT-01/02/03/04/05/10/12/14/15/18. EXT-13 ships earlier.

1. Implement five forge providers with exact capability/support/error outcomes, then PR review,
   linked sessions, composed commit/push/PR progress, PR-based sessions and refresh invalidation.
2. Add repository clone/publish with progress/cancel/retry and owned project registration. A
   canceled clone does not become a half-created project; remote-create/push partial success is
   explicit. Do not confuse branch publication with repository publication.
3. Import shared project scripts into trusted saved settings, preserve file `async` to saved
   `waitForSetup` mapping, gate foreground setup, and surface cancellation/failure/preview.
   A checked-out file cannot silently become executable settings.
4. Add raw PTY history persistence, clear/restart and ordered snapshot/live attachment. Remove
   viewer-absence kill of running jobs; keep explicit owned close and shutdown. Preserve raw-byte
   fidelity, Ghostty, durable provider transcript recovery and shared worktree lease safety.
5. Add automatic settlement with three-day default and PR closure policy, excluding explicit
   keep-active, unresolved PRs, pending work, effective snooze and background liveness. Reject stale
   decisions and retain last-work chronology. It is not equivalent to treating idle as settled.
6. Implement opt-in automatic storage cleanup through existing worktree ownership, reference
   and lease checks, with final revalidation after I/O. Only eligible sole candidates qualify;
   another archived reference also counts. Preserve dirty/main-checkout/ignored-data protections.
7. Add activity leases, host power policy, resource histories and management controls. Coordinate
   with Plan 125 rather than adding another observability system. Measure resource effects.

Done: real temporary Git/filesystem/process fixtures verify cancellation, partial failure,
ownership and destructive refusal. Real disconnected terminal survives and reconnects. Every
cleanup rule is off until its upstream opt-in setting authorizes it, with tested inheritance.

## Wave 6: Close the larger platform gap

Owners EXT-07/08/09/16. These remain visible work, not an exception list.

- Integrated browser preview/profile/navigation, capture/annotations/recording, device tools,
  browser/device automation and host failure recovery. Share composer context with Wave 3.
- Remote pairing/session scopes/revocation, endpoint discovery and supported relay lifecycle.
  Existing SSH and mesh reachability do not imply per-device authorization equivalence.
- Desktop activation/deep links, capture, update/restart and OS integrations; mobile client and
  install/update/distribution workflows. Enumerate host-specific outcomes before implementation.
  Existing Electrobun/Mac/TUI code is reused where it supplies the behavior; merely having a
  client directory does not count as a matching mobile/desktop experience.

First deliverable for each subsystem is an operation/OS/capability matrix and runnable host test
adapter. Then implement complete vertical paths with unavailable/permission-denied/crash/reconnect
cases. Publish separate executable subplans if these boundaries cannot fit one reviewable unit.
They may not be marked “done” from web screenshots or mock host responses. Plan 087/088 own related
native MCP infrastructure; reuse that ownership while making every upstream operation explicit.

## Related plans from the 2026-09-24 survey

Plans 138–145 came from the same survey of T3 Code and other agent tools. Where one overlaps a
group here, this plan keeps the upstream acceptance cases and the other plan owns the
implementation or a Platform-specific extension. Implement once, then close both.

| Plan                                                                 | Overlapping groups                     | Split                                                                |
| -------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| 138 — Claude models from the CLI                                     | RUNTIME-06, RUNTIME-10, INTERACTION-14 | 138 owns the Claude catalog, binary and reported version             |
| [139 — acting on the agent's diff](139-acting-on-agent-diffs.md)     | INTERACTION-09, EXT-02                 | 139 owns hunk keep/undo and review; review sources stay here         |
| [140 — the editor as agent advantage](140-editor-agent-advantage.md) | INTERACTION-09                         | 140 owns editor-to-agent context; assistant citation stays here      |
| [141 — usage and rate limits](141-usage-and-rate-limits.md)          | RUNTIME-08, INTERACTION-07, EXT-17     | 141 implements quota surfaces and the usage page                     |
| [142 — web push notifications](142-web-push.md)                      | EXT-06                                 | 142 owns delivery to a closed tab or phone; policy stays here        |
| [143 — phone layout](143-phone-layout.md)                            | EXT-09, INTERACTION-11 mobile Enter    | 143 owns the responsive layout discussion; the mobile app is EXT-09  |
| [144 — unattended agent work](144-unattended-agent-work.md)          | INTERACTION-12, EXT-10                 | 144 owns scheduling and loops; workflow inspection stays here        |
| [145 — harness controls](145-harness-controls.md)                    | RUNTIME-05, INTERACTION-06, RUNTIME-03 | 145 owns surfacing native CLI controls; upstream semantics stay here |

## Pinned default and policy table

These values were read from upstream `packages/contracts/src/settings.ts`, not guessed.

| Behavior                             | Pinned value                                             | Source line    |
| ------------------------------------ | -------------------------------------------------------- | -------------- |
| Follow-up send                       | queue; alternate action inverts                          | 438-439        |
| Rich composer                        | enabled                                                  | 433            |
| Plan-mode control / context meter    | disabled by default                                      | 426, 429       |
| Response delivery                    | paragraph; modes turn/paragraph/token                    | 1061-1062      |
| Project grouping                     | repository; also repository_path/separate                | 61-67, 448-454 |
| Thread sort preference               | updated_at                                               | 57-59          |
| Automatic settlement                 | 3 days, merge/closure policy enabled                     | 87, 1132-1135  |
| Archive/delete/unpin confirmation    | false / true / false                                     | 353-355        |
| Notifications / in-app notifications | off / false                                              | 291-294        |
| New thread environment               | local                                                    | 1173-1174      |
| New worktrees start from origin      | true                                                     | 1176-1177      |
| Worktree cleanup override            | null, resolve effective inherited rules                  | 1051           |
| Storage cleanup rules                | age/log/artifact retention null; worktree booleans false | 1038-1047      |

Other source policies: eight provider attachments (`orchestration.ts:166`); retained live budget
1,000 items and 8 MiB (`LiveStreamBudget.ts:9-10`); provider idle window 30 minutes, periodic sweep
5 minutes (`ProviderSessionReaper.ts`). Register user-facing settings only with working consumers
and regenerate `docs/settings-reference.md` via `bun run settings:reference`.

## Verification and delivery contract

Use the narrowest check that catches the named failure. Existing app tests run through Bun,
browser tests through the separate browser configuration, shared runtime-neutral packages through
plain Vitest. Import app fixtures and execute the real in-process server; mock external providers,
forges or unspawnable processes only. Do not write tests that merely copy the local condition.

From repository root, the first delivery's focused commands are:

```bash
python plans/126-t3code-alignment/inventory.py
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
```

From `apps/server`:

```bash
bun --bun vitest run src/orchestration/tests/session-lifecycle.test.ts src/orchestration/tests/decider-invariants.test.ts
bun --bun vitest run src/orchestration/tests/checkpoint-reactor.test.ts
bun --bun vitest run src/provider/adapters/tests/codex.test.ts
bun --bun vitest run src/orchestration/tests/streams.test.ts
bun --bun vitest run src/git/tests/push-and-pull-request.test.ts
```

From `apps/web`:

```bash
bun --bun vitest run --project node src/features/chat-mode/utils/tests/session-rail-model.test.ts src/features/chat/state/tests/chat-projection-selectors.test.ts
bun --bun vitest run --project dom src/features/chat-mode/components/tests/session-rail.test.tsx
```

Expected: relevant new counterexamples fail before their fixes and pass afterward; existing
characterization cases stay green unless they enforce a documented divergence being replaced.
Compare baseline deltas for unrelated existing failures. Do not use absolute test counts.

For every UI delivery add/extend named scenarios in `scripts/agent/scenarios/`, centralized
selectors and the feature map. Proposed names in the appendices are **not existing commands**
until registered. Use `bun run agent:browser list` to confirm, then `scenario <name>`, inspect
screenshots and wide logs and record the evidence directory. Performance/resource claims require
`trace <scenario> --compare <before-dir>`; render claims require before/after `renders` evidence.

The dev server at `localhost:5173` was unavailable in the preceding investigation; never start
or restart one just to make proof convenient. Mesh homepage health was checked at
`/work/tmp/fregat-evidence/20260920T105844Z-look-platform-1440x1000/`. That evidence proves only
homepage availability. At audit time, browser/provider/platform cases had not run. The delivery notes now record completed cases; unverified host/provider paths remain open.

After each implemented, verified unit deploy through `bun run deploy --slug=t3code-<unit>`;
server changes require `--server` per repository policy. Record the release response and live
check evidence. Coordinate shared file work before a restart; no restart for web-only changes.
Completed implementation deliveries deploy through this procedure.

## Completion criteria and unresolved coverage

- Every ledger group is implemented and has focused test plus applicable live evidence.
- Every RPC/command/default and capability branch maps to a local entry point or an explicitly
  tested upstream unsupported outcome. Every UI consumer has a real effect and every exposed
  server effect has its intended consumer. No inventory-only row is silently counted as matched.
- Cross-environment IDs/accounts, multiple clients, interrupted operations, stale snapshots,
  offline/reconnect, reload/restart, cancellation and concurrent user actions are included.
- Negative oracle controls fail; upstream revision changes require review; no local test may
  redefine upstream expected behavior to make the suite green.
- Deployment and native/provider matrix evidence is recorded. No unscheduled capability is
  reclassified as “by design” merely to close this plan.

Still requiring deeper/runtime investigation: complete import/history formats, provider login
and installation paths per account, update continuation/crash windows, every native/mobile/OS
integration, hosted relay/service policy, all forge actions, hardware capture/devices, exact
terminal output equivalence, keyboard/accessibility across host platforms, and resource behavior.
The census also inventories filesystem/base/editor/settings operations beyond the specific
confirmed findings. Their detailed mapping is Wave 0 work, not a claim that all 146 methods
already received an end-to-end audit. This list stays open until evidence closes it.

If source drifts, a capability proves unsupported upstream, or a safety/ownership mapping is
unclear, recheck the pinned implementation, update the finding and its tests, and record the
decision. Do not improvise a new behavior and call it alignment. Preserve source attribution
and upstream license notices when porting implementation or fixture corpora.
