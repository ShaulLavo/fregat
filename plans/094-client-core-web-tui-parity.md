# Move runtime-neutral web and TUI logic into packages/client-core

Implementation note, 2026-09-12: Plan 096 removed the five web Git contract aliases and moved menus to `keymap/menus`. Log query keys now live in `features/logs/utils/query-keys.ts`; pending logs use the shared loader before empty. Preserve the existing single error banner during this plan's client move. See [web layering](../docs/web-layering.md).

Status: **IN PROGRESS on lane L6 (PR #36).** Done 2026-09-25: the contracts git pass and status-row
partition (`b1d221f4`); 8.1, 8.4, 8.6, 8.8 (`07d3f878`); parallels b and h (`ce016064`); the
language map (`5a97b4f4`). 8.3 and 8.7 were already done. Remaining, in order: the log-dashboard
client; the attachment policy plus parallels e, f, g; 4.8, 4.9, 8.12, project registration and the
recents ledger; parallels a, c, d; the TUI observable store. The focus transitions (U8) are dropped.
Decisions applied so far took the written recommendations (Decided 2026-09-25: recommendation
(completion wave)). Requested 2026-09-11.

This plan owns duplication-census items 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.9, 4.11, 5.4, and the
wire-vocabulary half of Theme 8 (8.1–8.8, 8.12). Siblings own the rest:
[Plan 090 regression record](../docs/duplicate-defect-regressions.md) the duplicate-borne bugs including the TUI storage crash
(4.6) and the session-busy predicate (4.10), [Plan 091](091-error-and-timing-helpers.md) the error
and timing helpers, [Plan 092](092-path-and-uri-helpers.md) the path and URI helpers,
[Plan 093](093-web-react-and-store-ceremony.md) the web React and store ceremony,
[Plan 095](095-server-plumbing.md) the server-internal plumbing, and
[Plan 096](../docs/web-layering.md) the `apps/web` layering passes.
[Root PLAN.md](../PLAN.md) owns execution order; this plan owns only the order inside itself.

## Reconcile the baseline

The planning baseline is Platform `75caae889d967fed0e0c8df85aa315670ef9fe49` with a clean tree.
Capture HEAD and the full dirty diff before editing, and re-check every anchor below.

| Existing owner                                                                    | Work to build on                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/client-core/package.json`                                               | Explicit exports map, no barrel; every new module needs its own subpath entry                |
| `packages/client-core/src/storage.ts`                                             | The four-method `KeyValueStorage` port; it has no `updateItem`                               |
| `packages/contracts/src/git.ts:8`                                                 | `GitTreeStatus`/`GitFileStatus`; the file has no valibot import                              |
| `packages/contracts/src/index.ts`                                                 | The single `.` export; every shared symbol needs a re-export line                            |
| `apps/web/src/features/git/utils/change-rows.ts:7,29,33`                          | The partition, its path ordering, and the comment explaining why the predicates are exported |
| `apps/tui/src/git/utils/rows.ts:10`                                               | The TUI partition and row builder                                                            |
| `apps/server/src/git/status.ts:79,146`                                            | The only producer of `'ignored'`, reachable only under `--ignored`                           |
| `apps/web/src/features/editor/utils/file-path.ts:121` and `lsp-language-id.ts:33` | Grammar-id and LSP-id resolution, JSONC rules, and the load-bearing `null`                   |
| `apps/tui/src/viewer/utils/language.ts:1,37`                                      | The TUI's 30-entry map feeding `viewer/state/syntax.ts:19` and `viewer/state/lsp.ts:104`     |
| `apps/web/src/features/logs/{utils,state,hooks}`                                  | Web log client, TanStack hooks, live batcher, Tailwind formatters                            |
| `apps/tui/src/logs/{state/workbench.ts,utils}`                                    | TUI log client and its store shell                                                           |
| `apps/web/src/lib/file-system-types.ts:8-16,20,48`                                | The fs wire vocabulary web re-exports, and the two shapes it re-declares by hand             |
| `packages/client-core/src/chat/worktree-event.ts:87,113`                          | Client worktree projection and its recomputed creation capability                            |
| `apps/server/src/orchestration/utils/worktree-policy.ts:13`                       | The server's authority for the same capability                                               |
| `apps/tui/src/storage/recents.ts` and `apps/tui/src/storage/files.ts:8`           | The recents ledger and the `FileStorage.updateItem` write path Plan 090 touches first        |

## Hold the runtime boundary

`packages/client-core` must run unchanged in the browser and in the Bun TUI. At this baseline it
imports no React, references no DOM global, and imports no `node:` builtin; that is the invariant a
move may not break. Nothing DOM-, React-, or Node-only crosses into it: no `File`/`FileReader`, no
`localStorage` access, no `Buffer`, no `useSyncExternalStore` contract, no Tailwind class strings,
no `getClient()` default — a client is always a parameter.

Every step below names the half that stays behind in the app and why. A step that moves a function
without naming what stays is not done.

## Decide before writing code

- **Can `'ignored'` reach a status list at all (4.1).** `apps/server/src/git/status.ts:79` is the only
  producer, and it fires only on a `! ` porcelain record. No caller passes `--ignored`:
  `service.ts:750-757`, `:824-830`, `:848-853`, `:1256-1261`. Decide whether the flag is ever added.
- **Which retention cap, ordering, and primary-field fallback the one log client keeps (4.3).**
- **Which recents cap survives, and whether `KeyValueStorage` gains `updateItem` or the write becomes
  get-then-set (4.5).**
- **Whether the TUI adopts web's activity suppression list (4.11a)** — nine kinds and the Codex
  `TRACE`/`DEBUG` filter, plus web's `'Checkpoint captured'` drop.
- **Whether `orchestrationWorktreeShellSchema` starts carrying `retiredAt` (8.8).** It is omitted
  today at `packages/contracts/src/orchestration-snapshots.ts:34`, so this is a wire change.
- **Whether `ServerInfo.ok` is added to the server response or deleted from the shared type (8.1).**
  `apps/server/src/fs/service.ts:170-181` never returns it.
- **Whether `shouldRetainAfterRevert` keeps the server's empty-string retention (8.6).**
- **Whether the shared attachment budget is measured in data-URL characters on both sides (4.4).**
- **Whether `terminalContextSchema` enforces the runtime's clamping, or callers keep normalizing
  after parse (8.12).**

## Land one contracts/git.ts pass

Three items touch `packages/contracts/src/git.ts`; land them together or the second rebases onto the
first. Keep the file type-and-tuple only — it still has no valibot import.

- Move `isStagedStatus` and `isWorktreeStatus` from `apps/web/src/features/git/utils/change-rows.ts:29,33`
  into `packages/contracts/src/git.ts` and re-export from `index.ts`. They are pure over the
  contracts-owned `GitFileStatus`. Delete the byte-identical private copies at
  `apps/web/src/features/workspace/utils/tab-model.ts:263,267` — used only at `:248-251` — which are
  exactly the drift the comment at `change-rows.ts:23-28` warns about. Repoint
  `apps/web/src/features/workspace/utils/row-menu.ts:16`, which today reaches across features.
- Adopt the server's newline-anchored binary-diff test (8.2). `apps/server/src/git/service.ts:1357`
  requires the marker to start a line (`'\nBinary files '`, `'\nGIT binary patch'`);
  `apps/web/src/features/git/utils/diff-presentation.ts:43` matches anywhere. A patch whose _first_
  line is `Binary files a/x and b/x differ` is binary to web and text to the server; a text diff
  containing `'Binary files '` mid-line is binary to web, so the pane refuses a renderable diff.
  Export `isBinaryGitDiff(diff: Pick<GitFileDiff, 'patch'>)` with the server's form and delete both.
- Add `GIT_FILE_STATUSES` as an `as const` tuple plus `isGitFileStatus`, and derive `GitTreeStatus`
  from it (8.5). Three sites accept the same strings by hand today:
  `packages/client-core/src/address/references.ts:27` (picklist),
  `apps/web/src/features/address/utils/document-token.ts:364` (a `Set` with a cast at `:390`), and
  `apps/web/src/features/git/utils/diff-document.ts:264` (an eight-branch `===` chain with a cast).
  The hazard is that adding a ninth member to `GitFileStatus` changes none of them and produces no
  type error. Preserve each site's failure shape: the address decoder yields `undefined`, the diff
  parser rejects the whole document id. The 40–64-hex object-id regex is also written twice
  (`references.ts:26`, `document-token.ts:42`); fold it in the same pass.

`packages/contracts/src/git.ts` is also touched by census item 8.13's blob-diff query shape, which
this plan does not own. Plan 096 is complete; use the current contracts recorded in
[web layering](../docs/web-layering.md) as this plan's baseline.

## Move the status-row partition into client-core

Only after the predicates are in contracts. Add `packages/client-core/src/git/status-rows.ts` beside
`git/diff-files.ts`, plus its exports-map entry. It takes `readonly GitFileStatus[]` and returns
staged rows and worktree rows. It does not live in `features/git`: `features/workspace` already
reaches across features to import the current version.

Reconcile before merging:

- **`'ignored'`.** `apps/tui/src/git/utils/rows.ts:11-16` excludes it from both sections;
  `apps/web/src/features/git/utils/change-rows.ts:11-18` includes it, so an ignored file with a
  worktree change is a row in the browser and absent in the terminal. Decide from the ground truth
  above. Recommended: the shared partition excludes `'ignored'` from both sections, so that adding
  `--ignored` to a future route cannot silently push ignored files into the change list.
- **Ordering.** Web sorts by path (`change-rows.ts:37-45`) and interleaves staged and worktree rows
  per file; the TUI emits all staged, then all working, in arrival order. Recommended: the shared
  partition sorts by path, because git's arrival order is not stable output. The TUI's row list
  becomes path-sorted — a visible change to accept deliberately, not a side effect.
- **Shape.** The shared function returns the two lists; each app keeps its own renderer, so the TUI
  keeps concatenating staged-then-working at `rows.ts:17-20` and web keeps its `ChangeRow` sections.

## Merge the path→language maps without losing the null

`apps/web/src/features/editor/utils/file-path.ts:121` (a ~100-entry extension table at `:10-114`
plus the basename table at `:116`), `apps/web/src/features/editor/utils/lsp-language-id.ts:33`, and
`apps/tui/src/viewer/utils/language.ts:1,37` are one map written twice. Home:
`packages/client-core/src/files/language.ts` with an exports entry — client-core already depends on
`@singapore-editor/core` for `EditorSyntaxLanguageId`, and so does `apps/tui`. Not contracts: it is not a
wire shape. Not `apps/web/src/lib`: the TUI cannot reach it.

Reconcile before merging:

- **The `null` fallback is load-bearing and wins.** Web returns `null`; the TUI returns `'text'`
  (`language.ts:34`). `apps/web/src/features/editor/utils/diff-documents.ts:51-52` refuses to open a
  diff document whose language it cannot name, because a `didOpen` carrying `languageId: null` fails
  the proxy's validator, is forwarded raw and untracked, and the matching `didClose` is swallowed —
  the backend keeps the document forever. Do not merge to `'text'`. The TUI then chooses explicitly
  at each call site: `viewer/state/syntax.ts:19` may apply its own `?? 'text'`, and
  `viewer/state/lsp.ts:104`, which feeds the id straight into `didOpen`, adopts web's refusal.
- **Extension extraction: web's wins.** The TUI does `split('.').at(-1)` (`language.ts:2`), so
  `Makefile` yields `'makefile'` as an _extension_, misses the map, and returns `'text'`. Web reads
  from the last `.` (`file-path.ts:139-144`), falls back to `''`, then consults the basename table
  holding `makefile` and `dockerfile` (`file-path.ts:116-119`).
- **`.sh`: web's `'shellscript'` wins** (`file-path.ts:92`) over the TUI's `'bash'`
  (`language.ts:19`). Verified safe for the TUI: `viewer/state/syntax.ts:20` resolves the name against
  Shiki's `bundledLanguages`, whose 332 keys include both `shellscript` and `bash`.
- **Two contracts, both kept.** `lspLanguageForPath` (`language.ts:37`) returns a grammar name for
  everything; `lspLanguageIdForPath` (`lsp-language-id.ts:33`) returns `undefined` except `.jsx`,
  `.tsx`, `.jsonc` and the JSONC heuristics, with the caller falling back. They agree for `.ts` and
  differ in contract. Keep them as two named exports, not one merged function.
- **The JSONC rules are the real payload.** Only web has them (`lsp-language-id.ts:29-47`: the
  tsconfig family, `.vscode`, `.devcontainer`, `.platform`), and they exist so tsserver does not
  choke on comments. The TUI sends `'json'` for `tsconfig.json` at `viewer/state/lsp.ts:104`. Closing
  that gap is the point of this item.
- **What stays behind.** `languageIdForFilePath`'s short-circuit on `SETTINGS_JSON_DOCUMENT_PREFIX`
  (`file-path.ts:2,125`) is a web-only synthetic document id; it stays in a thin web wrapper.

The move also deletes two forbidden cross-feature imports of `features/editor/utils/file-path`:
`apps/web/src/features/git/components/diff-view.tsx:1` and
`apps/web/src/features/search/utils/result-view-model.ts:4`.

## Retire the wire vocabulary declared on both sides

`apps/server` does not depend on `@workspace/client-core` — client-core depends on the server for
Eden types. Anything shared between the server and a client goes to `packages/contracts`, which has
exactly one export, so every symbol needs an `index.ts` re-export.

- **8.1 fs info.** `apps/web/src/lib/file-system-types.ts:20` re-declares `WorkspaceIndexStatus` and
  `:48` re-declares `ServerInfo`, while the same file already re-exports the rest of the fs
  vocabulary from contracts at `:8-16`. Move both to `packages/contracts/src/fs-info.ts`, the way
  `contracts/src/health.ts` handles the other half of `/health`. The index statuses are
  field-identical to `apps/server/src/fs/workspace-index.ts:45` (order differs; the server names the
  readiness union at `:19`). `ServerInfo` has already drifted: `apps/server/src/fs/service.ts:170-181`
  returns `systemRoot`, `metadataDbPath`, `maxTextFileBytes` and a spread of `this.changes.info()`
  that the web type never mentions, and the web type declares `ok: boolean`, which `info()` never
  returns. Nothing enforces either side today — the web type is a structural assertion over an
  untyped Eden response, so a server rename reads as `undefined` at runtime with a clean typecheck.
- **8.3 plan step status.** `apps/server/src/orchestration/read-model.ts:218` and
  `apps/web/src/features/chat/utils/activity-presentation.ts:133` are the same function with the same
  literals, the same order, and the same `'pending'` fallback. Export it from
  `packages/contracts/src/orchestration-events.ts` with **one** union type instead of
  `PlanStepStatus` plus `ChatActivityPlanStepStatus`. The two names resolve to the same three-member
  union today, which is exactly why a divergence in either would compile.
- **8.4 picked-entry narrowing.** `apps/server/src/fs/service.ts:660` `isPickableEntry` and
  `apps/web/src/lib/file-system-types.ts:66` `isPickedFsEntry` are identical but for operand order,
  and both are built from the family `packages/contracts/src/tree-entry.ts:31-48` already owns.
  Put it in `tree-entry.ts`; `file-system-types.ts` already re-exports that family, so the web
  version becomes a branded-narrowing wrapper and its `entry is PickedFsEntry` predicate survives.
  Trap: `apps/web/src/features/file-picker/model.ts:92` exports a _different_ `isPickableEntry`
  taking a mode and an accept list. Do not fold it in.
- **8.6 projection predicates.** `assistantTurnState`
  (`apps/server/src/orchestration/projection-pipeline.ts:1516`) and
  `assistantMessageLatestTurnState` (`packages/client-core/src/chat/writers.ts:1564`) are the same
  function, as are the two `isProviderTurnFailureActivity` (`:1526` and `:1225`). Move them to a new
  `packages/contracts/src/orchestration-projection.ts` with an index re-export. `shouldRetainAfterRevert`
  differs on the empty string: the server's `if (!turnId) return true` (`:1539-1543`) retains it; the
  client's `turnId === null || retained.has(turnId as TurnId)` (`:1574-1579`) drops it. `TurnId` is
  branded so the schema cannot produce `''`, but the server's parameter is plain `string | null`.
  Do **not** unify the two reducers themselves — one writes Drizzle rows, one returns frozen slices,
  both files are ~1,600 lines, and most of that divergence is legitimate.
- **8.7 the log-join key.** `apps/server/src/orchestration/orchestration-logging.ts:49-72` contains
  `packages/client-core/src/transport/utils/logging.ts:6-28` verbatim, 23 identical lines. These are
  the two halves of one log-join key: if they drift, a request that starts in the browser and finishes
  on the server stops joining on the same field names. Move to
  `packages/contracts/src/orchestration-commands.ts` as `orchestrationCommandLogFields(command)`,
  widened to the `OrchestrationCommand | ClientOrchestrationCommand` union the server already accepts;
  each side casts its own result type. The server's `attachmentIngest` tail (`:74-82`) stays in the
  server wrapper.
- **8.8 worktree creation capability.** The server computes it at
  `apps/server/src/orchestration/utils/worktree-policy.ts:13-21` and ships it; the client recomputes
  it at `packages/client-core/src/chat/worktree-event.ts:113-120` while projecting. The server also
  gates on `worktree.retiredAt`; the client gates only on `lifecycle.state`, and `registeredWorktree`
  (`:87-111`) hardcodes `lifecycle: { state: 'ready' }` for every `worktree.registered` and
  `worktree.revived` payload. So a retired worktree arriving through those two events reads
  `allowed: true` on the client and `base-not-ready` on the server: the composer offers "new worktree"
  and the command is refused. Home is `packages/contracts/src/worktree-lifecycle.ts`, which already
  owns the vocabulary. This needs the payload decision above, because
  `orchestration-snapshots.ts:34` omits `retiredAt` from the shell schema. `worktreeCleanupEligibility`
  (`worktree-policy.ts:23`) needs session rows and stays server-side; the client placeholder at
  `worktree-event.ts:106-110` is correct — do not copy this item's mistake onto it.

## Share the settings and chat-context vocabulary

Decided 2026-09-25: recommendation (completion wave). Use "this scope" across diagnostics,
share the secret-stripping provider builder, and clamp terminal line bounds in the shared schema.
Project registration uses prefixed command ids and the structured missing-identity failure;
TUI preserves its Root title fallback.

- **4.8 diagnostic labels.** One `SettingsDiagnosticKind` (`packages/contracts/src/settings/resolve.ts:60`)
  is mapped to English three times: `apps/tui/src/settings/utils/diagnostics.ts:9`,
  `apps/web/src/features/settings/utils/diagnostics.ts:13`, and
  `apps/web/src/features/settings/components/diagnostics-banner.tsx:3`. `scope-not-allowed` is
  `'not allowed in this scope'` in the first two and `'not allowed in that scope'` in the third — and
  both variants ship inside `apps/web`, so the inline diagnostic and the banner above it word the
  same problem differently on one screen. Add `settingsDiagnosticLabel(kind)` to
  `packages/client-core/src/settings/humanize.ts`, which already exports `settingRowTitle`,
  `settingOptionTitle` and `humanizeSettingId` and which both apps already import
  (`apps/tui/src/settings/utils/rows.ts:1`). Not contracts: contracts should not carry user-facing English.
- **4.9 `provider.setEnabled`.** `apps/web/src/features/settings/utils/operations.ts:3` and
  `apps/tui/src/settings/utils/edit.ts:179-190` build identical payloads, including
  `environment: instance.environment.map(({ name }) => ({ name, value: '' }))` — the rule that keeps
  secrets out of the settings document, which AGENTS.md makes a security boundary. Move the builder
  to `packages/client-core/src/settings/operations.ts`, beside `settings/owner.ts` and
  `settings/intent-store.ts`. Nothing in the payload needs reconciling. What stays local: the TUI's
  read-only guard (`edit.ts:160-171`) and its whole-array diff; web builds one operation per toggle.
- **8.12 terminal-context schema.** `apps/tui/src/agent-stage/utils/prompt.ts:11` declares
  `terminalContextSchema`, and `prompt.ts:2` already imports from
  `packages/client-core/src/chat/terminal-context.ts`, which declares the same shape as a type at
  `:8`. Export the valibot schema beside the type; client-core already depends on valibot. The TUI
  schema is looser than the runtime: `normalizeTerminalContextSelection` (`terminal-context.ts:53-68`)
  floors line numbers, clamps `lineStart` to ≥ 1, and returns `null` for blank text or source, while
  the schema accepts negative and fractional line numbers straight off disk. Settle the decision
  above before writing it.

## Collapse project registration onto one builder

`packages/client-core/src/chat/registration.ts:9` already builds the command and `:24` already
raises the structured failure; `chat/commands.ts:520` already derives the title. Both are on the
exports map, so no new file is needed. Today `apps/web/src/features/terminal/state/register-checkout.ts:24`
imports the builder but re-derives the title inline, and
`apps/tui/src/connection/state/worktree.ts:21-26` and `apps/tui/src/agent-rail/state/rail.ts:175-181`
bypass all three.

Reconcile before merging:

- **Fallback title.** `'Workspace'` (client-core and web) versus `'Root'` (TUI, computed as
  `workspaceRoot.split('/').filter(Boolean).at(-1) ?? 'Root'`). That is a `basename` variant; keep it
  at the TUI call site rather than folding a second fallback into the builder.
- **Command id.** client-core mints `command-<uuid>` (`registration.ts:16`); the TUI mints a bare
  `<uuid>`. Both pass `commandIdSchema`, so a log filter on the `command-` prefix silently misses
  every TUI registration. The prefixed form wins.
- **Failure path.** Web raises the structured `CHAT_PROJECT_IDENTITY_MISSING`
  (`registration.ts:26-32`); the TUI surfaces a raw valibot `ValiError`. The structured error wins.

## Move the recent-commands ledger

Sequence after [Plan 090 regression record](../docs/duplicate-defect-regressions.md): its corrupt-storage fix lands in
`apps/tui/src/storage/recents.ts`, the file this item then relocates.

Home: `packages/client-core/src/commands/recent-commands.ts` over the existing `KeyValueStorage`
port (`packages/client-core/src/storage.ts`) — correct precisely because the only consumer,
`groupedCommandItems` (`packages/client-core/src/commands/palette.ts:28`), already lives there.

Reconcile before merging:

- **Cap.** 30 (`apps/web/src/features/command-palette/state/recent-commands-store.ts:10`) versus 50
  (inline at `apps/tui/src/storage/recents.ts:20`).
- **Corrupt storage.** Plan 090 guards reads and returns `[]` after invalid data. Its cleanup uses
  `FileStorage.removeItemIfValue` so a stale reader cannot delete another instance's valid write.
  Preserve conditional deletion and the two-connection regressions when defining the shared port.
  `parseRecentCommands` remains a strict write validator.
- **Envelope.** `{ commandIds, version: 1 }` (web, `:77`) versus a bare array (TUI, `:20`).
- **Recency policy at the call site.** `apps/tui/src/commands/utils/palette.ts:26` passes
  `search ? [] : recents`; `apps/web/src/features/command-palette/content.tsx:136` passes recents
  unconditionally. Same ranker, different order for the same input — decide one, then delete the other.
- **Atomic writes.** The TUI writes through `FileStorage.updateItem`, which holds an immediate
  SQLite transaction. It validates new history before writing; startup no longer validates saved
  history eagerly. The shared port must preserve atomic updates and conditional deletion.
  A get-then-set implementation loses updates between TUI instances.
- **What stays behind.** The cached array identity at `recent-commands-store.ts:14-16` exists because
  `useSyncExternalStore` re-renders forever on a fresh array; it is a React requirement and must not
  move into client-core.

## Unify the log-dashboard client

Decided 2026-09-25: recommendation (completion wave). Retain 500 events, dedupe by id,
sort by descending timestamp, and use the web primary-field fallback. Keep rendering,
settings defaults, subscriptions and TanStack hooks in their hosts.

Land after the language map: both add new client-core subpath exports and both touch
`apps/tui/src/logs/*`, and the language move removes cross-feature imports the web-side log edits
would otherwise reintroduce.

Sites: `apps/web/src/features/logs/utils/api.ts:18,31,47` ↔ `apps/tui/src/logs/state/workbench.ts:39,76`;
`apps/web/src/features/logs/utils/filter-params.ts:33,40,51` ↔ `apps/tui/src/logs/utils/filters.ts:2-3`;
`apps/web/src/features/logs/state/live-cache.ts:42` ↔ `apps/tui/src/logs/utils/events.ts:3`;
`apps/web/src/features/logs/utils/formatters.ts:28` ↔ `apps/tui/src/logs/utils/events.ts:30`.
Home: `packages/client-core/src/logs/{api,filters,live-cache}.ts` with explicit exports entries.

Reconcile before merging:

- **Retention cap.** 500 (`live-cache.ts:50`) versus 300 (`events.ts:7`).
- **Ordering.** Web prepends and trusts stream order (`live-cache.ts:61`); the TUI re-sorts the whole
  list by `timestamp` descending on every insert (`events.ts:5-7`), so a late frame lands in its slot
  rather than on top.
- **`total`.** Web adds the unique count (`live-cache.ts:70`); the TUI adds 1 (`events.ts:14`).
- **Dedupe key — web is correct.** The TUI tests `result.detailsById[item.event.id]` (`events.ts:4`),
  so an event whose detail was dropped by the retention rebuild is re-admitted and double-counts.
  Web tests the events array (`live-cache.ts:52-59`).
- **Empty-result contract.** `mergeLiveLogEvents` returns `undefined` with no current result
  (`live-cache.ts:47`); `mergeLogEvent` has no undefined case.
- **Query building.** Web trims blank search and drops empty arrays through `logFilterQuery`
  (`filter-params.ts:51-61`, `:79-82`); the TUI ships raw filters (`filters.ts:8-15`), so an
  all-whitespace search becomes a filter. `logFilters` cannot express area, level, or source at all.
- **Range table.** Same arithmetic; web takes `now` as a parameter (`filter-params.ts:40`), the TUI
  reads `Date.now()` internally (`filters.ts:14`). The parameter wins — it is the testable one.
- **Primary-field fallback.** Web is `action ?? operation ?? path ?? message ?? 'log event'`
  (`formatters.ts:29`); the TUI is `action ?? message ?? path ?? operation ?? ''` (`events.ts:31`).
  An event carrying both `operation` and `message` shows different text in each client.
- **Response unwrapping.** Web uses `unwrapEdenResponse` (`apps/web/src/lib/eden-events.ts:19`), which
  makes empty data an opt-in `requireData` with a caller-supplied message and optional date
  normalization; the TUI uses `requireEdenData` (`packages/client-core/src/transport/eden.ts:7`),
  which always rejects empty data as `CLIENT_TRANSPORT_FAILED` 502. The shared client takes
  client-core's; web keeps its message wrapper at the feature edge. The two `createRpcError`
  implementations behind them belong to [Plan 091](091-error-and-timing-helpers.md).
- **Enums, same pass.** Web declares its own `LogTimeRange` (`filter-params.ts:4`) that today matches
  the `logs.defaultTimeRange` picklist (`packages/contracts/src/settings/keys.ts:404`). Export
  `LOG_DASHBOARD_LEVELS` and a `LOG_TIME_RANGES` tuple from `packages/contracts/src/log-dashboard.ts`
  (which today declares only `logDashboardLevelSchema` at `:4`), build the settings picklist from it,
  alias `LogTimeRange`, and build the sets at `apps/web/src/features/address/utils/logs-params.ts:21-22`
  from it too — those hold bare strings and cast afterwards, so widening the picklist silently rejects
  the new range there while `filter-params.ts:29` would fail to typecheck. Keep the `''` special case
  at `logs-params.ts:32`: `Number('')` is 0.
- **What stays behind.** Web's TanStack hooks (`features/logs/hooks/use-events.ts`, `use-live.ts`,
  `use-summary.ts`), its live batcher (`state/live-batcher.ts`), its filter store, and `logLevelClass`
  and `logLevelDotClass` (`formatters.ts:38,46`, Tailwind). The TUI keeps its store shell
  (`logs/state/workbench.ts`), `logHistogram` (`events.ts:25`), `logRow` (`:30`), and `addLogSummary`
  (`:34`).

## Unify the chat attachment policy

Decided 2026-09-25: recommendation (completion wave). Both clients measure the complete
data URL; web keeps compression and TUI keeps byte sniffing. MIME aliases and parameters normalize
in contracts. Both replacement engines share native capture expansion plus newline/tab/backslash
escapes and the standalone `$0` alias. Mention parsing uses the contracts grammar. Socket adapters
keep their transport setup; the common socket interface retains optional browser state fields.

Two layers. (1) `packages/contracts/src/chat-model.ts`: export `CHAT_ATTACHMENT_MIME_TYPES` and a
`normalizeChatAttachmentMimeType` folding in the `image/jpg` alias and the `;parameters` strip, beside
the documented allowlist at `:107-112`. (2) `packages/client-core/src/chat/attachments.ts`: the
wire-budget half — `MAX_CHAT_ATTACHMENT_ENCODED_BYTES` and `chatAttachmentDataUrlLength`, today at
`apps/web/src/features/chat/utils/input-attachment-limits.ts:42,47` — because it is client compression
policy the server does not enforce.

Reconcile before merging:

- **Byte budget.** Web compresses so the **data URL** fits `MAX_CHAT_ATTACHMENT_BYTES`
  (`packages/contracts/src/chat-model.ts:42`); the TUI checks raw bytes
  (`apps/tui/src/agent-stage/state/attachments.ts:18,37`), so a 10 MiB PNG ships as roughly 13.98 MB
  and still passes `MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH` (`chat-model.ts:49`). The two apps ship
  different amounts for the same file.
- **Oversize.** Web downscales up to 50 MB (`input-attachment-limits.ts:30,102-107`); the TUI refuses
  above 10 MiB.
- **Type detection.** `file.type` plus normalization (`input-attachment-limits.ts:118-122`) versus
  magic-byte sniffing (`attachments.ts:71-79`): a correctly-typed but truncated file is refused in the
  TUI and accepted in web.
- **Latent bug the normalizer fixes.** `chatAttachmentExtension` (`chat-model.ts:116-121`) only trims
  and lowercases, so `image/jpg` is rejected at the blob store.
- **Derive the copy.** The TUI hardcodes `'10 MiB'` in three strings (`attachments.ts:20,39`,
  `apps/tui/src/host/clipboard-image.ts:31`).
- **What stays behind.** `File`, `FileReader` and `compressImageToByteLimit` stay in web; magic-byte
  sniffing stays in the TUI.

## Close the remaining web↔TUI parallels

Each of these is small, and each has a divergence that must be settled first.

- **a. Activity visibility.** `apps/web/src/features/chat/utils/activity-visibility.ts:6,28,30` and
  `apps/tui/src/agent-stage/utils/timeline.ts:35-36`. Home:
  `packages/client-core/src/chat/activity-visibility.ts`, beside `chat/pending-approvals.ts`. This is
  a **missing policy, not code volume**: only `context-window.updated` is filtered in both. The TUI
  renders `tool.progress`, `tool.summary`, `task.started`, `task.updated`, `turn.diff.updated`,
  `account.rate-limits.updated`, `mcp.status.updated` and raw Codex `TRACE`/`DEBUG` that web
  suppresses. `chatActivityHasFailure`
  (`apps/web/src/features/chat/utils/activity-presentation.ts:346`) must move or be injected — it is
  the override that keeps a failing quiet-kind activity visible. Decide the `'Checkpoint captured'`
  drop before writing.
- **b. Commit progress reader.** `apps/web/src/features/git/utils/api.ts:236-255` and
  `apps/tui/src/git/state/workbench.ts:104-120`. Home:
  `packages/client-core/src/git/commit-stream.ts`. Only the stream reader is duplicated: the TUI's
  `status`, `stage`, `unstage`, `discard`, `fetch`, `pull` and `push` are one-line typed Eden calls.
  Web types the frame as `GitCommitProgressEvent` and keeps `{stream, text}` distinct; the TUI
  duck-types every frame, drops the stream channel, and truncates to 8000 chars. Failure is a
  structured `GIT_COMMIT_REJECTED` versus `createTuiError` with different copy per case. Web's
  `syncRemote` (`api.ts:374`) has no TUI counterpart. This file is also rewritten by
  [Plan 096](../docs/web-layering.md)'s `apps/web/src/features/git/utils/api.ts` items;
  land them in one pass.
- **c. Worktree actions and confirmations.** `apps/tui/src/worktrees/utils/choices.ts:49` and
  `apps/web/src/features/chat-mode/components/worktree-manager-row.tsx:44-80`;
  `apps/tui/src/worktrees/utils/confirmation.ts:5` and `apps/web/src/features/chat-mode/components/worktree-cleanup-dialog.tsx:28-40`. Home:
  `packages/client-core/src/chat/worktrees/{actions,confirmation}.ts`, beside `cleanup.ts`
  (`WorktreeConfirmation` is already declared in `chat/worktrees/commands.ts`). Same seven actions,
  same order, same shared predicates. The TUI gates `cleanup`, `force` and `missing` on `!current`
  (`choices.ts:54,60,70`); web does not. Retry differs: the TUI emits one opaque `'retry'` gated on
  `canRetryWorktree(worktree) && (!current || state === 'creation-failed')` (`choices.ts:56`); web is
  unconditional and picks `worktree.retry` versus `worktree.cleanup` by state
  (`worktree-manager-row.tsx:59-66`). Labels match; descriptions have already drifted (web
  interpolates the worktree label, the TUI does not). The TUI has a fourth `'safe'` confirmation kind
  (`confirmation.ts:3`) for which web shows no dialog.
- **d. Three binding helpers, not a shared resolver.** `apps/tui/src/commands/utils/bindings.ts:126,132,136`
  and `apps/web/src/keymap/active-bindings.ts:61,241,331`. Home:
  `packages/client-core/src/commands/bindings.ts`, beside `commands/{chord,catalog,focus}.ts`.
  `collides` is byte-equivalent to `collidesWith`; `activeTerminalBindings` collapses onto
  `activePlatformKeyBindings` once `bindingMatchesFocusedPane` has filtered; `defaultPane` and
  `commandDefaultPane` **differ** — the TUI prefers the pane on the authored `tui` key entry before
  applying the `target === 'editor'` rule. Unknown overrides also differ: the TUI pushes an
  `'Unknown command.'` diagnostic, web silently drops. **Reject sharing `resolveOverrides`**:
  `PlatformKeyBinding` (`apps/web/src/keymap/types.ts:50-61`) carries eleven fields including the
  command-less browser reservation (`command: PlatformCommandId | null` at `:54`, handled at
  `active-bindings.ts:137`), for which `TerminalBinding`'s four fields (`bindings.ts:17-22`) have no
  analogue.
- **e. Composer mention grammar.** `apps/tui/src/agent-stage/state/completions.ts:26,71-76` versus
  `packages/contracts/src/composer-tokens.ts:48,102`, used by
  `apps/web/src/features/chat/utils/input-logic.ts:165,241`. No new home — call the contracts
  functions. `BARE_COMPOSER_MENTION_PATH` (`composer-tokens.ts:34`) forces quoting; the TUI's
  `[^\s]*` stops at the first space and never quotes. The TUI folds `@`, `/` and `$` into one trigger
  family; the contracts grammar is `@`-only, so the `/` and `$` branches stay on the local detector.
  Not a live bug: `collectComposerMentions` has only one consumer,
  `apps/web/src/features/chat/components/chat-input-editor.tsx:71`.
- **f. Socket type.** `apps/tui/src/connection/utils/service-socket.ts:3` `ServiceSocket` versus
  `apps/web/src/lib/server-sockets.ts:5` `EdenServerSocket`. Home:
  `packages/client-core/src/transport/socket.ts`, beside `transport/rpc-host.ts`'s
  `OrchestrationSocket`. `readyState` is required in the TUI type (`:4`) and optional in web's (`:6`),
  so `apps/web/src/features/terminal/components/panel.tsx:587-592` compares against `3` and `2` and an
  adapter that omits the field falls through to `close()`. `binaryType` is on the TUI type (`:5`, set
  at `apps/tui/src/terminal/state/connection.ts:35`) and absent from web's. **Reject the URL-builder
  half**: web goes through Eden's typed `client.terminal.subscribe` and `client.lsp.subscribe`
  (`server-sockets.ts:36,48`), and sharing a string builder means bypassing route typing for one
  `ws:`/`wss:` swap.
- **g. Replacement expansion.** `apps/tui/src/search/utils/replacement.ts:3,35` and
  `apps/web/src/features/search/utils/replace.ts:39,188`. Home:
  `packages/client-core/src/files/search-replace.ts` — not contracts, because no server route performs
  replacement. Near-zero net lines; the value is feature parity. The TUI supports `` $` ``, `$'` and
  `$<name>` (`replacement.ts:35-44`); web supports none. Web supports `\n`, `\t` and `\\`
  (`replace.ts:212-221`) and `$0`; the TUI supports none, so a TUI replacement containing `\n` inserts
  a literal backslash-n — the user-visible bug. **The input shapes are the real cost**: the TUI expands
  against a real `RegExpExecArray` (`replacement.ts:35`), web against a flat
  `captures: readonly string[] | null` (`replace.ts:33-37`) taken from the server-reported match, so
  web cannot supply `` $` ``, `$'` or `$<name>` without re-running the regex.
- **h. Blob diff paths — fix the route instead.** `apps/tui/src/git/state/diff.ts:31-37` and
  `apps/web/src/features/git/utils/blob-diff-query.ts:59-69` both carry a comment explaining that
  `/git/diff/blob` re-roots the paths it parses, so `repo/a.ts` comes back as `repo/repo/a.ts`. Fix
  the route in `apps/server/src/git/`; the fallback home is
  `packages/client-core/src/git/diff-files.ts` as `withRequestedDiffPaths`. Web clears `oldPath` when
  it equals `path` (`blob-diff-query.ts:66-68`) and then classifies a rename from
  `oldPath && oldPath !== path` (`apps/web/src/features/git/utils/diff-presentation.ts:47`); the TUI
  copies `oldPath` through, so a non-rename can arrive with `oldPath === path`. That is harmless only
  because `apps/tui/src/git/` has no equivalent classifier today — confirm that before relying on it.
  The TUI also stamps `staged` onto each blob (`diff.ts:36`); web does not.

## Give the TUI one observable store

`apps/tui/src/host/utils/observable-store.ts` as `createObservableStore<T>(initial, { signal? })`.
**Not client-core**: these stores own TUI-specific concerns — an OpenTUI controller, a PTY socket, an
Eden stream. Twelve factories declare a byte-identical `listeners` set and `subscribe` body:
`git/state/workbench.ts:22`, `logs/state/workbench.ts:24`, `search/state/workbench.ts:14`,
`files/state/browser.ts:27`, `agent-models/state/auth.ts:32`, `agent-models/state/catalog.ts:18`,
`agent-rail/state/rail.ts:44`, `connection/state/session.ts:47`, `settings/state/raw-editor.ts:32`,
`viewer/state/document.ts:41`, `worktrees/state/actions.ts:36`, `tree/state/tree.ts:21`.

Reconcile before merging:

- **Three guard families, all real.** A `disposed` flag (`search:19`, `logs:35`, `files/browser:48`,
  `catalog:20`, `auth:34`), `lifetime.signal.aborted` (`git:34`, `session:58`, `rail:63`,
  `actions:41`), and an injected `signal.aborted` (`tree:28`, `raw-editor:39`, `document:44`). The
  store must accept an `AbortSignal` **and** support the plain-flag case, or three regress.
- **Three publish signatures.** Full replace (nine of them), partial merge (`rail:62`, `actions:40`),
  and a no-argument bump (`tree:27`).
- **Two snapshot identities.** `tree/state/tree.ts:124` returns an integer `version` and
  `agent-stage/state/drafts.ts:197` a `revision`, because their real state is a mutable controller
  `useSyncExternalStore` cannot compare by identity. Support a counter mode or leave those two out.
- **Unsubscribe return type.** `raw-editor.ts:76` and `actions.ts:117` return `listeners.delete`,
  whose result is `boolean`.
- **Do not count the unguarded stores as a free fix.** `navigation/state/history.ts`,
  `editor/state/editor.ts` and `terminal/state/connection.ts` have no `dispose`, no async work, and a
  `closed` flag respectively; none is a candidate.

## Share the focus transition sequence last

This is the riskiest item in the census and the least payoff per line: two large stateful services,
`apps/tui/src/commands/state/focus.ts` (353 lines) and `apps/web/src/lib/focus/state/service.ts`
(618 lines), for roughly 60 shared lines. Do it after everything above.

About 50 lines on each side sequence identically — supersede, resolve, invoke in try/catch, then
`refused`/`unregistered`/`destination-invalid`/`acknowledged` (`focus.ts:148`, `service.ts:322`;
`focus.ts:233`, `service.ts:515`). The shared vocabulary already exists at
`packages/client-core/src/commands/focus.ts:53`. Home:
`packages/client-core/src/commands/focus-transitions.ts` as a host-injected machine
`createFocusTransitions({ resolveDestination, invoke, onPublish })`.

What must stay in each host, and why the machine is injected rather than shared wholesale:

- Ownership confirmation differs. The TUI polls `entry.isFocused()` (`focus.ts:34,125,193`); web reads
  a `focusin` and resolves by DOM containment through shadow roots (`service.ts:252,383`).
- The TUI defers pending requests under an overlay (`focus.ts:296-303`) and carries a `FocusScope`
  that invalidates every target (`focus.ts:188`). Web has neither.
- Web publishes a monotonic `revision` (`service.ts:73,447`) and freezes snapshots.
- On unregister the TUI nulls `current`; web re-derives from `document.activeElement`.

## What this plan does not do

- It does not fix the duplicate-borne defects: the TUI's unguarded JSON storage reads (4.6) and the
  session-busy predicate including the web LRU eviction bug (4.10) belong to
  [Plan 090 regression record](../docs/duplicate-defect-regressions.md). This plan sequences after 090 where they overlap.
- It does not merge `errorMessage`, `errorSummary`, `elapsedMs`, the Eden error envelopes, or the two
  `createRpcError` implementations — [Plan 091](091-error-and-timing-helpers.md).
- It does not touch `fileUriForPath`, `parentPath`, containment predicates, or the `basename` census
  header — [Plan 092](092-path-and-uri-helpers.md).
- It does not do the web `use(Context)`-or-throw sweep, the Zustand store ceremony, the settings
  widget input machine, the git mutation hook factory, or the `runGit` test helpers —
  [Plan 093](093-web-react-and-store-ceremony.md). Item 5.4 is here only because it is TUI-local.
- It does not do the server-internal collapses: `jsonEqual`, the WebSocket adapters, the atomic-write
  implementations, the listener bridges, or the git common-dir lane — [Plan 095](095-server-plumbing.md).
- It does not move `features/menus`, delete the `features/git/utils/types.ts` aliases, or fix the
  logs pending-versus-empty fall-through — [Plan 096](../docs/web-layering.md), which also
  owns census item 8.13 and therefore shares the `packages/contracts/src/git.ts` and
  `apps/web/src/features/git/utils/api.ts` passes named above.
- It does not delete the unused `order-key.ts` exports (8.9) or collapse the client-core-internal
  stream helpers (8.10, 8.11); those are shared-package internals, not web↔TUI parity.

## Verify plausible failures

App tests run under `bun --bun vitest run` from the owning app; `packages/client-core` is
runtime-neutral and runs plain `vitest run`. Use the narrowest file that can catch the regression.
No repository-wide suite, and no bare test count as evidence.

| Failure to catch                                              | Narrowest proof                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| client-core stops being runtime-neutral                       | `rg "from 'react'\|\bdocument\.\|\bwindow\.\|localStorage\|from 'node:" packages/client-core/src` returns nothing, plus `bun run typecheck` in `apps/tui`                 |
| The merged partition changes which rows appear                | New `packages/client-core/src/git/tests/status-rows.test.ts` asserting an `'ignored'` entry and a file both staged and edited; `apps/tui/src/git/tests/workbench.test.ts` |
| `tab-model` loses its staged/worktree answer                  | `apps/web/src/features/workspace/tests/tab-model.test.ts`                                                                                                                 |
| A null language id reaches `didOpen`                          | New test beside `apps/tui/src/viewer/tests/lsp.test.ts` for an extensionless file and `tsconfig.json`; `apps/web/src/features/git/tests/diff-document.test.ts`            |
| `Makefile` or `.sh` resolves to a grammar Shiki cannot load   | New `packages/client-core/src/files/tests/language.test.ts` asserting the id is a key of `bundledLanguages`                                                               |
| Binary-diff classification flips for a mid-line marker        | `apps/web/src/features/git/utils/tests/diff-presentation.test.ts`                                                                                                         |
| Live log merge double-counts or drops a late frame            | `apps/web/src/features/logs/tests/live-cache.test.ts` and `apps/tui/src/logs/tests/workbench.test.ts`                                                                     |
| Blank search becomes a filter, or a picklist widening is lost | `apps/web/src/features/logs/tests/filter-params.test.ts` and `apps/web/src/features/logs/tests/api.test.ts`                                                               |
| A corrupt recents row breaks palette open                     | `apps/tui/src/storage/tests/files.test.ts` and `apps/tui/src/commands/tests/palette-ranking.test.tsx`                                                                     |
| Recents ordering changes under a search query                 | `apps/web/src/features/command-palette/tests/recent-commands-store.test.ts` and `apps/web/src/features/command-palette/tests/command-list-order.test.tsx`                 |
| A provider secret survives into the settings document         | `apps/tui/src/settings/tests/owner.test.ts` (it already drives `saveSettingDraft`) and `apps/web/src/features/settings/tests/settings-projection.test.tsx`                |
| Two diagnostic wordings ship on one screen                    | `apps/tui/src/settings/tests/diagnostics.test.tsx` and `apps/web/src/features/settings/tests/diagnostics-plugin.test.ts`                                                  |
| A TUI project registration stops matching the log filter      | `apps/tui/src/agent-rail/tests/state.test.ts`                                                                                                                             |
| A retired worktree offers "new worktree" on the client        | `apps/web/src/features/chat/tests/worktree-lifecycle.integration.test.tsx`                                                                                                |
| An oversize attachment ships from one app and not the other   | `apps/web/src/features/chat/utils/tests/input-attachment-limits.test.ts` and `apps/tui/src/host/tests/clipboard-image.test.ts`                                            |
| A TUI replacement inserts a literal `\n`                      | `apps/tui/src/search/tests/replacement.test.ts`                                                                                                                           |
| A disposed TUI store still publishes                          | `apps/tui/src/git/tests/workbench.test.ts`, `apps/tui/src/settings/tests/raw-editor.test.ts`, `apps/tui/src/tree/tests/tree.test.ts`                                      |
| A focus request settles twice or never                        | `apps/tui/src/commands/tests/focus.test.ts` and `apps/web/src/lib/focus/tests/service.test.tsx`                                                                           |

## Completion checklist

- [ ] Every decision above is answered in writing before its item is implemented.
- [ ] `packages/contracts/src/git.ts` is edited once, covering the predicates, `isBinaryGitDiff`, and
      `GIT_FILE_STATUSES`, building on the completed [Plan 096 changes](../docs/web-layering.md).
- [ ] Every new `packages/client-core` module has an exports-map entry; no barrel file was added.
- [ ] `packages/client-core` still imports no React, no DOM global, and no `node:` builtin.
- [ ] Each moved helper names, in the diff or a one-line comment, what stayed in the app and why.
- [ ] No duplicate is left behind as a re-export shim; call sites are updated in the same pass.
- [ ] Deleted behaviour that no longer exists has its test deleted rather than preserved.
