# Plan 200: Shared documents behind content views

Status: proposed, planning requested by the owner on 2026-09-28. Implementation has not started.
Owners: Platform for resource identity, acquisition, retention and product adapters; Editor for
document attachment and reusable projections. Cross-project order lives in [PLAN.md](../PLAN.md).

## Outcome

Opening a file, comparing revisions, resolving a conflict and previewing content acquire their
sources through the existing document owner. A renderer borrows the content it displays. Views of
the same source revision reuse its buffer and compatible analysis while keeping independent scroll,
selection and presentation. Updating one comparison preserves its reader's place; opening a new
comparison starts at its own initial position.

The owner wants documents to carry more responsibilities over time. This plan establishes the
content ownership boundary for those additions. It extends the existing document system and keeps
renderer choice independent: an editor, Markdown page and small HTML preview can read one source.

## Existing plans and execution boundary

Read before implementation, including their current status and linked delivery records:

| Plan or reference                                                                                           | Existing responsibility                                                                                                                        | Boundary for this plan                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [098 delivery](../docs/document-and-tab-domain.md) and [097 delivery](../docs/async-operation-ownership.md) | Typed document/tab identity, save destinations, captured environment owners, operation-bound text and transaction provenance                   | Extend these contracts. Preserve operation snapshots, leases and stale-write refusal.                                                                                 |
| [099: contribution runtime](099-document-contributions.md)                                                  | Canonical committed-revision publication, consumer synchronization, contribution lifetime and backend-specific adapters, including diff syntax | Consume its publication/runtime contracts. Create no second revision journal, worker synchronization protocol or contribution registry. Its gated units remain gated. |
| [198: document-owned analysis](198-document-owned-editor-analysis.md)                                       | Retained analysis beside the authoritative buffer, shared acquisition/preparation, view attachment, retention and exact-result admission       | Foundation for this work. Reuse its buffer/analysis pair and preparation path; preserve its first-after-wave-2 priority.                                              |
| [197: highlighting service](197-editor-highlighting-service.md)                                             | Provider/service ownership, snippet highlighting and the prepared diff syntax store, in-flight work and eviction                               | Use the landed service. Keep the prepared-diff cache migration here owned by 197; never move it into a second Platform document cache.                                |
| [177: prefetch every press](177-prefetch-every-press.md)                                                    | Intent preparation and promotion                                                                                                               | Hover and activation acquire the same sources with different demand. Preserve intent cancellation and priority.                                                       |
| [182: search view rendering](182-search-view-rendering.md)                                                  | Search multibuffer choice, editor rendering, per-file horizontal scroll, streaming results and edit forwarding                                 | This plan supplies source ownership and revision/range references. 182 owns the search UI and composite editing implementation. Preserve its unresolved decisions.    |
| [171: composer](171-composer-on-our-editor.md), [108](108-markdown-modes.md), [176](176-markdown-parser.md) | Markdown authoring, parser integration, composer migration and presentation modes                                                              | Keep Markdown preview on its file buffer. Composer draft adoption belongs to 171 using the shared owner once its migration is ready.                                  |
| [139: agent diffs](139-acting-on-agent-diffs.md)                                                            | Hunk actions and line comments                                                                                                                 | Preserve source revision, hunk identity and action provenance. Comment re-anchoring remains with its existing owner.                                                  |
| [192: subject switching](192-no-swap-flash.md)                                                              | Hold the previous subject whole until the next can paint                                                                                       | Carry the subject identity with the content through attachment. Preserve loading/error behavior.                                                                      |
| [156: documents in the editor](156-documents-in-the-editor.md)                                              | Future PDF, Office and CSV support                                                                                                             | Leave room for content capabilities beyond text. Add no format engine, binary-to-text conversion or keep-alive policy here.                                           |

Execution order: reconcile landed 099 publication and 198 acquisition/attachment contracts first;
integrate comparison analysis only after 197's diff service ownership is available. Research and
baseline capture can run earlier. Full completion of 099's unrelated minimap/LSP units is not a
dependency. If a required contribution API remains gated, defer that dependent unit to its owner
instead of implementing an alternate runtime. This plan grants no authorization to execute gated
work in other plans and does not reorder their lanes.

## Source audit and drift check

