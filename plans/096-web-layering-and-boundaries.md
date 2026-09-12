# Settle apps/web layering

Status: proposed, implementation not started. Requested 2026-09-11.

This plan moves `apps/web` modules to the layer that owns them and deletes two dead surfaces. It
covers duplication-census items 7.3, 7.4, 7.5, 7.6, the dead-export half of 8.9, and 9.13.
[Root PLAN.md](../PLAN.md) owns execution order. It is independent of
[Plan 090 regression record](../docs/duplicate-defect-regressions.md), [Plan 091](091-error-and-timing-helpers.md),
[Plan 092](092-path-and-uri-helpers.md), [Plan 093](093-web-react-and-store-ceremony.md),
[Plan 094](094-client-core-web-tui-parity.md) and [Plan 095](095-server-plumbing.md), but it renames
and moves files those plans also edit. Run it last: rebasing a rename under their content edits is
cheaper than rebasing their content edits under a rename.

The governing rule is `AGENTS.md`'s `lib/` rule, and it runs both ways. A `lib/` module with one
consumer outside `lib/` moves down into that consumer. A feature-local module that has gained a
second feature consumer moves up in the same pass. `lib/` must never import from `@/features/*`.
Feature-aware command and enablement policy belongs in `keymap/`, beside the command registry —
not in `lib/`, not in `components/`.

## Count consumers the same way every time

Every move below carries a verified count. The method, applied at this baseline and to be re-run
before each step:

```
grep -rn "<module specifier>" apps/web/src            # import lines
grep -rln "<module specifier>" apps/web/src           # distinct files
```

Exclude the module itself, then bucket by `features/<name>` (each feature counts once),
`components/`, `hooks/`, `keymap/`, `state/`, `lib/` and `main.tsx`. Counts are reported twice
where they differ: import lines, and consumer buckets. Test files are excluded from the bar and
called out separately when they change the picture.

## Reconcile the baseline

Platform base `75caae889d967fed0e0c8df85aa315670ef9fe49`. Working tree is clean apart from the
sibling plans in `plans/`. Re-run the drift check and capture HEAD plus the full dirty diff before
editing.

