# Web layering and shared helpers

How the web app's folders are layered and where shared helpers live. The document domain and the
shared-layer lint guard are the base this layering reuses. The repository-wide Knip audit is
clean, and `bun run unused:check` runs in CI and in `bun run verify`.

## Module ownership

`keymap/menus` owns command-aware menu resolution and its presentation. The census counted 58 production
imports in 39 files, including the menus subtree. Outside that subtree there were
43 imports in 32 files across seven feature buckets.

Git callers now import `GitFileStatus`, `GitTreeStatus`, `GitRepositoryInfo`,
`GitStatusResult`, and `GitFileDiff` from contracts. The change was only the alias removal and caller updates. Sixteen production files used those aliases
across Git, workspace, workbench, chat, and chat-mode. Git's feature-specific types remain.

Environment UI and discovery live in their feature. Shared phase
and stale-connection components live in `lib/environments/components`. The network client
lives directly in `lib/environments`, because subscriptions do not belong in `utils`.
The old app-level `utils` directory is empty and removed.

Application connection state, recovery, persistence, providers, and shared connection
hooks retain their app-level homes. They coordinate chat and settings and cannot move
below features. The machine form and its hook also remain shared app code, because both
settings and environment dialogs use them and the hook submits settings actions. This
is the plan's per-module consumer rule applied to the current source, rather than moving
every environment-named module into a feature.

The following table records production imports before the environment modules moved. Tests do not count toward
shared ownership. Paths are relative to `apps/web/src`.

| Previous path                                | Current path                                             | Imports | Consumer buckets before move                            |
| -------------------------------------------- | -------------------------------------------------------- | ------: | ------------------------------------------------------- |
| `components/environment-connection-gate.tsx` | `features/environments/components/connection-gate.tsx`   |       1 | `components`                                            |
| `components/environment-stale-notice.tsx`    | `lib/environments/components/stale-notice.tsx`           |       2 | `features/git`, `features/workspace`                    |
| `components/machine-phase.tsx`               | `lib/environments/components/phase.tsx`                  |       5 | `components`, `features/chat-mode`, `features/settings` |
| `components/machine-chip.tsx`                | `features/chat-mode/components/machine-chip.tsx`         |       1 | `features/chat-mode`                                    |
| `components/project-machine-picker.tsx`      | `features/environments/components/project-picker.tsx`    |       1 | `components`                                            |
| `components/machine-picker-dialog.tsx`       | `features/environments/components/picker-dialog.tsx`     |       1 | `keymap`                                                |
| `components/machine-form-dialog.tsx`         | `features/environments/components/form-dialog.tsx`       |       1 | `components`                                            |
| `components/machine-auth-dialog.tsx`         | `features/environments/components/auth-dialog.tsx`       |       1 | `providers`                                             |
| `components/machine-auth-form.tsx`           | `features/environments/components/auth-form.tsx`         |       1 | `components`                                            |
| `components/ssh-host-picker.tsx`             | `features/environments/components/ssh-host-picker.tsx`   |       1 | `components`                                            |
| `components/ssh-host-option.tsx`             | `features/environments/components/ssh-host-option.tsx`   |       2 | `components`                                            |
| `components/ssh-host-list.tsx`               | `features/environments/components/ssh-host-list.tsx`     |       1 | `components`                                            |
| `components/tailnet-host-list.tsx`           | `features/environments/components/tailnet-host-list.tsx` |       1 | `components`                                            |
| `hooks/use-machine-auth.ts`                  | `features/environments/hooks/use-auth.ts`                |       2 | `components`                                            |
| `hooks/use-ssh-hosts.ts`                     | `features/environments/hooks/use-ssh-hosts.ts`           |       1 | `components`                                            |
| `hooks/use-tailnet-hosts.ts`                 | `features/environments/hooks/use-tailnet-hosts.ts`       |       1 | `components`                                            |
| `utils/tailnet-hosts.ts`                     | `features/environments/utils/tailnet-hosts.ts`           |       1 | `components`                                            |
| `utils/machine-client.ts`                    | `lib/environments/machine-client.ts`                     |       5 | `hooks`, `state`, `utils`                               |
| `utils/machine-form.ts`                      | `hooks/utils/machine-form.ts`                            |       1 | `hooks`                                                 |

