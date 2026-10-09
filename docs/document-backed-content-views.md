# Document-backed content views

A file's live buffer is the one text authority in the web client. Syntax analysis lives beside
that buffer and outlives any single view of it. Editors, diffs, conflict editors and previews
borrow content from the document owner instead of keeping their own copies. This page records
how that works today, what the code guarantees, and the limits we accepted.

Related references: [document and tab identity](document-and-tab-domain.md),
[async operation ownership](async-operation-ownership.md) and
[document contributions](document-contributions/ownership-boundaries.md).

## Ownership

| Owner                                         | Holds                                                                               | Lifetime                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| File snapshot query                           | Disk content, server version, pending and error state                               | TanStack Query policy                                         |
| Live document (`WorkspaceDocumentService`)    | Buffer, revisions, Undo history, save and sync identity, the document's analysis    | Until the workspace releases the document                     |
| Document analysis (Editor)                    | Structural and highlighter sessions, pending work, token results and their coverage | With the document, minus inactive entries the policy reclaims |
| View session                                  | Selection, scroll, viewport, wrapping, layout, DOM                                  | One view attachment                                           |
| Comparison                                    | References to its exact inputs, its revision, hunks and source-to-display mapping   | While a view or preparation holds interest                    |
| Preview lease                                 | A live read of an open file, or a bounded immutable read with explicit coverage     | Until the preview releases it                                 |
| Operation (WorkspaceEdit, conflict, settings) | Captured before and after sources, receipts and stale-write checks                  | The operation                                                 |
| Saved visible paint                           | Serialized visible rows for reload and startup                                      | Reload fallback policy                                        |

Platform keeps the Editor-owned analysis next to each live buffer and decides when the
document goes away. Editor owns the analysis itself. A provider worker can serve many documents,
so releasing one document never terminates a provider another document borrowed. Standalone
`new Editor(element)` creates and owns its own buffer and analysis.

## Analysis and attachment contracts

1. Attaching a view reads the current text snapshot and any compatible ready analysis together
   and publishes both in one render. A warm tab switch installs the retained token store
   directly, with no worker round trip and no full-text serialization. The previous subject stays
   whole until the new one can paint.
2. Every reusable result carries the buffer incarnation, text revision, language, provider
   configuration, theme cohort and covered ranges. The document boundary checks worker replies
   against them, so a reply that arrives after an edit, a reconfiguration, a buffer replacement
   or disposal is dropped.
3. Hover, click and revisit reach one preparation. `FileOpenIntentService.join` hands each
   caller a hold on the same `EditorPreparedDocument` and moves its queued stages to the front.
   Joining never consumes the preparation. The last holder's release cancels and disposes it.
   Cancelling a hover drops only the hover's hold.
4. Every view contributes its own visible range as display demand. Closing or scrolling one view
   leaves another view's demand and data alone. Views with the same configuration share one
   analysis entry; a different configuration gets its own entry.
5. Edits publish through the buffer's revision and edit-chain mechanism. Analysis updates
   incrementally, and rebased or incomplete ranges stay distinguishable from exact results.
   Typing never waits for a worker. A pending structural parse never holds back valid colors.
6. Readiness is `pending`, `ready`, `plain` or `failed`. Plain text is a finished result with no
   tokens. An unavailable highlighter settles into an editable plain fallback; it never leaves a
   frozen overlay. The first-frame color guarantee applies when compatible analysis for the
   visible range is ready.
7. Inactive analysis entries are reclaimed under a count limit, never text or Undo. Views and
   preparation holds protect their entries. Obsolete and abandoned entries go first, then the
   least recently released. Reclaimed analysis is rebuilt on next use.
8. Saved visible paint stays a reload and startup fallback. Retained-tab correctness does not
   depend on it.

## Content view contracts

