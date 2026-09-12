# Plan 098: Give documents and tabs one shared domain model

Status: proposed; implementation has not started. Planned at Platform `fb797f07` on
2026-09-12. Priority P1, effort L, change risk high. Characterization is a prerequisite to
production changes, not a final verification task.

**Execution order: complete and verify this plan before starting
[Plan 097](097-async-operation-ownership.md).** Plan 097 depends on the finished document and tab
model and its migrated consumers. It cannot start after design agreement or partial implementation.

A tab currently stores `{ id: string, path: string }`. The second string may identify a file,
search, comparison, conflict, Git revision, or the settings surface. Saving, labels, navigation,
persistence and closing decode that meaning separately. Replace those independent interpretations
with a typed model expressing document kind, backing resource, save capability and tab membership.

This plan authorizes no implementation by itself. When implementation is requested, work in the
current checkout. Do not create branches, commits or PRs without a separate instruction.

## Current ownership and evidence

All shortened source paths in this plan are relative to `apps/web/src`.

| Source                                                   | Current behavior that constrains the refactor                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/workspace/utils/tab-model.ts:36`               | `EditorTabRecord` contains independent tab ID and string path. Tab IDs survive layout persistence.                                                       |
| `features/editor/utils/file-backed-document.ts:20`       | Rejects every reserved synthetic prefix even when its payload is malformed. Save capability is wider than filesystem backing.                            |
| `features/workspace/utils/document-label.ts:24`          | Repeats kind decoding to choose labels. Tab model repeats it again for icons, titles, copy paths and diff actions.                                       |
| `features/workspace/utils/tab-dirty.ts:17`               | A settings tab owns both `settings-json:user` and `settings-json:workspace`. Its own `settings:` identifier is not a live document.                      |
| `features/settings/state/active-buffer.ts:19`            | Active Save uses the selected JSON scope; form mode has no active text save target. The last JSON view binding may still exist.                          |
| `features/editor/state/workspace-document-service.ts:73` | The service owns live buffers and revisions. Documents currently repeat their identity in `id` and `path`; views already link a tab ID to a document ID. |
| `features/editor/state/save-service.ts:17`               | Loaded file and settings synchronization states choose different save services. Other documents have no ordinary save destination.                       |
| `features/editor/hooks/use-dirty-tab-close.tsx:179,370`  | Final-tab closing groups owners, then saves the dirty documents belonging to the tab. Backing resources are not the same as those members.               |
| `features/workspace/state/cache.ts:535`                  | One admission policy governs tabs, history, recently closed entries and scroll; ordinary file paths alone are stored relative to a workspace.            |
| `features/address/utils/document-token.ts:46`            | Converts synthetic identifiers into the existing URL grammar. Unrecognized/failed synthetic parsing currently falls through to a file token.             |
| `lib/file-server.ts:16`                                  | Imports a stateful queue from a workspace feature, reversing the shared-layer dependency.                                                                |

The rationale is recorded in existing comments and history. `d2885013` protects malformed
synthetic IDs from filesystem classification. `969ae117` establishes one settings surface with
independent scope buffers. `efdb4d83` fixes dirty/close handling by enumerating both settings
documents. `3156ccc0` removes an ID-based approximation of editor-command availability. Preserve
those constraints; document kind alone must not authorize a command.

Source inspection, test inspection and a small local log sample informed this plan. No new
characterization tests, builds or runtime experiments ran during planning.

## First deliverable: characterize observable behavior

Before introducing the model, expand focused tests against the current implementation. Use
real document stores and in-process server fixtures. Keep assertions about observable behavior
when production code moves; update imports and construction helpers, not expected outcomes
unless the correction is explicitly listed below.

| Case                     | Characterization required                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File                     | Absolute/relative resource paths, empty workspace root, labels, copy path, save and auto-save, duplicate tabs sharing one buffer with independent views/scroll.                                                                                                                                    |
| Settings membership      | Dirty user JSON, switch scope, dirty workspace JSON, switch to form, then close. Save and discard cover both documents; cancel preserves both. No filesystem route receives either settings ID.                                                                                                    |
| Settings active Save     | Mod+S saves only the selected JSON scope. Form mode does not save the last JSON view binding. Save All includes loaded dirty scopes; auto-save excludes them.                                                                                                                                      |
| Settings failures        | One scope fails while the other succeeds. Record the save result, tab visibility and both buffers for an already-conflicted scope and a stale revision received during save. The acknowledgement correction below must keep unresolved buffers open.                                               |
| Duplicate settings tabs  | Closing one instance does not prompt/discard shared members still used by another. Closing the final instance covers both members exactly once.                                                                                                                                                    |
| Conflict                 | Editable unsynced resolution buffer, no ordinary Save, transient cache/URL policy, missing conflict record, fallback label and separate resolution workflow.                                                                                                                                       |
| Git reference            | The current buffer is editable and unsavable, despite documentation describing it as readonly. Dirty reference buffers survive retention and require discard/cancel on final close. Record actual behavior.                                                                                        |
| Snapshot/checkpoint diff | Labels, statuses, old/new object IDs, old paths, file/session/turn scopes, single-file navigation and multi-file views with no single file target. No ordinary save or source-file discard.                                                                                                        |
| Compare with saved       | Live backing buffer and saved snapshot remain distinct. Closing the comparison does not discard its working file. Preserve current backing-view behavior across reload and rename.                                                                                                                 |
| Search                   | `search-buffer:` is valid for root `''`; wrong-root search is excluded. Search state stays owned by search, not a filesystem buffer.                                                                                                                                                               |
| Recovery                 | A file blocked by transaction recovery remains a file but cannot be edited/saved through normal commands. Recovery completion preserves the buffer and restores its synchronization behavior.                                                                                                      |
| Close/retention          | Final owner only prompts; multiple close targets deduplicate member documents; inactive/parked roots and overlapping roots retain shared documents; unsynced/settings/recovery documents retain their current treatment.                                                                           |
| Persistence              | Tab IDs and active selection survive serialization. Tabs/history/closed/scroll share admission. Files become relative; synthetic view payloads currently retain their paths. Reopen scroll uses the current projection when duplicate tabs show the same content; include settings scroll/history. |
| Rename                   | File document rekeys while buffer and tab IDs survive. Current and parked slices/history/closed/scroll update together. Encoded ref/diff/compare targets currently do not follow the rename.                                                                                                       |
| Address/history          | Every valid URL token round-trips. Boot restoration is additive; Back/Forward selects its destination without replaying a whole old tab collection. Dirty/transient tabs survive explicit address application.                                                                                     |
| Invalid inputs           | Every reserved prefix with invalid escapes, JSON/version or empty payload, at root `''` and nested roots. Verify file classification, cache admission and URL encoding together. Unknown URL kinds reject.                                                                                         |
| Environment ownership    | Equal target keys in two retained environments never share buffers, settings writes, tab state or persisted slices.                                                                                                                                                                                |

Reuse existing coverage before adding cases:

- `features/workspace/tests/{tab-model,tab-dirty,tab-prefetch,tab-close-targets}.test.ts`
- `features/editor/utils/tests/file-backed-document.test.ts`
- `features/editor/hooks/tests/use-dirty-tab-close.test.tsx`
- `features/editor/tests/{document-state,document-retain,state}.test.ts`
- `features/editor/tests/auto-save.test.tsx`
- `features/settings/tests/json-buffer.test.ts` and `raw-conflict.test.tsx`
- `features/workspace/state/tests/cache.test.ts` and `features/workspace/tests/use-cache-persistence.test.ts`
- `features/address/tests/document-token.test.ts` and `tab-history.test.tsx`
- `keymap/tests/when.test.ts` and `command-dispatch.test.tsx`

The current dirty-settings close test only asserts that Save is enabled for one scope. Add
end-to-end multi-scope outcomes in `test/integration/settings-tab-lifecycle.test.tsx`, using
`test/fixtures.ts`, `test/render.tsx` and existing settings factories. Put shared document-kind
cases in `test/factories/document-targets.ts`; expected labels/routes/ownership must be explicit
fixtures, not values calculated by the helpers under test.

Record current defects separately from the behavior to preserve:

1. A malformed synthetic ID or internal settings JSON ID must never become a file URL. The
   current fallback can do that with workspace root `''`. The new boundary will reject it.
2. Session/turn checkpoint views are URL-addressable, but nested-root cache filtering treats
   their generated display names as filesystem paths and drops them. The recommended correction
   is to persist them under their owning workspace/session comparison resource, independently
   of their display name. Keep this as a separately verified persistence correction.
3. `SettingsSyncService.save` returns without writing on conflict; `EditorSaveService.save`
   currently reports success anyway, and save-close trusts that boolean. Reproduce this, then
   fix acknowledgement propagation in a small prerequisite change. An unresolved scope must
   not authorize closing its dirty buffer. Prove a subsequent resolution/save still works.

The refactor does not make Git reference buffers readonly, make comparison tabs follow file
renames, or change auto-save scope. Those would be separate product behavior changes.

## Target model

Choose a closed discriminated model with tab composition separate from loaded buffer state.
The caller constructs a typed target once; consumers receive that target rather than decoding
a string at render/save/close time.

Illustrative usage:

```ts
const file = fileDocument(fileResource)
workspace.openTab({ kind: 'document', document: file })
workspace.openTab({ kind: 'settings' })