Inspected Platform `4a85ec005` and Editor `401d30cd` on 2026-09-28. Recheck both heads, dirty files,
linked package build and CI `editor-ref` before executing.

- `lib/documents/utils/types.ts` already names file, settings JSON, Git reference, Git diff,
  compare-saved, history, conflict and search documents. Adding identity alone will not fix the
  ownership split.
- `features/editor/state/workspace-document-service.ts` retains live buffers and already carries
  an `EditorDocumentAnalysis` handle. Plan 198 still says implementation has not started. Establish
  which acquisition, attachment and retention guarantees have actually landed; a handle in the
  record is insufficient evidence that the plan is complete.
- `features/editor/components/editor.tsx` receives a joined buffer/view/analysis document. Files,
  settings JSON, Git reference contents and filesystem conflict-resolution buffers use this path.
- `features/editor/components/diff-pane.tsx` installs generated row text through `setText`.
  `state/tab-presentation.ts` and `state/diff-presentation.ts` separately retain its view state.
  `state/prepared-diff-syntax.ts` still owns a bounded prepared-source store; 197 owns its removal.
- Git changes, historical comparisons and agent checkpoints feed `features/git/components/diff-view.tsx`.
  `compare-saved-view.tsx` and `history-pane.tsx` also feed `DiffEditor`.
- `features/workspace/state/event-conflict-adapter.ts` already creates a live conflict buffer.
  Resolution records and source versions remain in `features/editor/state/conflict-state.ts`.
  Git merge markers inside an ordinary file are already part of that file's document.
- `features/search/components/result-file-editor.tsx` opens generated static excerpt documents.
  The search renderer's pooling and windowing are owned by 182.
- `features/workbench/components/markdown-preview-pane.tsx` reads the existing file buffer.
  `lib/file-preview/components/text-preview.tsx` instead reads a preview query; chat attachment
  previews also have a separate read path. `workspace-edit-preview-dialog.tsx` renders transaction
  before/after text directly.
- Chat Markdown/code fences, tool output, approval text and theme samples render HTML. The composer
  currently uses Lexical. Plan 197 intentionally permits snippet highlighting without a retained
  document or public document ID.
- 099's text-transport discussion predates completed Editor E057. Reconcile against the current
  source and delivery records; do not repeat completed transport work.

The motivating bug is fixed independently in `4a85ec005`: a new diff inherited the previous pane's
1,800 px offset because a missing saved position skipped restoration. `git-diff-scroll` fails
before the fix and passes after it, including the visited-file return. Its scenario and registration
were included by a concurrent session in `075507aab`. The restoration test and repository gates pass.
Evidence: `/work/tmp/fregat-evidence/20260928T172242Z-scenario-git-diff-scroll/` before and
`/work/tmp/fregat-evidence/20260928T172301Z-scenario-git-diff-scroll/` after; screenshots were read.
Keep this fix until the shared attachment path supplies the same behavior.

## Ownership and contracts

| Owner                                               | State                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Existing environment/workspace document service     | Resource identity, authoritative text buffer or immutable source, retention interests and save capability |
| Comparison document                                 | References to exact inputs, comparison revision, hunks and source-coordinate mapping                      |
| Editor analysis/highlighting resources from 198/197 | Compatible parsed/token results, provider sessions, preparation, demand and bounded eviction              |
| View session                                        | Cursor, selection, scroll, split/stacked layout and expanded context; two views stay independent          |
| Query/operation owner                               | External reads, pending/error state, cancellation, provenance and transaction snapshots                   |

These are responsibilities to fit into existing types, not five new service classes.

1. **Identity is scoped.** A path is qualified by environment and workspace. Immutable Git content
   includes resolved object identity and side/path. A moving worktree comparison has stable document
   identity plus changing input revisions. Buffer incarnation distinguishes replacement from edit.
   Settings targets and checkpoint owners keep their existing typed identities.
2. **Source authority is explicit.** A live file source uses its current buffer, including unsaved
   edits. A disk, index, historical or operation snapshot keeps that meaning even when the file has
   a dirty live buffer. Compare-with-saved must retain both distinct inputs.