1. Identity is scoped. A path is qualified by environment and workspace. Immutable Git content
   carries its object identity, side and path. A moving worktree comparison keeps one identity
   while its input revisions change. Buffer incarnation separates replacement from edit.
2. Source meaning is explicit. A live file source means the current buffer, unsaved edits
   included. A disk, index, historical or operation snapshot keeps its captured meaning even
   when the file has a dirty buffer. Compare-with-saved retains both the live buffer and a
   distinct saved snapshot. "Keep my changes" in a filesystem conflict saves the live buffer as
   it is at the click, and refuses if that buffer has closed.
3. Comparison rows are a projection. A comparison owns references to its inputs and the mapping
   between source and display lines. Diff rows reach the editor through the binding's
   `openDocument` and `syncText`; they have no save authority or history of their own.
   Collapsing context changes the projection, never the source revision.
4. Switching and updating are different. A new subject gets its own view session and starts at
   the top. A refresh of the same comparison keeps the reader's place by source anchor and
   clamps an anchor that no longer exists. A page reload restores each pane by source anchor,
   bound to the comparison input it was saved against, at most once per page load. A second
   view or a later revert starts fresh. Old responses cannot attach to a new subject.
5. Analysis sees honest sources. Full source sides can be highlighted. Patch-only, truncated,
   binary, deleted and unavailable content stay explicit outcomes. Patch lines are never parsed
   as a whole file, and historical content never takes the working file's language server URI
   (`features/editor/utils/diff-documents.ts`).
6. Retention has an owner. Views and preparation hold explicit interests. Closing a comparison
   releases its interests without disposing a file, its dirty history or a provider used
   elsewhere. External reads stay TanStack queries; effects use mutations.
7. Previews stay bounded. A text preview reuses the live document when one exists. Otherwise it
   takes an immutable disk-head read that records its byte limit and whether it is complete.
   Partial text never becomes an authoritative file or a save source. Chat attachment previews
   get an immutable read scoped to their environment.
8. Transactions keep their captured meaning. A WorkspaceEdit preview shows the operation's exact
   before and after snapshots. Rendering it never retargets the mutation to the active document,
   and receipts, leases, validation and stale-write refusal stay with the operation.

### Source ranges

`captureSourceRange(read, range, expectedText)` turns offsets on a live preview read into a
`SourceRangeRef`. It succeeds only when the live text at those offsets equals `expectedText`.
`resolveSourceRange(ref, read)` maps the range through the buffer's edit chain to the read's
revision and returns either a rebased ref or one of these reasons:

| Reason                | When                                                                                |
| --------------------- | ----------------------------------------------------------------------------------- |
| `stale`               | At capture, the text at the offsets differs from the text they came from            |
| `edited`              | An edit touched or abutted the range since capture, including at either end         |
| `replaced`            | The read's buffer is another incarnation (reloaded with new text, or reopened)      |
| `ended`               | The lease was released, the file closed, or the owner was disposed                  |
| `partial`             | The range lies past the read's covered prefix, or the read is a truncated disk read |
| `not-live`            | A complete disk or attachment read, which has no edits to follow                    |
| `history-unavailable` | The edit chain no longer reaches the ref                                            |