The smaller moves follow the same rule:

- Chat's `scoped-record` and `scoped-record-storage` each have two imports within chat.
- `documentSymbolKeys` belongs to command-palette; `logsKeys` belongs to logs. Shared
  query-key groups remain in `lib/query-keys.ts`. SSH and tailnet discovery use the
  environments feature's `machineKeys`, including the primary origin in both keys.
- Native picker hydration has one consumer in `components`. It is folded into that hook,
  with pure path transforms in `components/utils/picked-path.ts`. The basename warning
  points to that file and retains its behavioral distinctions.
- `searchMatchEntry` serves command-palette and file-picker. Its version formatter is
  private because both callers now use the single projection. Picker scope and palette
  path labels remain at their call sites.
- `activeEditorTabId` belongs to the shared document domain. Workspace restore opts into
  selecting the first tab when the current ID is null; workbench normalization does not.
- Copy Path sections have three feature consumers and live under `keymap/menus`.
  Null absolute paths disable only Copy Path. Relative paths remain enabled.

`node scripts/web-layering.mjs '@/lib/search-match-entry'` regenerates an import census.
It reports production import statements, files, consumer buckets, and test consumers.
The census parses source with Oxc, excludes test directories and fixtures from production
counts, and includes the app-level test directory in test consumers. Its `--root` option
accepts another web checkout. The existing `platform-boundaries/lib-imports` rule enforces
the shared-layer boundary for static, relative, type-only, re-export, and dynamic imports,
including static template literals.

## Storage behavior

All four browser accessors catch blocked-storage failures. Reads and enumeration return
empty results; removal returns. Writes return `written`, `unavailable`, or `storage-failed`.
The shared cache writer preserves that result and handles serialization and size limits.

The six planned caches and chat projection caching use shared reading and writing.
Invalid JSON, schemas, and versions are removed. Recovery reports the cache key and a
bounded failure reason through client logging, without a filesystem-error toast or stored
contents. A failed read preserves the entry because failed access does not prove corruption.
Validation and projection quota fallback remain at their consumers.
No migration or repair code was added. The first-paint settings mirror keeps its documented
synchronous storage access.

Two caller dependencies were absent from the proposal. Draft saving needs a failure
result to keep its persistence error visible, and chat projection caching needs one to
retry without transcripts after a quota failure. Both now act on explicit results.
Prompt stashing returns success only after a completed write, so a failed write cannot
clear the composer. Environment record persistence attempts every environment and reports
whether all writes succeeded.

Persisted shapes and eviction rules remain distinct:

| Cache                  | Format and eviction                                                       |
| ---------------------- | ------------------------------------------------------------------------- |
| Changed-file expansion | Version 1, `expansionByKey`; numeric `updatedAt`, prune to 200 on read    |
| Session diff scope     | Version 2, `scopeBySessionKey`; numeric `updatedAt`, prune to 200 on read |
| Session reads          | Version 1; descending ISO timestamps, prune to 300 on write               |
| Rail collapse          | Version 1; preserve input order, first 200 entries on write               |
| Drafts                 | Version 2; image bytes remain omitted from persistence                    |
| Prompt stash           | Unversioned entries envelope; newest-first limit of 20                    |

The disposable storage keys are `env:*|platform.chat-input-drafts.v1`,
`env:*|platform.chat-changed-files-expansion.v1`, `env:*|platform.chat-session-diff-scope.v1`,
`env:*|platform.chat-session-reads.v1`, `env:*|platform.chat-rail-collapse.v1`, and
`env:*|platform.prompt-stash.v1`.