const members = tabDocuments(tab.content)
const active = activeTabDocument(tab.content, settingsSelection)
const destination = active ? saveCapability(active) : { kind: 'none' }
const label = tabLabel(tab.content, presentationFacts)
```

The important signatures and shapes are:

```ts
type DocumentRef =
  | { readonly kind: 'file'; readonly resource: FileResource }
  | { readonly kind: 'settings-json'; readonly target: SettingsWriteTarget }
  | { readonly kind: 'git-ref'; readonly source: GitFileReference }
  | { readonly kind: 'git-diff'; readonly source: GitComparison }
  | { readonly kind: 'compare-saved'; readonly file: FileResource }
  | { readonly kind: 'conflict'; readonly conflictId: ConflictId }
  | { readonly kind: 'search'; readonly root: WorkspaceRoot }

type TabContent =
  | { readonly kind: 'document'; readonly document: StandaloneDocumentRef }
  | { readonly kind: 'settings' }

type EditorTabRecord = {
  readonly id: TabId
  readonly content: TabContent
}

type SaveCapability =
  | { readonly kind: 'none' }
  | { readonly kind: 'file'; readonly resource: FileResource }
  | { readonly kind: 'settings'; readonly target: SettingsWriteTarget }

function documentKey(document: DocumentRef): DocumentKey
function tabDocuments(content: TabContent): readonly DocumentRef[]
function backingResource(document: DocumentRef): BackingResource
function saveCapability(document: DocumentRef): SaveCapability
```

`StandaloneDocumentRef` excludes internal settings JSON members. Settings membership derives
as exactly user and workspace JSON documents; it is not an arbitrary mutable array in a tab.
`activeTabDocument` receives the settings feature's explicit form/JSON and scope selection.
The shared model never reads settings stores, React contexts or the active environment.

`BackingResource` distinguishes a filesystem file, settings layer, Git file revision, Git
comparison, conflict-record reference and search workspace. `GitComparison` is a closed union
of snapshot, checkpoint-file, checkpoint-session and checkpoint-turn variants. File checkpoints
carry session ID, turn range, file resource and applicable object IDs, old path and status;
they must retain their checkpoint query adapter rather than becoming Git blob snapshots.
Reuse `SessionId`, `SettingsWriteTarget` and Git status/object data from contracts; do not import
Git UI types or transport client objects into the model. A session comparison has no fabricated
filesystem path. A missing conflict record has no invented file destination.

Checkpoint targets include `owner: WorkspaceRoot`, the explicit workspace resource of the tab
slice in the retained environment. Producers and URL adapters supply it from their captured
workspace context. Cache admission compares it with the slice's workspace root, without
deriving ownership from a display name or looking up feature stores. Resolved session checkout
details remain query/runtime facts. Test nested-root admission, exclusion from another root and
URL-to-cache restoration retaining this owner. Environment isolation remains with the retained
runtime and scoped storage.

These relations must stay separate:

- Kind describes what the document represents.
- Backing resource describes where its content comes from or what it refers to.
- Save capability describes an eligible destination, not whether a write is allowed now.
- Tab members are the documents used for dirty/close/discard accounting. Backing files and
  comparison dependencies are not automatically members.
- Active document is a UI selection. It can be absent while hidden member documents are dirty.

A compare view can read its working file without acquiring ownership that allows close to
discard that file. Preserve backing-document retention independently of tab-close membership.
Virtual viewers/search descriptors do not require creating fake live buffers.

### Identity and live state

Use distinct branded `TabId`, `DocumentKey` and `FilesystemPath` types. Filesystem helper and
save entry points take a resource/path or document key explicitly, so passing a tab ID or
synthetic document key cannot typecheck. Strings remain wire values at existing external APIs.

Migrate the following boundaries in `lib/file-server.ts` and their direct callers together:

| Path-bearing input             | Helpers                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| File or entry `path`           | `fetchFile`, `writeFileContent`, `createFileContent`, `statPath`, `deletePath`, `recordRecentEntry` |
| Folder/root `path`             | `fetchTree`, `ensureFolderPath`, `createFolderPath`, `openWorkspaceRootPath`, `fetchQuickOpenFiles` |
| Source/destination             | `renamePath(from, to)`, `copyPath(from, to)`                                                        |
| Workspace root                 | `fetchWorkspaceEditRecovery(workspace)`                                                             |
| Prepared persistence resources | `prepareWorkspaceEditMutation`: `workspace`, operation `path`, rename `oldPath`/`newPath`           |

Use filesystem path/root types appropriate to each namespace. The web prepare adapter accepts
typed resources and unwraps them into the unchanged contract request; transaction semantics
and server schemas remain outside this refactor. Convert raw paths from server results,
picker input, address decoding and storage restoration at those boundaries, before constructing
domain targets. Recent-entry and quick-open results follow the same rule. Preserve existing
absolute/relative path semantics and the valid empty-root case; do not scatter brand casts
through callers. Negative compile probes must pass `DocumentKey` and `TabId` to the production
helpers, including request fields, rather than only checking assignments between brands.

Document identity stays deterministic for equal targets within the retained environment.
Tab instances retain independent IDs and view/scroll state. File rename rekeys the document
while preserving its buffer and tab instances, matching current behavior. Do not introduce
random document UUIDs stable across rename. Include the kind in key construction so a file
resource cannot collide with a synthetic document. Key spelling is private, never a filesystem
argument or a string that consumers inspect for kind.

The existing WorkspaceDocumentService remains the only live buffer/revision/view owner.
Construct live records from a `DocumentRef`; derive their key internally. Replace the ambiguous
duplicate `path` with an explicit target/resource relationship. Pair each loaded target with
the corresponding dynamic sync state: file versions for files, settings revisions for settings,
unsynced state for unsavable buffers. Constructors must not accept independently contradictory
targets and save destinations. Recovery is a blocking state on the same target, not a new
static document kind.

Keep dynamic dirty/revision/conflict/lease/availability checks in the current services and
keymap owner. The model supplies static capability; it does not authorize Save or editor
commands. Preserve referential stability of published document/view slices across unrelated
scroll and content updates. Do not parse, serialize or rebuild descriptors in selectors.

### Storage and URL boundaries

Store typed tab content in tabs, history and recently closed entries. Live view scroll remains
keyed by `TabId`, preserving independent positions for duplicate tabs. Persisted reopen scroll
entries carry durable `TabContent` plus position, with canonical content identity used for
deduplication. This preserves settings-surface state without inventing a settings document.
Keep the characterized projection when duplicate tabs show the same content; do not change
history into tab-ID history or add a separate catalogue for reopen seeds.

Define a validated stored-target union. Files retain workspace-relative storage semantics;
derived views retain their characterized resource/rename semantics. Restore paths in their
declared namespace before workspace admission. Preserve environment-scoped storage and the
existing worktree-or-folder slice identity. Internal settings members and conflict records are
not standalone durable tabs. Persist settings tab composition, not loaded buffers or dirty text.

Bump `WORKSPACE_CACHE_VERSION` from 20 to the next available version in
`lib/workspace-cache-storage.ts` when the schema changes. Drop old development caches; do not
write dual readers, compatibility aliases or healing migrations. State the cache reset in the
implementation report. Do not convert or persist unsaved text as part of this work.

Keep the valid external URL grammar in `packages/client-core/src/address/references.ts`.
`features/address` adapts it directly to/from typed tab content. That transport grammar omits
internal documents and is not the shared editor model. Preserve full valid token round-trips
and navigation semantics, including every comparison variant's object IDs, status and old path
where represented. Reject unavailable/transient or invalid targets explicitly.

Any remaining encoded document-key format belongs to a codec boundary under the shared domain.
Recognized-invalid synthetic input is distinct from a file. Preserve these parsing distinctions:
empty search root valid; empty conflict/compare invalid; ref requires nonempty path and ref;
Git diff's existing payload admits empty path. Characterize all before changing validation.
An explicitly constructed filesystem resource must never be decoded as a synthetic document.

### Module ownership and synthesis

Place the pure domain in `apps/web/src/lib/documents/utils/`, with exact-file imports:

- `types.ts`: document/tab/resource unions and branded identity types.
- `identity.ts`: constructors, canonical equality/keys and file rekeying.
- `tabs.ts`: composition, membership and active-document selection from explicit inputs.
- `capabilities.ts`: save/backing/durability facts derived exhaustively from kinds.
- `labels.ts`: pure labels/titles using explicit presentation facts.
- `codec.ts`: reserved-format boundary and validated stored descriptors; split by format only
  if real size warrants it, keeping one public decode result.

Tests live under `lib/documents/tests/`; app integration fixtures live under `test/`. No module
in this domain imports a feature, React, application state, query client, store or service.
Feature renderers and adapters consume it. Git supplies status presentation; workspace supplies
conflict paths; settings supplies UI selection. Pass small facts, not whole feature stores.

Do not create a barrel, registration framework, generic document-handler plugin API, or parallel
metadata registry. The competing design stored a catalogue of descriptors and tab-member arrays.
It added reference cleanup and serialization rules for a relation that current tab kinds can
derive. This plan takes its identity separation and explicit storage adapters while keeping
the existing live-document service. The cost is a broad but compiler-guided caller migration.

## Implementation order and gates

Each unit must finish in a verifiable state. Add and migrate a replacement API in one unit;
delete that unit's old API and all its callers together. Do not leave permanent string adapters.

1. **Characterization only.** Add the missing cases above and record baseline outcomes. Reproduce
   the three named inconsistencies. Keep their corrections visibly separate from structural
   changes; do not retain tests that require unsafe behavior after the correction. Gate on the
   focused existing suites and the new settings lifecycle suite before changing production code.

2. **Correct settings save acknowledgement.** Before introducing production domain types, add
   the regression proving that an already-conflicted or newly stale settings scope cannot
   authorize save-close. Propagate the outcome through SettingsSyncService and EditorSaveService.
   Keep the unresolved tab and dirty buffer open; prove a later resolution/save closes
   successfully. Baseline characterization records current outcomes; desired-behavior regressions
   belong to this separate prerequisite correction. Gate on the settings lifecycle/conflict suites.

3. **Close the shared-layer import violation.** Move `features/workspace/utils/coalesced-log.ts`
   to `lib/coalesced-log.ts` and its existing test to `lib/tests/coalesced-log.test.ts`. Update
   `lib/file-server.ts` and `features/workspace/hooks/use-tree.ts`. Add the production lib import
   guard in the same unit and prove it rejects deliberate invalid imports. Run the moved queue
   test and lint. This is one implementation moved intact, not a queue rewrite.

4. **Introduce the pure domain and typed producers.** Add unions/constructors/keys/membership and
   characterization-backed policies. Move synthetic descriptor definitions/codecs from editor,
   Git, search and settings into this domain. Migrate open/select producers, tab records,
   workbench panel operations and their direct consumers together. Keep renderers consuming
   typed variants, with no per-render decoding. Gate on domain tests, tab/panel tests and web
   typecheck. Invalid-domain and missing-variant compile probes must fail as intended.

5. **Migrate live documents and lifecycle consumers.** Move store/service/view keys, dirty sets,
   retention, save entry points and closing to the common types. Rename misleading field and
   API names with their callers. Route normal saves from shared capability plus existing live
   sync state. Migrate both active-settings Save and all-member close; do not use one selector
   for both. Gate on document identity, settings multi-scope lifecycle, auto-save, recovery and
   keymap suites.

6. **Migrate presentation and remaining integrations.** Labels, tab icons/copy paths, diff-source
   navigation, menus, window titles, command-palette filtering, file prefetch, LSP eligibility,
   search-open and conflict adapters use typed targets/capabilities. Rendering remains in owning
   features. Migrate every filesystem helper and request field listed above with its direct
   callers. Gate on actual-helper negative compile probes and characterization of those surfaces
   plus typecheck; preserve known label and active-tab fallback differences instead of merging
   same-shaped helpers blindly.

7. **Migrate cache, history, address and rename as one complete unit.** Change validated cache
   schema/version, typed histories/scroll, URL adapters, active/parked rename projection and
   restore together. Make the malformed-URL and checkpoint durability corrections explicit in
   tests. Preserve tab IDs, selection, URL token content and dirty/transient navigation rules.
   Gate on cache, address/history and rename suites with serialized records and actual restored
   state, including root `''`, nested/overlapping roots and two environments.

8. **Finish mechanical enforcement and remove legacy classifiers.** Delete the old feature
   document codecs, `fileBackedDocumentPath`, `savableDocumentPath`, path-based tab membership
   and synthetic-parser branches from lifecycle/presentation consumers. Verify imports,
   exhaustive unions and typed I/O boundaries as specified below. Rerun affected characterization
   groups, inspect the diff and record remaining limitations. No repository-wide suite is
   required beyond existing mandatory checks unless a new failure justifies it.

The migration units can be large. If unit 4 cannot typecheck without unit 5 or 7, combine the
dependent work into one planned migration unit; do not invent temporary compatibility types
just to simulate a clean phase boundary. Keep the characterization commit separable from it.

## Mechanical enforcement

Use the actual lint path: `.oxlintrc.json`, `apps/web/package.json`'s `oxlint .`, staged Oxlint
in `lefthook.yml`, and CI's `bun run lint`. A convention in prose or a local grep is insufficient.

- Production `lib/**` cannot import `features/**`, including type imports, re-exports, relative
  paths that resolve into features, and literal dynamic imports. The current census is one
  production declaration and 18 test declarations across four files. Exempt only test files,
  not arbitrary subdirectories or production helpers used by tests.
- The pure documents domain cannot depend on React, feature/UI/runtime/store layers. Permit
  its own pure modules, type-only contract imports, required named public contract schemas and
  `valibot`. Initially permit only the shared path helpers actually needed:
  `lib/path-formatters.ts` and `packages/client-core/src/files/path.ts`. Both currently have no
  imports. Apply the same dependency restriction to these helpers; a new shared dependency
  must join the protected set or be rejected. This closes indirect runtime imports without a
  general dependency-graph framework. It constrains dependencies, not arbitrary function purity.
- Only designated codec/address/storage adapters may deserialize document identities. After
  migration, reject reserved synthetic-prefix literals/classifiers outside that boundary and
  test fixtures. Kind switches are valid; interpreting `DocumentKey` strings as kinds is not.
- Distinct branded filesystem paths, document keys and tab IDs must reach typed consumer APIs.
  Do not claim branding protects filesystem calls while their helpers still accept any string.
  External route schemas remain unchanged; explicit adapters validate/unwrap real resources.
- Exhaustive switches cover document/tab variants. Save capability is derived, not an
  independently writable set of flags. Adding a kind must force updates to affected policies.

Add the focused plugin at `scripts/lint/web-boundaries.mjs`, registered in `.oxlintrc.json`'s
existing `jsPlugins` list as `{ "name": "platform-boundaries", "specifier": "./scripts/lint/web-boundaries.mjs" }`.
Use scoped rules `platform-boundaries/lib-imports`, `platform-boundaries/document-dependencies`
and `platform-boundaries/document-codecs`. The prefix check needs a custom rule regardless of
whether native import restrictions can cover some imports. Resolve `@/` and relative paths
against the importer; do not match spelling alone. Reject dynamic/computed imports and `require`
in the protected pure set. Test exceptions for the lib import rule match test file suffixes,
not entire directories; they do not exempt production helpers imported by tests.

Calibrate the actual configured rules in `scripts/lint/web-boundaries.test.ts`, and add this
file to root `test:scripts` unconditionally. Probe alias, relative, type-only, re-export and
dynamic violations, a forbidden prefix classifier, and a feature import hidden behind a shared
re-export. Also fail when an allowed path helper adds a React/store dependency. Passing controls
cover a pure shared dependency, a domain consumer and an integration-test feature import.

The installed Oxlint CLI has no stdin input mode. Create disposable repository-shaped fixtures
under `/work/tmp`, copy the actual lint config and local plugin unchanged, and link installed
`node_modules`. Run the installed CLI through Bun with the fixture root as cwd, its config path
and JSON output. Assert the expected rule identifier and location, not only a nonzero exit.
Remove fixtures in `finally`; no invalid probe is written into production sources. Existing
CI runs the checks through `bun run lint` and calibration through `bun run test`.

Add compile-time negative cases under `src/lib/documents/tests/contracts.ts` for mixing the
three identity types in actual filesystem/save calls and request fields, invalid settings
membership and mismatched document/save construction. An unused `@ts-expect-error` must fail
typecheck when a boundary becomes permissive.

## Commands and expected results

These are implementation gates, not tests already run. Run only the relevant rows per unit.
App tests import `test`/`expect` from `test/fixtures.ts`, use real in-process server/client state,
and run under Bun. No new dev server; use the existing one for any manual visual check.

| Working directory | Command                                                                                                                                                                                                                                            | What it proves                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Platform root     | `bun run --cwd apps/web typecheck`                                                                                                                                                                                                                 | Typed producer/consumer migration closes; negative type cases remain rejected.                                      |
| `apps/web`        | `bun --bun vitest run --project node src/features/workspace/tests/tab-model.test.ts src/features/workspace/tests/tab-dirty.test.ts src/features/workspace/tests/tab-prefetch.test.ts src/features/editor/utils/tests/file-backed-document.test.ts` | Baseline classification, labels, membership and filesystem exclusion. After moves, run their new domain test paths. |
| `apps/web`        | `bun --bun vitest run --project dom test/integration/settings-tab-lifecycle.test.tsx src/features/editor/hooks/tests/use-dirty-tab-close.test.tsx src/features/editor/tests/auto-save.test.tsx`                                                    | Settings member lifecycle, close and autosave. First file is new.                                                   |
| `apps/web`        | `bun --bun vitest run --project node src/features/editor/tests/document-state.test.ts src/features/editor/tests/document-retain.test.ts src/features/editor/tests/state.test.ts src/features/settings/tests/json-buffer.test.ts`                   | Shared buffers, rename/rekey, retained views and save reconciliation.                                               |
| `apps/web`        | `bun --bun vitest run --project dom src/features/settings/tests/raw-conflict.test.tsx src/keymap/tests/command-dispatch.test.tsx`                                                                                                                  | Conflicts and dynamic command availability.                                                                         |
| `apps/web`        | `bun --bun vitest run --project node src/features/workspace/state/tests/cache.test.ts src/features/workspace/tests/use-cache-persistence.test.ts src/features/address/tests/document-token.test.ts`                                                | Stored-target validation, scroll and URL round-trips.                                                               |
| `apps/web`        | `bun --bun vitest run --project dom src/features/address/tests/tab-history.test.tsx`                                                                                                                                                               | Back/Forward and dirty/transient tab preservation.                                                                  |
| `apps/web`        | `bun --bun vitest run --project node src/lib/documents/tests src/lib/tests/coalesced-log.test.ts`                                                                                                                                                  | New domain cases and unchanged queue behavior after the move.                                                       |
| `apps/web`        | `bunx oxlint src/lib src/features/editor src/features/workspace src/features/workbench src/features/address src/features/settings src/features/git src/features/search src/keymap`                                                                 | Migrated architecture boundaries use the normal lint path.                                                          |
| Platform root     | `bun --bun vitest run scripts/lint/web-boundaries.test.ts --environment node`                                                                                                                                                                      | Deliberate violations fail the actual configured lint rules. Add this file to `test:scripts` unconditionally.       |
| Platform root     | `git diff --check`                                                                                                                                                                                                                                 | Patch whitespace is clean.                                                                                          |

Expected success is exit 0 and all applicable assertions passing, with known pre-existing
failures recorded as baseline deltas. Do not use absolute test totals as a gate. New domain
tests replace obsolete codec locations in the command list when those modules move; there
must be no empty-directory invocation accepted as proof. Characterization includes real route
effects and stored/restored values, not only helper output or a mocked Save callback.

## Scope and coordination

In scope are the new domain, tab/workbench records and selection, WorkspaceDocumentService and
its adapters, save/close/retention, document presenters, cache/history/URL adapters, the listed
typed filesystem entry points and their direct callers, corresponding fixtures/tests, lint
configuration, and the coalesced-log move. External filesystem/Git/settings protocols, Editor
buffer algorithms, native Swift/TUI presentation, feature matching algorithms and operation
transaction semantics are outside this refactor.

Plan 096's document-scheme factories are superseded by this plan's model and codec boundary.
This plan also owns its coalesced-log move/lib guard prerequisite. Preserve 096's recorded
payload distinctions and its separate cache-versus-panels active-tab fallback policy. Other
096 consolidation work remains independent.

Plan 097 owns async operation capture, revision evidence, preview tokens and conflict completion.
It starts only after this plan meets all completion criteria and its focused verification gates
pass. Preserve existing retained owner and revision guarantees throughout this refactor.

Drift check before implementation:

```sh
git diff --stat fb797f07..HEAD -- apps/web/src apps/web/test .oxlintrc.json scripts/lint plans/096-web-layering-and-boundaries.md plans/097-async-operation-ownership.md
```

Reconcile changed source anchors before following the sketch. If characterization contradicts
the matrix, update the matrix first and explicitly classify the behavior as preserved or
corrected. If new arbitrary composite tabs exist, reconsider derived membership before adding
exceptions. If the model needs feature imports or a parallel mutable descriptor registry,
revisit its ownership instead of weakening the guard.

Completion requires characterized behavior preserved except the named corrections; typed tab
content and keys throughout migrated consumers; both settings members covered by dirty/close
but active Save correctly scoped; no synthetic value accepted as a filesystem path; typed
cache and valid URLs round-tripping; no stale old schema readers or classifier aliases; and
proven lint/type boundaries passing through the repository's actual CI path.

Before closing this plan, record its completion evidence and implemented document API locations
in Plan 097. Refresh Plan 097's source anchors, API sketches, and drift baseline so it starts from
the settled implementation.