| Existing owner                                           | Work to build on                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/src/lib/file-server.ts`                        | The only production `lib/` → `@/features/*` import, at `:16`               |
| `apps/web/src/features/workspace/utils/coalesced-log.ts` | 62-line generic queue; the only domain choice is `countField` (`:9`)       |
| `apps/web/src/features/menus/`                           | Nine files; resolves menu items against the command registry               |
| `apps/web/src/keymap/`                                   | The layer allowed to know features — 51 non-test `@/features/*` imports    |
| `apps/web/src/lib/environments/state/scoped-storage.ts`  | `globalChromeStorage` (`:16`) and `environmentScopedStorage` (`:29`)       |
| `apps/web/src/lib/workspace-cache-storage.ts`            | Delete-and-report reader (`:33`), non-throwing writer (`:61`)              |
| `apps/web/src/lib/query-keys.ts`                         | Shared query-key groups, including two with one consumer each              |
| `apps/web/src/features/git/utils/types.ts`               | Five contracts aliases at `:9-13` plus real feature types below them       |
| `apps/web/src/features/environments/`                    | Fifteen files, all tests; the implementation sits in flat kind directories |
| `packages/contracts/src/order-key.ts`                    | `orderKeyBetween`, `generateSpreadOrderKeys`, `isValidOrderKey` stay       |
| `apps/server/src/orchestration/routes.ts`                | WS RPC is the live subscribe surface; two SSE routes shadow it             |
| `packages/ui/src/components/empty-state.tsx`             | `EmptyState` (`:27`) has a stacked `icon` slot and no `role`               |

## Delete what nothing calls

Pure subtraction. Neither step is a merge and neither needs a divergence reconcile — only proof of
no consumers. Both can land at any point in the plan.

**8.9 — unused contracts order-key exports.** `planPinnedReorder`
(`packages/contracts/src/order-key.ts:107`) and `sortByOrderKey` (`:169`) are exported from
`packages/contracts/src/index.ts:28-29` and have zero production callers. Verified callers: only
`packages/contracts/src/tests/order-key.test.ts`, `apps/server/src/orchestration/tests/session-lifecycle.test.ts:425`
and `apps/server/src/orchestration/tests/project-ordering.test.ts:153`. The live rail work is
`packages/client-core/src/chat/rail/{session-order.ts:17, project-order.ts:20, reorder.ts:44}`.

Delete both exports, their index entries, the now-orphaned helpers `singleOrderKeyWrite` (`:131`),
`readOrderKey` (`:186`), `compareOrderKeys` (`:190`) and `compareNewestCreatedFirst` (`:199`), and
the tests that exist only to exercise them. Keep `isValidOrderKey` (`:16`, consumed by
`packages/contracts/src/chat-model.ts:147` and `apps/server/src/orchestration/command-invariants.ts:105`)
and `orderKeyBetween` (`:58`, consumed by `packages/client-core/src/chat/rail/reorder.ts:67`).

This is a delete rather than a merge because contracts holds a third opinion, not a shared home:
`planPinnedReorder` re-spreads the whole section when a neighbour is keyless (`:119-128`), while
`railReorderIntent` deliberately never re-spreads (documented at `reorder.ts:38-43` as the closest
position the single-key model can express). `sortByOrderKey` puts keyless rows newest-created first
(`:180`, `compareNewestCreatedFirst`); `compareSessionsForRail` agrees, but `compareProjectsForRail`
sorts `left.createdAt - right.createdAt` — the opposite — and its header says why. One sort cannot
serve both lists.

Two live backlinks must be fixed in the same commit: `docs/logseq-parity-gap-matrix.md:92` and
`:357` cite `planPinnedReorder` as "already used for the chat rail
(apps/web/src/features/chat-mode/utils/rail-reorder.ts:67)". That file does not exist at this
baseline; the real caller is `packages/client-core/src/chat/rail/reorder.ts:67` calling
`orderKeyBetween`. Correct both rows rather than deleting them.

**9.13 — two SSE routes with no client.** `apps/server/src/orchestration/routes.ts:216`
(`/shell-stream`) and `:233` (`/session-detail-stream`) duplicate the WS RPC subscribe surface. The
only HTTP callers are `apps/server/src/orchestration/tests/engine.test.ts:484` and `:525`. Every
production client reaches these streams over WS RPC — `packages/client-core/src/transport/orchestration-rpc-client.ts:217`
against `apps/server/src/orchestration/ws-rpc.ts:349`.

Delete both route registrations and the tests that drive them. The cascade inside `routes.ts`:
`ORCHESTRATION_STREAM_HEARTBEAT_MS` (`:21`), `streamQuerySchema` (`:27`),
`sessionDetailStreamQuerySchema` (`:52`) and the `sseResponse, toSse` import (`:17`) all lose their
last use. Keep `apps/server/src/sse.ts` — five other route modules use it. Keep the engine
generators `shellStream` and `sessionDetailStream`; WS RPC is their live consumer.

## Make the lib/ rule enforceable

This prerequisite is complete through [Plan 098](../docs/document-and-tab-domain.md).
`apps/web/src/lib/coalesced-log.ts` contains the unchanged queue, and its test lives at
`apps/web/src/lib/tests/coalesced-log.test.ts`. File-server and workspace tree hooks consume
that shared implementation.

The configured `platform-boundaries/lib-imports` Oxlint rule rejects production shared-layer
imports of features, including type-only, relative, re-export, and dynamic imports. Its exact
file-suffix test exceptions and actual CLI calibration are installed in normal lint and
`test:scripts`. Reuse this guard; the move and enforcement need no further implementation here.

## Demote the lib/ modules below the bar

Each move below is justified by a count taken at this baseline.

| Module                                        | Verified consumers                                                                                                                                                                                                       | Action                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `lib/environments/utils/scoped-record.ts`     | 2 lines, 1 bucket: `features/chat/state/session-diff-scope-store.ts:1`, `features/chat/state/chat-changed-files-expansion-store.ts:1`                                                                                    | Move to `features/chat/utils/scoped-record.ts`                |
| `lib/platform/hydrate-picked-entry.ts`        | 1 line, 1 bucket: `components/use-pick-entry.tsx:7`                                                                                                                                                                      | Fold into `components/use-pick-entry.tsx`                     |
| `documentSymbolKeys` (`lib/query-keys.ts:52`) | 2 lines, 1 bucket: `features/command-palette/use-command-palette-symbols.ts:8,:51`                                                                                                                                       | Move the group into `features/command-palette/`               |
| `logsKeys` (`lib/query-keys.ts:59`)           | 10 lines, 1 bucket: `features/logs/hooks/{use-events.ts:5, use-summary.ts:5, use-live.ts:5}`, `features/logs/components/panel.tsx:5`                                                                                     | Move the group into `features/logs/`, with its `:58` comment  |
| `lib/react-error-reporting.ts`                | 2 lines, 2 buckets: `main.tsx:29`, `components/logging-error-boundary.tsx:24`                                                                                                                                            | **Leave.** Meets the bar                                      |
| `lib/platform/window-drag.ts`                 | 3 non-test lines, 1 bucket but 3 sibling files: `components/{app-titlebar.tsx:9, ui-mode-toggle.tsx:7, workspace-project-menu.tsx:21}`                                                                                   | **Leave.** Two shared string constants, no logic              |
| `lib/recent-folders-query.ts`                 | 4 lines, 3 buckets: `features/workspace/state/open-root.ts:13`, `features/workspace/hooks/use-restore-recent-root.ts:14`, `features/workbench/hooks/use-titlebar-menu.ts:11`, `components/workspace-project-menu.tsx:22` | **Leave.** Census said move it down; the count says otherwise |

Two notes the implementer must not skip.

`lib/path-formatters.ts:8` names `lib/platform/hydrate-picked-entry.ts` inside the `basename`
warning comment. That comment is the repository's written record of the six-variant trap and
[Plan 092](092-path-and-uri-helpers.md) owns it. Update the path there in the same commit as the
fold and tell 092; do not delete or reword the warning.

`documentSymbolKeys` and `logsKeys` are the one place the rule is applied at export granularity
rather than module granularity. `lib/query-keys.ts` as a module qualifies for `lib/` several times
over. Moving two key groups out of it is a judgement that a query-key group with a single feature
consumer is that feature's private state, not shared vocabulary. Settle it before writing code — see
the decisions section.

## Fix the shared storage accessor before adopting it

`globalChromeStorage` (`lib/environments/state/scoped-storage.ts:16`) guards
`typeof localStorage === 'undefined'` through `browserStorage()` (`:12`) and has **no try/catch** on
any of its four accessors (`:17`, `:18`, `:19`, `:20`). Safari private browsing throws
`QuotaExceededError` from `setItem`, and hardened site-data settings throw `SecurityError` from
`getItem`. Today that takes down every caller. The only function in the file with a catch is
`storedEnvironmentScopes` (`:41`).

The blast radius is larger than the import count suggests. Verified: 31 non-test modules across 7
buckets (`features/chat`, `features/chat-mode`, `features/editor`, `features/workbench`,
`features/workspace`, `lib`, `state`) import this module. Only `lib/workspace-cache-storage.ts:1`
names `globalChromeStorage` directly; every other site reaches it through `environmentScopedStorage`
(`:29`), whose four accessors (`:32-36`) delegate to it verbatim.

**Step 1 — add a try/catch to each of the four accessors.** This is a pure improvement for every
existing consumer even if nothing is ever repointed at it, and it must land before any repointing.
`getItem` and `keys` return the empty answer; `setItem` and `removeItem` return.

**Step 2 — repoint the three hand-rolled sites.** Behaviour to reconcile, per site:

- `state/connected-machines.ts:3` (read) and `:14` (write) — has try/catch, **no** undefined guard.
  Repointing adds the guard it lacks.
- `features/address/state/storage.ts:6` (write) and `:33` (read) — has both. Repointing is
  structural only.
- `features/command-palette/state/recent-commands-store.ts:51` (read) and `:70` (write) — has both.
  Repointing is structural only.

Validation stays per site in all three cases; the accessor moves, the schema check does not.

**Leave `features/settings/utils/boot-mirror.ts:121` and comment it.** It runs before React mounts
to pick the first-paint theme and deliberately owns a synchronous path. A comment saying so is the
deliverable; a repoint is not.

## Adopt the shared cache storage deliberately

Six chat modules reimplement `lib/workspace-cache-storage.ts`, which `features/chat` already uses
from `state/provider-display-cache.ts:27` and `:38`. The six:

| Module                                                   | Read  | Write |
| -------------------------------------------------------- | ----- | ----- |
| `features/chat/utils/draft-storage.ts`                   | `:62` | `:80` |
| `features/chat/utils/changed-files-expansion-storage.ts` | `:46` | `:67` |
| `features/chat/utils/session-diff-scope-storage.ts`      | `:58` | `:79` |
| `features/chat-mode/utils/session-read-storage.ts`       | `:20` | `:34` |
| `features/chat-mode/utils/rail-collapse-storage.ts`      | `:21` | `:35` |
| `features/chat/state/prompt-stash-store.ts`              | `:42` | `:60` |

Four differences to reconcile, one of them a behaviour change the user can observe. Do not adopt
before each is answered.

1. **Write safety.** `writeWorkspaceCacheEntry` (`:61`) returns `{ status: 'storage-failed' }`
   (`:86`) and never throws. Of the six writers, four throw on a full store
   (`draft-storage.ts:80`, `changed-files-expansion-storage.ts:67`, `session-diff-scope-storage.ts:79`,
   `session-read-storage.ts:34`), one swallows silently (`rail-collapse-storage.ts:35`, catch at
   `:47`), and one returns a boolean its caller acts on (`prompt-stash-store.ts:60`). Adopting the
   shared writer turns four throwing writes into silent no-ops. Check each of the four callers
   before changing it. `prompt-stash-store`'s boolean must survive the move — map
   `status === 'written'`; its own header (`:33-35`) says a failed write must not report success,
   because the caller clears the composer on a true.

2. **Bad entries.** `readWorkspaceCacheEntry` **deletes the key** (`:51`, `:55`) and reports a
   structured error (`:52`, `:56`) on a parse or schema failure. All six readers silently return
   their fallback. This is the behaviour change, and it is the one worth taking: a preference that
   cannot be parsed is not worth keeping. Per `AGENTS.md`'s greenfield rule, write no healing or
   migration code for what the current readers left behind — the shared reader's delete _is_ the
   disposal. A developer who wants a clean slate clears the localStorage keys matching
   `env:*|platform.chat-input-drafts.v1`, `env:*|platform.chat-changed-files-expansion.v1`,
   `env:*|platform.chat-session-diff-scope.v1`, `env:*|platform.chat-session-reads.v1`,
   `env:*|platform.chat-rail-collapse.v1` and `env:*|platform.prompt-stash.v1`.

   Fix one thing before adopting: `reportInvalidCacheEntry` (`:107`) reports `code: 'INVALID_PATH'`
   for an unparseable cache entry. That code is wrong today and becomes six times more visible after
   adoption. Pick the right code from the taxonomy and tell [Plan 091](091-error-and-timing-helpers.md),
   which owns the catalogs.

3. **Prune timing genuinely differs and stays at the call site.** changed-files prunes on read
   (`:59`), diff-scope prunes on read (`:71`), session-read prunes on write (`:34` →
   `prunedSessionReads` at `:47`), rail-collapse does `slice(0, MAX)` on write (`:43`) with no
   recency sort at all. `readWorkspaceCacheEntry` prunes nothing — it only enforces
   `maxSerializedBytes` (`:42`). The shared module is not a home for pruning; do not invent one.

4. **Sort key differs.** session-read orders by ISO string `localeCompare` descending (`:57`);
   changed-files (`:88`) and diff-scope (`:100`) order by numeric `updatedAt` descending. Keep each.

Take the `scoped-record-storage` extraction below first — it is the only pair that is genuinely one
module written twice. The other four are the "six shared lines against four behaviour changes" case;
if the decisions above come out conservative, leaving them alone is the correct outcome and this
step reduces to the shared accessor fix.

## Extract inside the feature that owns it

Nine extractions, each landing inside the feature that already owns both sites. None of these moves
a module into `lib/` unless its second consumer is verified to be in another bucket.

**a. One scoped-record storage module, twice.** `features/chat/utils/changed-files-expansion-storage.ts:46-107`
and `features/chat/utils/session-diff-scope-storage.ts:58-119` are the same four functions with
`expansionByKey` renamed to `scopeBySessionKey`, including a byte-identical four-line comment
(`:92-96` and `:104-108`). Home is `features/chat/utils/scoped-record-storage.ts`, **not** `lib/` —
both modules and every consumer sit inside `features/chat`.

Reconcile first: the version literals differ (`changed-files-expansion-storage.ts:5` is `1`,
`session-diff-scope-storage.ts:6` is `2`), so version stays a per-instance argument, never a shared
constant. The record key name is part of the persisted JSON, so it must be parameterised —
collapsing it to one name silently drops every stored preference on the next read. That is
acceptable under the greenfield rule, but only as a deliberate choice, not a side effect.
`reconcileSessionDiffScope` (`session-diff-scope-storage.ts:132`) stays where it is.

**b. One field-token ranker, two calibrations.** `features/chat/utils/composer-command-search.ts`
(253 lines) and `features/chat/utils/model-picker-search.ts` (170). Home is
`features/chat/utils/field-token-ranker.ts` — both consumers are chat surfaces. **Not**
`packages/contracts/src/fuzzy-rank.ts`: that is higher-score-wins over a fixed `{label, path,
keywords}` target (`:35`, `:63`), sums per token with no cap, and a merge into it erases the
composer's guarantee.

`tokenScore` is byte-identical (`composer-command-search.ts:162`, `model-picker-search.ts:92`), as is
`boundaryMatchIndex`. Six constants have drifted and **every one changes result order**:

| Constant                  | Composer                               | Picker                               |
| ------------------------- | -------------------------------------- | ------------------------------------ |
| `FIELD_PENALTY_STEP`      | `200` (`:21`)                          | `10` (`:20`)                         |
| Tier offsets              | `0/20/40/60/120` (`:24-28`)            | `0/2/4/6/100` (`:23-27`)             |
| `BOUNDARY_MARKERS`        | includes `:` and `.` (`:34`)           | no `:` or `.` (`:32`)                |
| Position penalty          | clamped at 8 (`:35`, `:248`)           | raw `index * 2` (`:113`, `:118`)     |
| `lengthPenalty`           | `min(16, …) / 2` (`:252`)              | `min(64, …)` (`:169`)                |
| `subsequenceScore` result | clamped at 60, no length term (`:236`) | unclamped, with length term (`:163`) |

The composer's clamps enforce a documented invariant (`:12-17`): no penalty inside a tier may carry
a candidate past the next tier. The picker's tiers bleed. Make the constants data, keep both sets,
and decide explicitly whether the merge fixes the bleed — no test today would catch either answer.
Existing coverage is `features/chat/utils/tests/composer-command-search.test.ts` and
`features/chat/utils/tests/model-picker-search.test.ts`.

**c. Route prefixes, collapsed in place.** `features/address/utils/route-options.ts` holds a local
and a remote copy of the same three builders: `localAddressOptions:237` / `remoteAddressOptions:308`,
`localChatOptions:282` / `remoteChatOptions:363`, `localCheckpointOptions:293` /
`remoteCheckpointOptions:379`. All eight editor-kind branches plus both chat and both checkpoint
builders differ only by the prefix. Collapse in place with
`const PREFIX = { local: '/~{$workspace}', remote: '/@{$environmentId}/~{$workspace}' } as const`;
the precedent is `state/routes/workbench.ts:59` parameterising over the two parent routes.

The one constraint: `to` must stay a literal type for TanStack Router. Build it as a
template-literal type off `PREFIX[K]`, not as a runtime string concatenation.

**d. One search-result keyboard handler behind a navigator port.**
`features/search/components/results-view.tsx:371` (`handleSearchResultKeyDown`, helpers at `:422`,
`:439`, `:458`) and `features/search/utils/result-editor-keyboard.ts:17`
(`handleSearchResultSurfaceKeyDown`, helpers at `:71`, `:88`). Home is one
`searchResultTreeKeyDown` in `features/search/utils/result-tree-keyboard.ts`, parameterised over a
port `{ idByOffset, firstId, lastId, childId, parentId, canCollapse, commit }`.

Three real forks, verified:

- ArrowLeft on an expanded, empty file **bails** on the surface (`result-editor-keyboard.ts:103`,
  `if (active.file.excerpts.length === 0) return`) and **collapses** on the sidebar — no such guard
  before `results-view.tsx:455`.
- Enter on a group header **opens the file** on the surface (`result-editor-keyboard.ts:66-68`, via
  `searchResultOpenTargetForId`) and **expands** on the sidebar (`results-view.tsx:466-468`).
- ArrowRight falls back to `active.file.id` (`result-editor-keyboard.ts:85`) versus `active.id`
  (`results-view.tsx:436`), and the surface's excerpt lookup is by row type rather than item order.

Neither handler guards modifier keys — verified: zero `metaKey`, `ctrlKey`, `altKey` or `shiftKey`
reads in either file, so Cmd+ArrowDown is swallowed by both. Fix that in the shared handler.

Do not merge the two view models first. The port is what makes the row shapes irrelevant.

**e. Document schemes: completed by Plan 098.** The [shared document/tab domain](../docs/document-and-tab-domain.md)
replaces the old feature codecs, classifiers, and label parsing. Preserve its typed descriptors
and shared boundary rather than implementing standalone codec factories.

Its characterized distinctions remain: empty search roots are valid; empty conflict and
compare payloads are invalid; Git references require a path and ref; snapshot payloads allow an
empty path when they have an object ID. Invalid ambiguous synthetic inputs never become files.
An explicit file resource or `f/` URL token uses the filesystem namespace without reclassification.

**f. Share only the FNV-1a per-character step.** Six open-coded copies:
`packages/client-core/src/address/path-hash.ts:2`,
`features/editor/utils/theme-content-hash.ts:3`, `features/editor/utils/text-snapshot.ts:51`,
`features/editor/utils/diff-documents.ts:121`, `features/chat/utils/markdown-highlight.ts:47`,
`features/search/utils/result-items.ts:39`. Export `fnv1a32(value): number` from
`packages/client-core/src/address/path-hash.ts` beside `stablePathHash` and add the exports entry.

The mixing loop is identical; the output encodings are not, and two of them outlive a render:

- `diff-documents.ts:textKey` emits unpadded base36 (`:128`) embedded in a phantom filename that a
  language server's project globs must match — changing its width or alphabet renames every phantom
  diff document.
- `text-snapshot.ts:textHash` (`:51`) returns the **raw signed** number, emitted as
  `h:<len36>:<hash36>` by `contentRevision` (`:61`) and compared against persisted revisions.
- `markdown-highlight.ts:47` folds `>>> 0` inside the loop — verified a no-op for the result.
- `result-items.ts` is **not a string hash**: `hashSearchMatchLocation` (`:326`) walks seven fields,
  skips empty ones (`updateStableHash:355`), separates with a zero byte, memoises through a
  `Map(4096)` (`:41`, trimmed at `:394`) and a `WeakMap` (`:42`), and its output is a DOM id.

Share `updateStableHashCode`-shaped stepping only. Keep every wrapper exactly as it is.

**g. One Copy Path menu section.** `features/workspace/utils/row-menu.ts:141`,
`features/workbench/utils/editor-tab-menu.ts:49` and `features/git/utils/file-menu.ts:77`. Home is
`features/menus/utils/copy-path-section.ts`, which travels with the menus move below and lands as
`keymap/menus/utils/copy-path-section.ts`. **Not `lib/`** — `lib/` may not depend on the menu model.

Reconcile: the tree row menu disables the absolute-path item when the row has no loaded entry
(`row-menu.ts:143`, `disabled: unresolved`) and passes `context.path ?? ''` (`:147`); the other two
always enable it. The relative-path item is enabled in all three, including the unresolved case —
deliberate, keep it. `features/chat-mode/utils/project-menu.ts:87` is a genuinely smaller menu with
one item, not a truncated copy; leave it.

**h. One search-match → `FsEntry` projection.** `features/command-palette/command-palette-utils.ts:72`
and `features/file-picker/picker-search.ts:135`. Two buckets, so `apps/web/src/lib/search-match-entry.ts`
qualifies.

Additive only: the picker carries `searchScope` (`picker-search.ts:140`), the palette wraps with
`pathLabel: toTreePath(…)` (`command-palette-utils.ts:86`). Both call the same `basename` —
checked, because this is the named trap: `command-palette-utils.ts:31` imports it from
`@/lib/path-formatters`, and `picker-search.ts:8` imports it from `@/features/file-picker/model`,
which re-exports the same function at `model.ts:7`. The synthetic version string
`` `search:${mtimeMs}:${size}` `` is a cache key duplicated at `command-palette-utils.ts:357` and
`picker-search.ts:159`; it currently agrees by accident. Export it so it agrees by contract.

**i. Four hand-rolled empty notices while `EmptyState` is the house primitive.**
`features/git/components/diff-notice.tsx:8`, `features/editor/components/compare-saved-view.tsx:70`,
`features/git/components/panel.tsx:131`, `features/logs/components/event-list.tsx:41` — while
`panel.tsx` already uses `EmptyState` twice at `:90` and `:101`.

This is a deliberate visual change, not a no-op. `DiffNotice` carries `role='status'` (`:21`) and an
inline icon (`:23`) at `p-6 text-xs`; `CompareNotice` carries neither, at `h-full p-4 text-sm`, so
"Could not read the saved file." is announced to nobody. `EmptyState`
(`packages/ui/src/components/empty-state.tsx:27`) differs from both again: it has an `icon` prop
(`:33`, `:42`) but renders it stacked above the title at `size-6` (`:61-65`), and has no `role`. Add
`role='status'` and an inline-icon option to `EmptyState` first, then convert the four call sites.

Separately, and in the same commit: `event-list.tsx:41` branches on `events.length === 0` only, so
it renders "No logs match the current filters." while the query is still pending. `AGENTS.md`
requires branching on pending before empty. [Plan 090 regression record](../docs/duplicate-defect-regressions.md) owns the
doubled error banner in the same feature and [Plan 094](094-client-core-web-tui-parity.md) owns the
log-dashboard client move; all three touch `features/logs/*` and should land together or in a
declared order.

**j. Four smaller same-shape pairs, each with a real divergence.** The git-alias deletion and the
recent-folders duplication from this census row are handled in Pass B and in the demotion table
above. The remaining four:

- **Active editor tab on a null id.** `features/workspace/state/cache.ts:701`
  (`activeEditorTabIdForTabs`) returns `editorTabs[0]?.id ?? null` when the id is unset — it promotes
  the first restored tab. `features/workbench/utils/panels.ts:235` (`normalizedActiveTabIdFor`)
  returns `null` for the same input. Both then fall back to the first tab when the id is set but
  missing. The difference is deliberate and undocumented. Export one
  `activeEditorTabId(tabs, currentId, { fallbackToFirstWhenUnset })` from `panels.ts` and make the
  flag the only thing the two call sites disagree about.
- **`ActionCluster` inlined twice.** `features/git/components/group-actions.tsx:102` is a named
  component; `features/git/components/file-actions.tsx:10` and `:17` inline the same class string.
  They are **not** identical: the component uses `group-hover/group:` and both inline copies use
  `group-hover/row:`. Extracting one component must parameterise the hover group name, or the file
  rows lose their reveal entirely — and a missing hover state is invisible in a snapshot test.
- **Grid class re-typed in the skeleton.** `features/file-picker/list.tsx:719` (`fileListGridClass`,
  used at `:111` and `:453`) branches with an early return, so an unknown mode falls through to the
  file class. `features/file-picker/components/list-loading.tsx:14` and `:16` re-type both class
  strings as `mode === 'folder' && …` / `mode === 'file' && …`, so a third mode gives the skeleton no
  grid class at all. Export `fileListGridClass` and use it in the skeleton; the early-return shape
  wins.
- **Two reduced-motion reads that fail in opposite directions.**
  `features/workbench/utils/wallpaper.ts:14` returns `false` when `window` or `matchMedia` is absent,
  so motion is allowed. `features/workbench/hooks/use-active-tab-strip-scroll.ts:59` reads
  `window.matchMedia` with no `typeof window` guard — it throws without `window` — and returns
  `'auto'` when `matchMedia` is missing, suppressing motion. Keep the wallpaper one and repoint the
  scroll hook at it.

## Move the layers that are not features

Three passes. Each is mechanical, each touches a large fraction of the app, and **none may share a
commit with anything else** — including with each other.

**Pass A — `features/menus` is an app layer, and its home is `keymap/`.** Verified: 52 import lines
across 42 files in 8 buckets — `features/git` 10, `features/workbench` 9, `features/chat-mode` 8,
`features/chat` 8, `features/terminal` 5, `features/editor` 5, `features/workspace` 4, `keymap/` 3.
It imports nothing from `@/features/*` except itself; its outside dependencies are `@/keymap/*` and
`@/lib/*` only.

Home is `apps/web/src/keymap/menus/{components,hooks,utils}`, **not `lib/menus/`**.
`features/menus/utils/resolve.ts:3` reads the command registry (`platformCommandSpec`) to derive
each item's title, shortcut and enabled-or-disabled reason. That is command-enablement policy, and
`AGENTS.md` puts it in `keymap/`. `keymap/` is already the layer permitted to know features — 51
non-test `@/features/*` imports at this baseline — while `lib/` must not import them at all, which
the earlier step makes checkable. The presentational pieces go with it:
`features/menus/components/surface.tsx` depends on `@/lib/focus` (`:8`, `:12`) and `@/keymap/types`
(`:7`), neither of which `packages/ui` may take.

Keep the `menus/` sub-folder rather than dissolving nine files into `keymap/{components,hooks,utils}`.
Move `features/menus/utils/tests/resolve.test.ts` with it.

**Pass B — delete the `features/git/utils/types.ts` aliases.** `:9-13` alias five contracts types:
`TreeStatus`, `FileStatus`, `RepositoryInfo`, `StatusResult`, `FileDiff`. Verified: 38 files import
from that module, of which 24 name at least one of the five aliases; four web sites already import
the `Git*` names directly from `@workspace/contracts` (for example
`features/workspace/utils/row-menu.ts:14`). Delete the five aliases and repoint every call site to
the contracts names in one pass. The module itself stays — `PanelSection` (`:15`),
`BlobDiffRequest` (`:17`) and `ChangeRow` (`:24`) are real feature types.

**Pass C — fold `features/environments`.** Verified: all 15 files under
`apps/web/src/features/environments/` are tests. The implementation sits in the app's flat kind
directories — 16 of 33 in `components/`, 6 of 8 in `hooks/`, all 3 of `utils/`, 5 of 17 in `state/`
including the 650-line `state/environment-connections.ts`, and 2 of 6 in `providers/`. After the
move `apps/web/src/utils/` is empty: it contains exactly `machine-client.ts`, `machine-form.ts` and
`tailnet-hosts.ts`, all three of them environments code.

Move into `features/environments/{components,hooks,utils,state,providers}/`, dropping the redundant
`machine-`/`environment-` prefixes, and decide per module against the two-consumer bar rather than
moving the whole set on reflex. **Leave `lib/environments/*`** — those modules have 7 to 16 consumer
buckets each.

Two fixes fold into this pass, because moving these files without them means touching them twice:

- `hooks/use-ssh-hosts.ts:9` and `hooks/use-tailnet-hosts.ts:9` bypass `lib/query-keys.ts` with an
  inline `['machines', …, primaryServerOrigin()]` key. Give them a `machineKeys` group while moving.
- `components/ssh-host-list.tsx:14` and `components/tailnet-host-list.tsx:16` share a four-state
  scaffold (pending → error → empty → filtered-empty), and the SSH Retry button (`ssh-host-list.tsx:30`)
  lacks the tailnet one's `disabled={query.isFetching}` and `Spinner` (`tailnet-host-list.tsx:36`,
  `:39`), so a double click refetches twice. Give SSH the tailnet behaviour; the tailnet list keeps
  its extra `unavailable` state (`:45`), which is not a fourth copy of anything.

## Decide before writing code

Each gates the item named.

- **Does a query-key group with one feature consumer belong to that feature?** (`documentSymbolKeys`,
  `logsKeys`). The `lib/` rule counts modules, and `lib/query-keys.ts` qualifies easily. Moving two
  groups out is a judgement about exports. Answer it once, for both, and record the answer in
  `lib/query-keys.ts`.
- **Does the shared storage writer swallow `QuotaExceededError`?** (7.6, item 1). Adopting
  `writeWorkspaceCacheEntry` converts four throwing writes into silent no-ops. Either accept that
  and check the four callers, or give the shared writer a throwing variant.
- **Does the delete-on-bad-entry reader replace six silent fallbacks?** (7.6, item 2). Taking it
  means a corrupt preference is removed and reported rather than ignored. Decide before adoption,
  not after.
- **Does the merged ranker fix the model picker's tier bleed?** (7.4b). Keeping both constant sets
  preserves today's order exactly; applying the composer's clamps to the picker changes its result
  order. No test would catch either.
- **Does the empty payload stay per codec?** (7.4e). Three bare-payload codecs disagree three ways,
  and `buffer-document.ts` currently produces a document labelled `'Search'` from an empty payload.
  Decide each one, or the factory's default silently picks for you.
- **Does `generateSpreadOrderKeys` survive 8.9?** After `planPinnedReorder` is deleted it has no
  production caller — only the error text at
  `apps/server/src/orchestration/command-invariants.ts:16` mentions it. Keep it as a deliberate
  public primitive, or delete it in the same pass.
- **Which `keymap/` shape do the menus take?** A `keymap/menus/` sub-folder, or dissolved into
  `keymap/{components,hooks,utils}`. This decides 42 files' import paths; settle it before Pass A
  starts, never during.

## Verify plausible failures

App tests run under `bun --bun vitest` from `apps/web`; contracts run plain `vitest` from
`packages/contracts`; server tests run `bun --bun vitest` from `apps/server`. Use the narrowest file
that could catch the regression. Never a repo-wide suite, never a bare test count.

| Failure to catch                                            | Narrowest check                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A move changes behaviour instead of location                | `git diff -M --stat` shows renames, and the moved file's diff is import lines only                                                                                                                                                                                                                                 |
| `lib/` regains a feature import                             | `grep -rn "from '@/features/" apps/web/src/lib \| grep -v /tests/` returns nothing; then the lint rule                                                                                                                                                                                                             |
| Coalesced queue loses its count field                       | `apps/web/src/lib/tests/coalesced-log.test.ts` (moved) — `--project node`                                                                                                                                                                                                                                          |
| Shared storage accessor still throws in a hardened browser  | `apps/web/src/lib/environments/tests/scoped-storage.test.tsx` with a stub whose `getItem`/`setItem` throw `SecurityError` and `QuotaExceededError` — `--project dom`                                                                                                                                               |
| Adopting the shared writer silently drops a chat preference | `apps/web/src/features/chat/state/tests/chat-changed-files-expansion-store.test.ts`, `apps/web/src/features/chat/state/tests/session-diff-scope-store.test.ts`, `apps/web/src/features/chat-mode/utils/tests/rail-collapse-storage.test.ts`, `apps/web/src/lib/tests/workspace-cache-storage.test.ts`              |
| Prompt stash reports a failed write as success              | A case in the prompt-stash store test asserting the composer is not cleared when the write returns `storage-failed`                                                                                                                                                                                                |
| Ranker merge reorders one menu                              | `apps/web/src/features/chat/utils/tests/composer-command-search.test.ts` and `apps/web/src/features/chat/utils/tests/model-picker-search.test.ts`, each with a fixed query whose expected order is asserted before the merge                                                                                       |
| Route options lose their literal `to` type                  | `bun --bun tsc --noEmit` in `apps/web` plus `apps/web/src/features/address/tests/{navigation,editor-navigation,chat-navigation}.test.tsx` and `router.test.ts`                                                                                                                                                     |
| Search keyboard port collapses the two ArrowLeft behaviours | `apps/web/src/features/search/tests/search-result-view-model.test.ts` and `search-result-virtual-list.test.ts`, plus a new case per fork listed in 7.4d                                                                                                                                                            |
| Document scheme factory changes an empty-payload answer     | `apps/web/src/features/editor/tests/{compare-saved-document,conflict-diff-document}.test.ts`, `apps/web/src/features/search/tests/search-buffer-document.test.ts`, `apps/web/src/features/git/tests/{ref-document,diff-document}.test.ts`, `apps/web/src/features/editor/utils/tests/file-backed-document.test.ts` |
| A phantom diff filename or persisted revision changes shape | Assert `textKey` base36 width and `contentRevision`'s `h:<len36>:<hash36>` form against fixed inputs before and after the `fnv1a32` export                                                                                                                                                                         |
| Copy Path section loses the tree menu's disabled state      | `apps/web/src/features/workspace/utils/tests/row-menu.test.ts`, `apps/web/src/features/git/utils/tests/file-menu.test.ts`, `apps/web/src/features/workbench/utils/tests/editor-tab-menu.test.ts`, `apps/web/src/features/chat-mode/utils/tests/project-menu.test.ts`                                               |
| Logs event list still shows "no logs" while pending         | A new `--project dom` case rendering the list with a pending query and asserting a loader, not the empty copy — `features/logs` has no component test today                                                                                                                                                        |
| Menus move breaks command resolution                        | `apps/web/src/features/menus/utils/tests/resolve.test.ts` at its new path, plus the four menu tests above                                                                                                                                                                                                          |
| Git alias deletion changes a type, not just a name          | `bun --bun tsc --noEmit` in `apps/web` with no `@ts-expect-error` added                                                                                                                                                                                                                                            |
| SSH Retry still double-fetches                              | `apps/web/src/features/environments/tests/ssh-host-picker.test.tsx` — click Retry twice while fetching, assert one request                                                                                                                                                                                         |
| Order-key deletion removes something still used             | `vitest src/tests/order-key.test.ts` in `packages/contracts`, plus `bun --bun vitest src/orchestration/tests/project-ordering.test.ts src/orchestration/tests/session-lifecycle.test.ts` in `apps/server`                                                                                                          |
| SSE route deletion breaks the live subscribe path           | `bun --bun vitest src/orchestration/tests/engine.test.ts` in `apps/server` after removing the two HTTP cases, and the WS RPC cases still pass                                                                                                                                                                      |
| Git file rows lose their hover reveal                       | A new `apps/web/src/features/git/components/tests/file-actions.test.tsx` asserting the `group-hover/row:` class survives the `ActionCluster` extraction — that directory has no such test today                                                                                                                    |
| A knip false positive appears after a move                  | `bun run knip` on the touched workspace only; add an entry to `knip.json` rather than re-exporting                                                                                                                                                                                                                 |

## What this plan does not do

- It does not merge `basename`, `parentPath`, `fileUriForPath` or any path or URI helper.
  [Plan 092](092-path-and-uri-helpers.md) owns those, including the `lib/path-formatters.ts:8`
  warning comment this plan only edits a path inside.
- It does not touch `errorMessage`, `errorSummary`, `elapsedMs`, the redaction sanitizers or the
  error catalogs. [Plan 091](091-error-and-timing-helpers.md) owns them, including the
  `INVALID_PATH` code this plan flags.
- It does not do the `use(Context)`-or-throw sweep, the Zustand store ceremony, the settings module
  stores or the git mutation-hook factory. [Plan 093](093-web-react-and-store-ceremony.md) owns them.
- It does not move the log-dashboard client, the staged/worktree partition or anything else into
  `packages/client-core` beyond the single `fnv1a32` export.
  [Plan 094](094-client-core-web-tui-parity.md) owns that lane.
- It does not touch `jsonEqual`, the WebSocket adapters, atomic writes or the git lane.
  [Plan 095](095-server-plumbing.md) owns server plumbing; the only server file this plan edits is
  `apps/server/src/orchestration/routes.ts`, and only to delete two routes.
- It does not fix the doubled logs error banner or the git mutation double-report.
  [Plan 090 regression record](../docs/duplicate-defect-regressions.md) owns the bug-bearing duplicates, including
  `notify-mutation-error.ts` and `features/git/utils/api.ts`.

## Completion checklist

- [ ] `apps/web/src/lib/**` has zero non-test `@/features/*` imports, and a check enforces it.
- [ ] Every move in this plan landed with its consumer count recorded in the commit message.
- [ ] `globalChromeStorage` catches on all four accessors, and that landed before any repointing.
- [ ] The four 7.6 reconciles are answered in writing; unadopted modules say why they stayed.
- [ ] No migration or healing code was written for state the previous storage readers persisted; the
      keys a developer may clear are named in this plan.
- [ ] Each divergence listed in 7.4 has an explicit winner, or the extraction did not happen.
- [ ] Pass A, Pass B and Pass C are three commits, each containing nothing else.
- [ ] `packages/contracts/src/order-key.ts` keeps only the primitives with production callers, and
      `docs/logseq-parity-gap-matrix.md:92,357` cite real code.
- [ ] `apps/server/src/orchestration/routes.ts` has no SSE registration, and WS RPC coverage is intact.
- [ ] `bun run knip` is clean on every touched workspace.