## Preserved behavior and intentional fixes

The field-token ranker has two chat consumers. Composer retains its field and tier caps;
the model picker retains its overlapping tiers. A baseline comparison checked 112
query/limit combinations across 169 candidates for each calibration.

Local and remote address builders share literal route prefixes while retaining typed
parameters. The document descriptors and empty-payload distinctions remain the
source of truth. No standalone codec factory was introduced.

Both search result navigators share keyboard dispatch and ignore modified keys. Sidebar
Enter toggles groups; editor Enter opens files. Only the sidebar collapses an empty expanded
group with ArrowLeft. Each adapter keeps its ArrowRight fallback and child lookup.

FNV character stepping is shared in client-core. Each wrapper retains its signed or
unsigned result, padding, radix, separators, and caches. Fixed-input assertions cover
phantom filenames, persisted revisions, Unicode, empty strings, and search DOM IDs.

`EmptyState` has a status role and inline or stacked icons. Logs show a loader before the
first query completes. Git action clusters preserve separate group and row hover selectors
and keyboard-focus reveal. Picker loading rows share the list's grid helper. Tab-strip
scrolling uses the existing reduced-motion helper; missing `matchMedia` allows smooth
scrolling, while initial reveals remain immediate. SSH Retry disables and shows a spinner
while fetching, matching tailnet behavior.

Unused `planPinnedReorder`, `sortByOrderKey`, and `generateSpreadOrderKeys` are gone, along with orphan helpers and tests. The live order-key primitives remain.
The two unused orchestration HTTP SSE registrations are gone too.
WebSocket RPC still consumes the engine generators; other SSE routes retain their shared
server utility. The Logseq gap matrix now cites the live rail reorder implementation.

## Verification

Focused checks cover:

- Ordering primitives plus server ordering, engine, and WebSocket RPC behavior.
- Blocked storage, corrupt disposal, quota retry, prompt failure, per-environment attempts,
  and each cache's schema and pruning behavior.
- Both rankers, local and remote route families, both keyboard adapters, and hash encodings.
- Menu payloads, command resolution, both search projections, tab restore/normalization,
  notices, loading, scrolling, and picker layouts.
- SSH and tailnet discovery, including a real in-process request held during a second retry click.
- The actual Oxlint CLI boundary calibration through `bun run test:scripts`.
- The repaired in-process integration check, which had referenced a deleted search client.

Browser checks cover the notice icon dimensions, hover/focus reveal, grid columns, and the
command and machine-picker paths.

## Unused-code checks

Static template literals used to bypass the shared-layer lint rule. Real Oxlint CLI probes now
reject both quoted and backtick imports and keep an allowed shared-module control. The import
census extracts imports from the syntax tree, so comments and strings do not count, test
factories are not production, and app-level tests are included. Corrupt-cache recovery reports
the cache key and failure reason without exposing data, and chat projection caching uses the
shared storage helpers while keeping environment validation and full-to-shell quota retry.

The Knip configuration removed unused export modifiers from declarations still needed locally,
dead declarations, orphan editor activation context wiring, and unused TUI root-list
persistence. TUI still stores the last location and each root's location. The server's pure
orchestration schema barrel is gone; callers import canonical contracts directly. Duplicate
revived-event schema aliases were removed without changing wire tags or schema objects. Seven
inert filesystem type aliases became compiler assertions that fail on drift.

Knip entry declarations describe real standalone scripts, workers, compiler assertions, and
child-process scenarios. Exact exceptions cover editor fixture content, runtime-selected
language-server binaries, and subprocess arguments resolved under a different working
directory. The root-only Turbo exception covers its launches in `scripts/dev.ts` and
`scripts/prod.ts`. The navigation proof script declares its `@tanstack/history` dependency, and
web does not declare the unused `@shikijs/themes` dependency owned by client-core. No
unused-export or unused-type exceptions exist.