A live read for a different document throws. Search uses this contract for its results
([Plan 182](../plans/182-search-view-rendering.md#source-handoff-from-plan-200)), and composer
drafts will use it for mentions ([Plan 171](../plans/171-composer-on-our-editor.md#draft-ownership-handoff-from-plan-200)).

## Entry points

| Area                         | Files                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analysis resource            | `editor/packages/editor/src/editor/documentAnalysis.ts` (`createEditorDocumentAnalysis`, `borrowHighlighter`, `borrowStructural`, `reclaimInactive`, `inspectRetention`, `inspectLeases`)                                                         |
| View attachment              | `editor/packages/editor/src/editor/Editor.ts`, `syntaxController.ts`, `preparedDocument.ts`; `editor/packages/react/src/index.tsx`                                                                                                                |
| Edit chain                   | `editor/packages/editor/src/editor/editChain.ts`                                                                                                                                                                                                  |
| Live documents and retention | `apps/web/src/features/editor/state/workspace-document-service.ts`, `inactive-analysis-policy.ts`, `inactive-analysis-retention.ts`; `features/editor/utils/inactive-analysis-budget.ts`                                                          |
| Hover and open preparation   | `apps/web/src/lib/file-open-intent/state/service.ts`, `apps/web/src/features/editor/utils/prepared-document.ts`                                                                                                                                   |
| Disk reads                   | `apps/web/src/lib/file-snapshot-query-cache.ts`                                                                                                                                                                                                   |
| Comparisons                  | `apps/web/src/lib/snapshot-comparison.ts`, `lib/saved-comparison.ts`, `lib/diff-attachment.ts`; `features/editor/state/snapshot-comparison-owner.ts`, `diff-presentation.ts`, `tab-presentation.ts`; `features/git/hooks/use-diff-reload-view.ts` |
| Diff syntax                  | `editor/packages/diff/src/diffSyntax.ts`, `apps/web/src/features/editor/state/diff-syntax-preparation.ts`                                                                                                                                         |
| Conflicts                    | `apps/web/src/features/workspace/state/event-conflict-adapter.ts`, `conflict-editor-resolution.ts`; `features/editor/state/conflict-state.tsx`                                                                                                    |
| Previews and source ranges   | `apps/web/src/lib/file-preview/utils/source.ts`, `preview-query.ts`, `components/text-preview.tsx`; `features/workbench/components/markdown-preview-pane.tsx`                                                                                     |
| WorkspaceEdit preview        | `apps/web/src/features/editor/components/workspace-edit-preview-dialog.tsx`                                                                                                                                                                       |
| Reload fallback              | `apps/web/src/features/workbench/hooks/use-editor-visible-snapshot.ts`, `apps/web/src/lib/editor-visible-snapshot-cache.ts`                                                                                                                       |

## Tests and scenarios

Editor package: `test/documentAnalysis.node.test.ts`, `test/analysisDisplayDemand.test.ts` and
`test/editChain.test.ts` under `editor/packages/editor/`. `bun editor/packages/editor/bench/editChain.ts`
measures edit-chain composition.

Web client, run with real Editor workers in Playwright Chromium:

- `features/editor/tests/prepared-open.browser.tsx`: hover, click and repeated activation share one
  preparation and one session per provider; hover promotion at 0, 200, 2,000 and 35,000 ms;
  dirty text with Undo and Redo tokens checked against captured oracles, saved paint removed.
- `features/editor/tests/retention-acceptance-*.browser.tsx` (failure, handoff, identity,
  interests, mapping, reload, views, worker): first-frame colors, two independent views, worker
  replies, the plain fallback while highlighting retries, and reload handoff. The reload file
  runs through `apps/web/retention-acceptance.vitest.config.ts`.
- `features/editor/tests/retention-count-policy.browser.tsx`: inactive reclamation, and 20 view
  open and close cycles with flat entry, worker session and byte counts.
- `features/editor/tests/diff-attachment-ready.browser.tsx`, `shared-source-categories.browser.tsx`
  and `workspace-edit-presentation.browser.tsx`.

Node and DOM tests: `lib/tests/file-open-intent-service.test.ts`,
`features/editor/state/tests/inactive-analysis-{policy,retention}.test.ts`,
`features/editor/tests/{prepared-document,document-retention}.test.ts`, the
`diff-attachment*.test.tsx` and `*-comparison*.test.ts` families, `diff-presentation.test.tsx`,
`diff-reload-slot.test.tsx`,
`features/workspace/tests/event-conflict-{adapter,completion}.test.*`,
`conflict-editor-resolution.test.ts` and
`lib/file-preview/tests/source-range.test.ts`.

Scenarios (`bun run agent:browser scenario <name>`): `editor-tab-hover-highlights` compares every
visible token run against a settled reference, `editor-reload-paint`, `git-diff-scroll` covers
split and stacked places, copy, in-place refresh, rapid switching with slow reads and page
reload, `settings-raw-conflict`,
`editor-conflict-merge` and `markdown-preview-clobber`.

## Accepted limits

- Retained analysis memory is only partly measured. `inspectRetention` reports token-store
  backing bytes and syntax record backing bytes per entry and per document, counting a shared
  buffer once. It lists JavaScript objects, provider sessions, worker heaps and WASM as
  unmeasured. Routine cleanup reads `inspectLeases`, which never walks token buffers. The
  inactive-analysis budget therefore counts entries: `editor.inactiveAnalysisEntryLimit`,
  default 2, where structural analysis and highlighting each count as one entry.
- First-frame proof runs in headless Chromium with real workers: `prepared-open`, the
  `retention-acceptance-*` files and the `editor-tab-hover-highlights` scenario. Capturing a
  physical display on hardware was dropped as a gate on 2026-10-09.
- The edit chain composes publications into net edits. A composed batch cannot preserve cursor
  affinity inside replaced text, so source-range resolution reports any edit that touches or
  abuts a range as `edited`. The chain keeps 128 publications; older references report
  `history-unavailable`. Callers that follow a range rebase it on each publication.
- Immutable comparison sides (snapshot, history and operation) highlight through the
  highlighting service's diff syntax path with immutable readers. Only compare-with-saved
  shares the live document's analysis.
- Bounded runs on 2026-10-09 did not reproduce these, so their causes stay unknown:
  - #650, cancellation logged as an error: two native-syntax and two typing scenario runs, no
    error-level cancellation events.
  - #794, retained revisit with zero painted token runs: the original composition passed twice,
    and 32 of 32 in the generic configuration.
  - #798, reload bootstrap `ECONNRESET`: 60 of 60 reload runs at the unchanged 30 s deadline.
  - #805, initial syntax readiness stuck at LOADING: 204 of 204 tests across 12 repetitions,
    every readiness observation enabled and ready.
  - The October 5 nightly copy-departure timeout at initial open: 20 runs passed (see #1120).

  #622, the ResizeObserver loop in `prepared-open`, was reproduced and fixed in #1105. The
  nightly `flake-watch` workflow watches for recurrences of all of them.

## Delivery

All pull requests are in ShaulLavo/fregat.

- Foundations: #203 publishes committed revision frames and keeps analysis retained.
- Analysis ownership: #659 retained range readiness, #660 bounded disposed runtime metadata,
  #661 release on final runtime disposal, #664 inactive analysis reclamation, #666 consistent
  shared Shiki paint across splits, #717 shared file preparation and a bounded inactive budget.
- Content views: #675 immutable syntax loans, #678 compare-with-saved inputs, #681 bounded
  preview coverage, #691 Git snapshot sources, #738 Git comparison identity and historical
  provenance, #747 checkpoint comparisons, #750 local history comparisons, #756 comparisons
  attached through retained sources, #781 WorkspaceEdit operation sources.
- Proof and integration: #787 retained document contributions, #803 Git diff scroll modes and
  cold switching, #845 shared Markdown source through pane lifetime and Undo, #852 native
  preview ownership, #865 source and measured-reference integration.
- 2026-10-09 finish: #1096 source range contract and the search and composer handoffs; #1100
  one preparation for hover, click and revisit; #1101 conflict inputs as source references and
  the "Keep my changes" data-loss fix; #1102 pixel-offset diff view state removed; #1103
  overlapping edit composition in the edit chain; #1105 ResizeObserver loop (#622); #1110
  settings conflict scenario framing; #1120 worker acceptance observer race; #1097 analysis
  acceptance checks and token-store byte accounting; #1118 diff reload place applied once per
  page load.