3. **Projection is derived.** A comparison owns source references and mapping; its displayed split
   or stacked rows are a projection. A generated editor buffer, when the current Editor API needs
   one, is a revision-tagged output with no independent save authority or source history. Collapsing
   context changes the projection, never the source revision. Do not introduce a general multibuffer
   implementation as a prerequisite for ordinary diffs; that belongs to 182 and its Editor work.
4. **Attachment distinguishes switching from updating.** A new subject receives its own view
   session and initial state. A revision/projection update preserves that view's source anchor when
   valid and clamps or resets invalid positions deterministically. Source, mapping and ready tokens
   publish together when compatible analysis is already ready. Cold analysis follows 198's pending,
   plain and failure contracts; attachment does not wait for a worker solely to obtain colors.
   Old responses cannot attach to a new subject.
5. **Analysis sees honest sources.** Full source sides may share compatible analysis. Patch-only,
   truncated, binary, deleted and unavailable content remain explicit outcomes. Never parse a
   patch's displayed lines as a complete source file or alias historical content to the working-file
   LSP URI. Preserve the existing safe URI rules in `utils/diff-documents.ts`.
6. **Retention has an owner.** Views and preparation hold explicit interests. Closing a comparison
   releases its interests without disposing a file, dirty history or provider used elsewhere.
   No feature-local promise cache, hidden active-editor pointer or duplicated syntax cache. External
   reads remain TanStack queries; writes and imperative effects use the established mutation path.
7. **Partial previews stay bounded.** Reuse a live document if available. Otherwise a preview may
   acquire a partial immutable read with explicit coverage/version, without allocating a full-file
   editor or loading the whole file. Opening promotes or joins compatible acquisition; partial text
   cannot become an authoritative full file or a save source.
8. **Transactions retain their captured meaning.** WorkspaceEdit previews refer to the operation's
   exact before/after sources. Reusing rendering does not retarget a prepared mutation to the current
   active document. Preserve receipts, leases, validation and recovery.

## Implementation units

### 0. Reconcile foundations and capture controls

- [ ] Record which relevant 099, 197 and 198 contracts landed and which remain owned elsewhere.
- [ ] Trace every source in the audit from acquisition to disposal, with existing caches and keys.
      Include remote ownership, partial reads and operation snapshots.
- [ ] Capture current browser behavior and session/read counters for repeated opens, two views,
      hover-to-open, warm revisits and close/reopen. Use known-good and deliberately failing controls.
- [ ] Record the smallest required Editor API extension. Validate dependency direction and reuse
      existing public snapshots, view sessions and source readers before adding types.

Exit: a checked ownership map and dependency list; no speculative replacement document service.

### 1. Acquire comparison sources through the document owner

- [ ] Extend existing acquisition with typed live, immutable and derived source capabilities.
      Reuse current document keys and query adapters for Git/checkpoints.
- [ ] Represent comparison input identity/revisions and retain their sources for the comparison's
      lifetime. Multi-file checkpoint comparisons reference individual file comparisons.
- [ ] Connect preparation and analysis through landed 198/197 APIs. Keep source acquisition separate
      from per-view layout and expansion.
- [ ] Cover concurrent acquisition, cancellation, exact revision admission and last-interest release
      with real buffers and service tests.

Exit: opening two views of a comparison joins compatible source/analysis work and releases it safely.

### 2. Move every diff entry point onto document attachment

- [ ] Bind generated diff rows to the comparison document and a separate view session. Replace the
      unscoped `setText` switching path with explicit document attachment and same-document updates.
- [ ] Migrate worktree/staged/historical Git diffs, file/turn/session checkpoints, compare-with-saved
      and local history comparisons in the same unit. Preserve source line mapping and split sync.
- [ ] Remove replaced presentation capture/restore and preparation plumbing only after its owner
      has taken over. Leave required diff expansion and layout state with the view.
- [ ] Extend `git-diff-scroll` for split and stacked modes, horizontal scroll, rapid switching and
      cold reads. Verify expansion, selection/copy, line comments and revision refresh.

Exit: new diffs start at the top, revisits restore their view, two views remain independent and
in-place updates preserve a valid reading position. All diff callers use one attachment contract.

### 3. Join conflicts and operation previews to the same sources

- [ ] Preserve the existing live conflict-resolution document. Express its retained inputs and
      comparison as source references; remove duplicated authoritative text only where the operation
      contract permits it.
