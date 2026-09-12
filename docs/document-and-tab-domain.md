# Document and tab domain

Plan 098 is implemented in the web client. Document identity, filesystem resources, and tab
instances have separate types. The existing workspace document service still owns live buffers,
revisions, views, synchronization, and recovery.

## Identity and composition

The pure model lives in `apps/web/src/lib/documents/utils/`:

| Module             | Contract                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`         | `DocumentRef`, `TabContent`, `GitComparison`, `FileResource`, and branded `DocumentKey`, `TabId`, `FilesystemPath`, and `ConflictId`. |
| `identity.ts`      | Validated path and restored-ID constructors, canonical `documentKey`, file keys, and rename identity.                                 |
| `tabs.ts`          | Fixed settings membership, active-document selection, tab equality, and backing-document retention.                                   |
| `capabilities.ts`  | Save destinations, filesystem resources, source navigation, and workspace durability.                                                 |
| `labels.ts`        | Labels, titles, icons, copy paths, and the palette's distinct fallback presentation.                                                  |
| `comparisons.ts`   | Snapshot construction and snapshot/checkpoint request adapters.                                                                       |
| `codec.ts`         | Reserved-format decoding with distinct tab, internal-member, and invalid results.                                                     |
| `storage-codec.ts` | Validated stored descriptors and filesystem namespace restoration.                                                                    |

A `DocumentKey` is private canonical identity. Consumers keep the target beside the key and do
not decode the key. A `FilesystemPath` identifies an actual filesystem resource, including the
valid empty workspace root. Explicit file construction never interprets a filename as a
synthetic document. Wire paths are converted at filesystem, picker, LSP, address, and storage
boundaries. The `f/` URL token already declares the filesystem namespace and round-trips
real filenames that happen to start with a reserved prefix.

An editor tab is `{ id: TabId, content: TabContent }`. Multiple tabs can share a document key
and buffer while keeping independent view sessions and scroll positions.

| Content             | Ordinary save                                              | Tab members and retention                                                         |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| File                | File destination, subject to live eligibility              | Its file document.                                                                |
| Settings            | The selected JSON scope; form mode has no active text save | Exactly user JSON and workspace JSON. Final close covers both.                    |
| Git reference       | None                                                       | Its editable, unsynced buffer. Dirty references survive retention.                |
| Git comparison      | None                                                       | Its comparison target. Session and turn comparisons have no single file resource. |
| Compare with saved  | None                                                       | Its comparison target is a close member; the working file is retained separately. |
| Filesystem conflict | Separate resolution workflow                               | Its unsynced resolution buffer. The conflict record supplies file resources.      |
| Search              | None                                                       | Search owns its state; file overlays include actual file documents only.          |

Static capability does not authorize a command. Save, editing, and close still consult live
sync state, dirty state, recovery, leases, and command availability. Constructors derive live
keys and sync destinations from their target; they cannot accept a contradictory save path.

## Runtime and navigation

`WorkspaceDocumentService` owns live records with `key` and `target`. The document store exposes
`liveDocumentsByKey`, `dirtyDocumentKeys`, and views keyed by `TabId`. `EditorSaveService.save`
accepts a `DocumentKey`. Settings scope selection belongs to `features/settings/state/selection.ts`.

The workspace store holds `openTabContents`, `selectedTabContent`, `editorHistory`, and
`recentlyClosedTabs`. Reopen scroll entries contain typed content and a position. File rename
rekeys the file document while preserving its buffer and tab IDs, including parked workspace
slices. Derived comparison and reference targets retain their previous rename behavior.

Navigation exposes `openTabContent` and `selectContent` for generic content. File-only commands
such as `openFileSurface` and `selectFile` accept `FilesystemPath`. Native rendering receives a
document key and a separate `paintKey`; visual cache identity is not document identity.

`lib/language-server-document.ts` derives a separate LSP URI from the typed target. Native
editor IDs remain document keys. The linked Editor LSP plugin accepts `documentSync.uriForDocument`
for synchronization and rename projection; semantic-token requests use that same target URI.
Settings schema associations match these URIs. File preparation checks actual file tabs, so a
Git reference or comparison does not suppress preparation of its working file. Focused tests
cover URI encoding, TSX language IDs, settings completion, and preparation from derived views.

Checkpoint comparisons carry an explicit owning workspace. `checkpoint-file` also carries a
file resource. Session and turn comparison labels are presentation strings, never ownership
or filesystem evidence. The Git and checkpoint query adapters remain separate.

## Storage and addresses

Workspace cache version **21** stores typed tab descriptors, tab IDs, selection, histories,
and reopen scroll positions. Version 20 development caches are dropped. This resets cached
layouts and reopened tabs; there is no migration reader and no persisted unsaved text.

Files are stored relative to their owning workspace. Derived views retain their existing
resource namespace. The existing external URL grammar is unchanged. Address adapters convert
directly between URL tokens and typed content, preserving additive boot restoration and
Back/Forward selection semantics.

The migration includes five separately verified corrections:

1. Invalid ambiguous raw identifiers and internal settings JSON members cannot become file URLs,
   including at root `''`.
2. Session and turn checkpoint tabs persist under their explicit workspace owner. Their labels
   no longer cause nested-root cache rejection.
3. A conflicted or newly stale settings scope returns a failed save acknowledgement. Save-close
   keeps unresolved text open, while independent scopes can save. Resolution followed by save
   can close the tab.
4. Switching root `''` to another root and back preserves its tabs, histories, and scroll.
5. At root `''`, search excludes dirty settings and Git-reference buffers from filesystem
   results. The previous overlay treated their synthetic identifiers as paths.

File auto-save scope, editable Git references, comparison rename behavior, and transaction
semantics remain as characterized. The [async operation ownership reference](async-operation-ownership.md) describes the subsequent ownership changes.

## Enforcement and verification

The configured Oxlint plugin, `scripts/lint/web-boundaries.mjs`, enforces production shared-layer
imports, pure document dependencies, and reserved-prefix codec boundaries. Pure dependencies
include the two protected path helpers. Test exceptions use file suffixes. Tailwind named
container variants such as `@max-3xl/settings:grid` are recognized as CSS syntax; a separate
synthetic prefix in the same string is still rejected.

`src/lib/documents/tests/contracts.test-d.ts` checks actual filesystem/save helpers and prepared
request fields with invalid identity types. The `.test-d.ts` suffix gives the negative probe
an exact test-file exception for its intentional feature imports. An unused `@ts-expect-error`
fails the normal web typecheck.

Verification on 2026-09-12 used baseline commit `3c935f6a` before production migration. Focused
checks cover domain classification and codecs, labels and membership, settings multi-scope
lifecycle, save acknowledgement, auto-save, shared buffers and views, rename, recovery,
retention, filesystem conflicts, search overlays, cache restoration, address/history,
environment isolation, and editor preparation. The moved coalesced-log test preserves queue
behavior. Actual CLI calibration checks rule identifiers and source locations.

The final web typecheck, web build, configured web lint, and rule calibration pass. The build
retains its existing large-chunk warning. Expanded tests have these confirmed baseline failures:

| Suite                                              | Baseline and final result | Existing failure                                                  |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `keymap/tests/command-dispatch.test.tsx`           | Two failures              | New-file/new-folder fixture has no attached navigation.           |
| `command-palette/tests/palette-scope.test.tsx`     | One failure               | Duplicate Monokai match.                                          |
| `terminal/hooks/tests/use-terminal-links.test.tsx` | Two failures              | Selection probe observes a different workspace owner.             |
| `git/components/tests/diff-line-comment.test.tsx`  | Four failures             | DOM tests expect rows from the canvas renderer.                   |
| `editor/tests/prepared-open.browser.tsx`           | One pass, six failures    | Fixture query owner and direct root state differ from navigation. |

The seven expanded DOM failures and six browser failures were rerun unchanged in a detached
checkout of `3c935f6a` and matched the final failure signatures. The two command failures were
recorded during initial characterization. Tests were not weakened to make these failures pass.
The existing preview at port 3300 serves the built artifact, but its backend rejects that
origin with `FORBIDDEN_ORIGIN`; live UI smoke verification is limited by that configuration.

The [async operation ownership implementation](async-operation-ownership.md) consumes these completed APIs.
Its later runtime changes and verification are recorded separately.