- [ ] Use comparison documents for WorkspaceEdit preview presentation while retaining operation-bound
      snapshots. Preserve multi-file create/delete/rename and failed-commit recovery behavior.
- [ ] Verify external-change conflicts, ordinary Git merge-marker files, dirty buffers, settings
      conflicts and stale transaction refusal without broadening write capabilities.

Exit: conflict resolution and preview share content ownership without altering save/commit semantics.

### 4. Reuse document reads in lightweight previews; hand off search

- [ ] Route text file previews through shared acquisition with explicit bounded-read coverage and
      captured environment ownership. Preserve their existing HTML renderer and held-subject behavior.
- [ ] Give opened text attachments immutable, correctly scoped source identity and bounded retention;
      retain attachment transport/authentication and binary outcomes.
- [ ] Verify Markdown editor/preview continue to share the same buffer across presentation changes.
- [ ] Specify and test the source revision/range contract needed by 182. Update that plan's handoff
      with the landed API and examples; leave its renderer, multibuffer and edit forwarding there.
- [ ] Record the analogous future handoff for composer drafts in 171. Do not migrate Lexical here.

Exit: previews reuse compatible content, partial reads stay partial, and search/composer plans have
concrete integration contracts without a competing implementation.

### 5. Remove obsolete ownership and ship

- [ ] Audit all three production editor constructors and all migrated preview acquisitions. Remove
      replaced state, adapters and tests in the same change as their callers; no compatibility aliases.
- [ ] Verify bounded retention and cancellation under repeated open/close and environment disposal.
      Measure reads, syntax sessions and retained memory before claiming reuse or performance gains.
- [ ] Run the narrow tests and browser matrix below, relevant repository gates and paired builds.
      Land any Editor changes first and update Platform's CI `editor-ref` with its integration.
- [ ] Commit owned paths, push, deploy via the mesh and verify the served release. Record permanent
      delivery evidence and retire this plan under the repository convention.

## Acceptance matrix

| Case                                            | Required observation                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Diff A scrolled, first visit B, return A        | B starts at zero; A restores its position in split and stacked modes                                          |
| Two views of the same comparison                | Shared compatible content/analysis; independent selection, scroll and context expansion                       |
| Expand context or refresh the same diff         | Valid source anchor retained; source mapping and token revision match displayed text                          |
| Dirty file versus disk/index/commit             | Each input retains its declared meaning; comparison never overwrites the dirty buffer                         |
| Rapid A/B switches with delayed reads/analysis  | Whole-subject handoff; stale replies rejected; no state written under the wrong identity                      |
| Checkpoint/session comparison and partial patch | Correct owning workspace and revision; partial content stays explicit; line actions target the correct source |
| Close one view, cancel hover, evict analysis    | Remaining demand survives; dirty text/undo survives; final release disposes owned work once                   |
| Conflict and WorkspaceEdit preview              | Correct captured inputs, resolution target and stale-write refusal; existing transaction tests remain green   |
| File preview then open, including remote owner  | Compatible acquisition is shared; no cross-environment reuse or forced full read for a bounded preview        |
| Rename/delete/binary/large/truncated source     | Explicit supported outcome; no synthetic source accidentally writable as a real file                          |
| Search and Markdown consumers                   | Revision/range references stay valid or explicitly invalidate; Markdown shares the live buffer                |

Use `bun run agent:browser scenario git-diff-scroll` plus the existing diff syntax, expansion,
clipboard, line-comment, checkpoint, conflict and reload scenarios. Add missing cases in
`scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`. Read screenshots from
`look`/scenario runs. Use `caches` for read ownership and `trace --compare` with session/memory
counters for reuse/performance claims. Exercise actual reads and Editor workers; mock only external
systems. Preserve the repository's input-latency and large-file limits.

## Completion boundary

This plan completes shared content ownership for the listed comparison, conflict and preview
paths, plus concrete search/composer handoffs. Plan 182 still delivers editable search, 171 delivers
the composer, 197 delivers standalone highlighting, and 156 delivers richer file formats. Ordinary
chat messages, tool output, approval text, logs and static theme samples retain lightweight rendering
and optional transient highlighting. Opening their content as a richer document can use the same
acquisition boundary later without retaining an editor document for every rendered string today.
