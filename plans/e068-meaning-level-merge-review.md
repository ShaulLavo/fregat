# E068: Review edits that merged cleanly but may not make sense together

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: Approved
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: L
- Dependencies: [E066](e066-collaborative-text.md), [E063](e063-tree-sitter-queries.md): character
  identity, edit dependencies and author-selective undo; query files per language.
- Used by: the peer-to-peer plugin and the [Delta DB plan](delta-db-implementation-plan.md).
- Inspected baseline: `3857795d10a706d75b695931f3b70f34595bdfa2` (Fregat main, 2026-10-09)
- Reference: [Mergiraf](https://mergiraf.org/) at `references/mergiraf` (commit `317eef1`),
  GPLv3. Read its ideas; copy no code or test text.

## Outcome

E066 never loses an edit: concurrent edits always merge, in the same order on every copy. The
merged text can still be wrong. Two people rename the same variable to different names; one
deletes a function while another edits its body; both add a method with the same name; a merged
statement no longer parses. Today nobody is told.

After this plan, the editor marks each place where edits by different authors, made without
seeing each other, landed in the same piece of code and may not make sense together. Every copy
marks the same places. The person can keep both, keep theirs, or keep the other author's, and in
Fregat ask a model for a combined fix. Code that merged without overlap stays unmarked.

## Current code

- Every confirmed edit carries `deps` and `lamport` (`packages/collab/src/types.ts`). Two edits
  are concurrent when neither is in the other's dependencies; this is a property of the log, so
  every participant computes the same answer.
- Character IDs and deletion provenance tell which author inserted or deleted each character
  (`packages/collab`, `packages/textbuffer` identity runs). `setEffects` sends author-owned undo
  commands. `Engine.projectEffects` returns a local snapshot with selected authors' effects on
  or off, preserving the live engine and log. A review reader restores that snapshot on a fork.
- The tree-sitter worker keeps an incremental parse per document, with changed ranges and error
  and missing nodes (`packages/tree-sitter/src/treeSitter/`). Query kinds are `highlights`,
  `folds` and `injections`; E063 adds more kinds as files per language.
- The transaction stream reports each change's origin (local, remote, reconcile) to plugins
  (`packages/editor`, E066 step 6). The collaboration plugin owns sessions and presence
  (`packages/collaboration/src/plugin.ts`).

## What Mergiraf teaches, and what we do differently

Mergiraf is a git merge driver that merges base, left and right file versions as syntax trees
(after Spork and GumTree). Ideas worth taking:

- **Parse all three versions.** Merge at the level of syntax nodes; if any version fails to
  parse, fall back to lines.
- **Commutative parents.** Children of some nodes have no meaningful order (imports, struct
  fields, class members, object keys). Concurrent insertions there are not conflicts.
- **Signatures.** Within a commutative parent, two children with the same signature (an import
  of the same name, two methods with one name) are a conflict even when their text differs.
- **Delete/modify.** When one side deletes an element the other side edited, flag it, unless
  every edited descendant survives elsewhere (the element moved).
- **Fast path first.** Run cheap line-level checks; do structural work only where they find
  something.

What changes for us: Mergiraf has to guess which nodes correspond across versions (tree
matching). We know: every character has an identity and every edit an author and dependencies.
So we skip matching, and we only ever look at code that concurrent edits touched. We also merge
continuously, so the result is a review mark on merged text, never conflict markers.

## Scope

- A deterministic detector over the confirmed log and the current parse.
- A `merge-units.scm` query per shipped language, with a line fallback.
- Marks, a hover with both authors' versions, and three resolutions through author-selective
  undo, in `@singapore-editor/collaboration`.
- An extension point Fregat uses for model-proposed fixes and for agent edits on its host.

Not in scope: changing E066 ordering or placement; refusing or delaying edits; git merges
(Fregat may later offer Mergiraf itself as an optional external merge driver, invoked as a
separate program); type checking or language-server diagnostics as a signal (a later step may add
them).

## Design

- **Merge units.** `merge-units.scm` captures `@merge.unit` (statements, declarations, functions,
  list and argument elements), `@merge.commutative` (parents whose children have no order) and
  `@merge.signature` (the name that identifies a child, such as an import specifier or method
  name). Languages without the file use lines as units.
- **Concurrent groups.** After each confirmed batch, take edits by different authors that are
  concurrent with each other and fall inside a bounded window of recent confirmed edits (the E067
  replay window, 8,192 edits). Map each edit's inserted and deleted character IDs to the smallest
  enclosing merge unit in the current parse; deleted characters map through their surviving
  neighbours.
- **Signals**, each with a stable kind:
  - `overlap`: concurrent edits from two or more authors in one unit, outside a commutative parent.
  - `parse`: the unit has error or missing nodes now, and each author's version of it parsed
    clean. Author versions are rebuilt with `projectEffects` limited to that unit's edits.
  - `signature`: two children of one commutative parent share a signature and came from
    concurrent edits.
  - `orphan`: one author deleted a unit while a concurrent edit by another author inserted text
    inside it. FugueMax keeps that text; it is now stranded.
- **Determinism.** The detector reads only the confirmed log and the text it produces, so every
  copy marks the same units with the same IDs (unit kind plus the character ID of its first
  character). Pending local edits are ignored until confirmed.
- **Cost.** Off the edit path: runs in the tree-sitter worker after the parse that follows a
  remote batch, only over changed ranges that contain concurrent edits. Documents without a
  session or with one author do no work. Budget: under 2 ms per batch for 100k-line files with
  100 concurrent edits, measured.
- **Review.** A mark over the unit and a gutter dot; the hover names the authors and shows the
  base, theirs and yours versions of the unit. Resolutions:
  - Keep both: dismiss the mark.
  - Keep yours / keep theirs: an author-selective undo of the other author's concurrent edits
    inside the unit, sent as an ordinary new edit. Offered only when those edits lie wholly
    inside the unit; otherwise the hover offers keep both and jump-to-edit.
  - Dismissals are local to each peer in Singapore. In Fregat they are annotations on the host
    (Delta DB phase 6), so everyone sees one review state.
- **Extension point.** `onMergeReview(unit, versions)` lets a host add actions. Fregat adds "Fix
  with AI": a model receives the three versions of the unit and proposes a combined edit, which
  arrives from an agent participant and shows as a suggestion until accepted.

## Steps

1. **Concurrency query** in `@singapore-editor/collab`: given a confirmed window, return groups
   of concurrent edits by different authors with their character IDs. Property tests against the
   reference engine. **Delivered 2026-10-09.** `ConfirmedWindow` keeps a canonical suffix of at
   most 8,192 accepted envelopes, supports incremental batches, and returns exact concurrent
   pairs with inserted/deleted ID spans. Effect commands carry causal dependencies; candidates
   are the original text operations. `Engine.projectEffects` supports local author/base review
   snapshots in both engines. Tests cover 50 seeded reference histories, different host arrival
   orders, 30 incremental/eviction histories, transitive dependencies through undo, same-author
   exclusions, the replay cap, UTF-16 spans, and projection snapshot consistency.
   Run `bun run --cwd editor/packages/collab bench:concurrency` after its package build.
   Cost evidence lives in `editor/packages/collab/bench/concurrency-evidence.json`.
   The [append cost follow-up](#concurrency-append-cost) reduces retained-window bookkeeping.
   These are shared-machine experiments; the detector's full 2 ms budget remains a step 3 gate.
2. **Merge-unit queries** in `packages/tree-sitter-languages`, first for TypeScript, TSX,
   JavaScript, JSON, CSS, Markdown, Python, Rust and Go; the other languages in `languages.json`
   use the line fallback until they get a file.
   Delivered in [PR #1153](https://github.com/ShaulLavo/fregat/pull/1153). All nine grammars ship and now load `merge-units`
   through the language manifest and catalog generator. The worker's `mergeUnit` request
   returns the smallest enclosing unit, its source-spelling signature, and its parent range
   with a commutativity flag. Missing queries, unmatched ranges and damaged units use complete
   lines. Missing snapshots report `stale`.
   Query compilation is demand-only. Generic languages reuse the retained tree; Markdown
   creates a structural block tree on the first request because its native renderer hides
   that tree. The extra tree retires with its snapshot and appears in retention inspection.
   Ordered arguments, arrays, CSS declarations, Python definitions, JavaScript class bodies
   and objects, and Go and Rust field lists stay ordered. This preserves overload and decorator
   evaluation, property enumeration, positional construction, layout and destruction order.
   TypeScript interfaces commute only when every semantic member is a property signature;
   methods and call signatures keep the parent ordered. Comments leave eligibility unchanged.
   Import aliases identify local bindings. Each Go field name is a separate unit with the
   declaration as its owning parent, so grouped names remain identifiable. Signatures retain
   source spelling; the detector can normalize escaped or differently quoted names. Duplicate
   signature comparisons apply only to commutative parents; ordered parents expose name hints.
   Verification covers original fixtures for every grammar, separator-enclosing LF/CRLF fallback,
   lazy compilation, incremental edits, stale requests, deepest nested injections, MDX fences,
   injected-language fallback, UTF-16 offsets and all ten independent-review blockers.
3. **Detector:** functional implementation and live worker wiring verified 2026-10-09;
   **step incomplete** until projected-query integration and the unchanged
   **under-2-ms batch gate** pass. The demand-only
   `@singapore-editor/collaboration/merge-review` export combines confirmed concurrency and an
   injectable syntax reader without adding a dependency between collab and tree-sitter.
   It emits `overlap`, `parse`, `signature` and `orphan`, retains exact concurrent edges,
   builds unit IDs from unit kind/first-character identity, filters inactive effects and
   reconstructs author/base versions through local `projectEffects` snapshots. Equivalent
   JSON and JavaScript/TypeScript quoted/escaped signatures normalize before comparison;
   unquoted numeric property names canonicalize separately from quoted strings.
   Token/shape fingerprints are requested only for formatting projections. The syntax reader
   returns one group per requested range: touching selection covers all units intersecting a
   coalesced identity-piece interval, while enclosing selection supports version comparisons.
   Replacement footprints include inserted and deleted identities. Nested units suppress only
   fully covered ancestor touches, preserving edited headers.

   Worker merge-unit analysis retains damaged syntax units and reports errors. Lazy Markdown
   structural parsing now uses `parseTreeSlices` / `resumeTreeSlices`; query progress checks
   use the existing cancellation/deadline context, and parent eligibility is reused per
   retained snapshot/query. Cancellation/disposal of a 100k-block Markdown request releases
   the retained snapshot, and subsequent requests report stale.

   The detector coordinator, effect visibility, identity mapping, signatures, orphan checks
   and projections run on the **invoking thread**. The supplied syntax reader determines the
   query/parse thread; worker `mergeUnit` support runs in the parser worker, while the real
   grammar test adapter runs on the Node test thread. The detector itself has no typing hooks
   or automatic calls. Null session windows and logs without cross-author pairs return before
   syntax work. Step 4 supplies the opt-in production bridge and schedules review after accepted
   batches. Immutable confirmed/projected snapshots use existing worker source readers, and
   touching requests return intersected units with their ancestors. Batch-scoped results describe
   pairs involving the supplied IDs; the live owner requests the full window when replacing marks
   after undo or retention changes. The reader accepts a projected base snapshot through one
   admission seam. Step 4 now wires that seam to the step 3 review-only projected query, retaining
   the confirmed base tree and passing base-relative input edits without admitting projected
   snapshots through the ordinary full-parse path. Detector cost measurements remain step 3 evidence.

   Verification: original 18-case conflict corpus plus wide damaged-tree and quoted-escape
   regressions; 10,000 seeded independent-function cases with zero marks; 10,000 shared-unit
   cases all marked; five real E067 peer-session runs with reordered/duplicate delivery and
   identical converged mark sets. The revised suites pass 194 collaboration tests, 682 collab
   tests (four existing skips), and 137 Node plus 136 browser tree-sitter tests. The corpus
   covers causal copy/move and edited descendants that survive wrapper removal; arbitrary
   copy/delete moves do not preserve character identities.

   Independent-review revision in [PR #1164](https://github.com/ShaulLavo/fregat/pull/1164):
   all 13 initial detector reproductions failed before implementation; the isolated worker
   reproduction exposed three failures with TypeScript cancellation as the known-good control.
   Fifteen detector regressions and four browser cases now cover all ten numbered findings:
   replacement deletion footprints; ancestor/header retention; tombstoned insertions and causal
   deletions; deleted whitespace interrupted by concurrent text; operation-local formatting;
   formatting-filtered signatures and pre-existing duplicates; numeric versus quoted names;
   every surviving orphan portion; fallback analysis/fingerprints/cancellation; and bounded
   paste intervals/queries. Per-operation projections disable only the inspected operation,
   preserving causal surrounding effects. Signature marks require a newly introduced duplicate.
   Projection snapshots are reused per detect call, and mark edges are accumulated once.
   No changes were made to `packages/collab/src/concurrency.ts`; its append tuning is separate.

   **The independent-unit median and marked 8 ms median pass; the 2 ms tail gate remains open.**
   Run `bun run --cwd editor/packages/collaboration bench:merge-review` after workspace builds.
   The 2026-10-09 detector-cost follow-up includes append, exact pairs, identity mapping and
   real syntax queries. Current parsing, authoring, window construction, application, IPC and
   UI remain outside timing. `bench/detector-cost-comparison.json` records four complete
   before/after A/B/B/A invocations against `2266ab2c0`, raw samples, source hashes and separate
   profiles. Every run uses bench-class admission without quiet mode. These are
   **experiment, shared machine**, with 120 complete detector samples per version and setting.
   Each optimized invocation passes the unchanged independent-unit median budget.

   | Retained records | Authors | Median before | Median after | p95 before | p95 after |
   | ---------------- | ------- | ------------- | ------------ | ---------- | --------- |
   | 100              | 2       | 1.243 ms      | 1.158 ms     | 2.526 ms   | 2.189 ms  |
   | 100              | 4       | 1.249 ms      | 1.107 ms     | 2.464 ms   | 2.020 ms  |
   | 100              | 8       | 1.325 ms      | 1.136 ms     | 2.096 ms   | 1.804 ms  |
   | 8,192            | 2       | 2.030 ms      | 1.573 ms     | 3.919 ms   | 3.293 ms  |
   | 8,192            | 4       | 2.029 ms      | 1.656 ms     | 3.841 ms   | 3.246 ms  |
   | 8,192            | 8       | 2.097 ms      | 1.682 ms     | 3.609 ms   | 3.300 ms  |

   Repeated retained-history traversal and per-pair effect bookkeeping were the ordinary
   bottlenecks. `ConfirmedWindow` maintains retained-author counts; ordered batch selection
   looks up supplied IDs and binary-searches causal positions. Nonmonotone arrivals still scan
   canonical candidates. The detector reuses its involved-edit set on the all-active path and
   checks identity origins directly for orphan eligibility. Failed appends, eviction,
   missing/repeated batch IDs and non-tail selection preserve pair order and results.

   Separately instrumented four-author profiles put exact-pair means at
   0.524/0.515 ms before and
   0.100/0.089 ms after. Detector work after append falls from
   2.536/2.462 ms to
   1.860/1.761 ms. Unit lookup remains
   0.958/0.906 ms after, with 100 ranges and 400 real query matches.
   These profiles include instrumentation overhead; they are separate from the median gate.
   No unmeasured explanation is assigned to shared-machine tails. `detector-evidence.json` and
   `detector-profile-evidence.json` contain the last optimized run. Historical intermediate
   `detector-baseline-evidence.json` predates demand-only fingerprints.

   `bench/candidates.test.ts` measures a marked 100k-line, 100-edit, four-author, 8,192-record
   batch: 96 independent replacements, one formatting/content pair and two conflicting string
   replacements. Each timed batch creates three projected snapshots, parses three versions
   and fingerprints two ranges. Current parsing stays outside timing; projected trees are
   released between batches. Sixteen samples per version give median/p95
   **811.451/871.644 ms cold before** and
   **3.615/7.096 ms bounded after**. Projected parsing alone changes from
   807.759 ms to 0.235 ms at the median; every optimized sample uses three bounded parses.
   Every run asserts overlap and parse marks, the exact conflicting edit IDs and formatting
   exclusion. `candidate-evidence.json` contains the last optimized run; the comparison file
   retains both versions, raw samples and excluded exploratory failures.

   Whole-document version parsing dominated the marked path. Copy/edit alone was cheap, but
   incremental parsing of a 100k-child flat root still missed one frame in exploratory pilots.
   The language-neutral projected reader parses affected top-level units with neighboring
   parent context at absolute source coordinates. It expands through damaged recovery nodes,
   checks unchanged clean boundaries and uses copied-tree incremental parsing when the context
   remains damaged, is not self-contained, has injection layers or a later range lies outside
   the cached bounded tree. Full-document parent geometry is restored for bounded query results.
   Damaged-line error lookup now descends at the exact point and visits overlapping siblings.
   Both benchmark versions use this final query helper; the cold A path still reparses each
   projected document in full. No retained highlighting tree is edited directly.

   Minimal bridge contract: the optional fifth `MergeReviewSyntax` argument is the retained
   current/base snapshot for a projected read. `createTreeSitterInputEdits(baseRead, edits)`
   creates base-relative UTF-16 parser edits. `TreeSitterWorkerOwner.projectMergeUnits()` takes
   the retained `baseSnapshotVersion`, a distinct projected `snapshotVersion`, projected `source`,
   `inputEdits`, `ranges` and optional analysis, fingerprint, selection and cancellation flags.
   It returns one unit group per range with `ok`, or an empty result with `stale`/`cancelled`.
   Each projected unit carries its own `languageId` for nested injections.
   Projected versions have an isolated per-runtime cache, bounded by the existing six-snapshot
   and eight-million-source-unit limits; eviction of a base also releases its projections.
   The distinct request leaves highlighting and the existing `mergeUnit` contract unchanged.

   Projection ownership follow-up: a new projected tree stays request-owned until every unit
   query and the final cancellation/stale check succeeds. All other exits dispose its trees,
   source reference and native Markdown document; a completed cached projection remains owned
   by retention when a later request is cancelled. Replacement projections commit only after
   success. Each base snapshot holds its own dependency set, allocated only after a successful
   projected read. Highlighting disposal traverses that set only; ordinary documents perform
   no projection-cache lookup or traversal. The retention diagnostic `projectionCleanupVisits`
   counts dependencies visited during base disposal. A failing-first real-worker regression
   with eight review sessions and six unrelated highlighting evictions changes from 48 visits
   to zero, while disposing a review base visits exactly its one owned projection. Mid-query
   cancellation regressions cover new and reused TypeScript/Markdown projections, resource
   counts and source pins; an invalid-query regression proves exception cleanup.

   The review-fix **experiment, shared machine** repeats complete A/B/B/A under bench-class
   admission without quiet mode. The comparison file's `reviewFixVerification` retains all raw
   samples and source hashes. Ordinary 8,192-record before/after medians are
   2.191/1.715, 2.219/1.854 and 2.223/1.873 ms for 2/4/8 authors; after p95 is
   3.579/4.115/3.721 ms. Marked before/after median/p95 is
   801.082/903.444 versus 4.607/9.545 ms, with three bounded parses in every after sample.
   All ordinary medians and the additional marked 8 ms median gate pass; the ordinary 2 ms
   p95 gate remains open. This detector fixture bypasses worker transport and retention;
   real-worker cancellation/resource and dependency-visit tests prove the ownership fixes.

   Differential corpus, regression and seeded detector cases compare projected results with
   cold full reparses across JavaScript, TypeScript, TSX, CSS, JSON, Markdown, Python, Rust and
   Go. They assert retained-tree serialization stays unchanged, including incremental fallback.
   A real-worker browser test also checks identical groups, later-range expansion, concurrency,
   missing bases, cancellation, projection-cache eviction and runtime disposal. Markdown/MDX
   nested-fence cases compare against full worker parses and release every owned tree/document.
   Native Markdown needs a separate full-text native document to discover projected fences;
   it never reuses the highlighting document. This fallback is outside the TypeScript cost proof.

   The ordinary p95 and marked batch still exceed the unchanged 2 ms budget. The representative
   marked median passes the additional 8 ms frame target; this is not a dense-conflict worst-case
   bound. The 2026-10-10 cost follow-up below measures production worker transport, dense marks
   and UI work. Wide/damaged or injected contexts that take incremental fallback still need a
   bound. Reproduce with the benchmark commands and `bench/workload.ts`; retain the ordinary
   budget and the exact full-reparse differential control while investigating these tails.

   A separate **experiment, shared machine** in `paste-evidence.json` compares reviewed head
   `d8ff8d97b4249cf3842e6c72b250c82f9137c6ea` with the revision, using two concurrent insertions
   of 16,000 and one UTF-16 units and a trivial injected reader. After ten warmups per version,
   A/B/B/A supplies 60 samples per version: median/p95 148.301/253.077 ms before versus
   0.086/0.176 ms after. Syntax ranges fall from 16,001 to two. A real 100,000-character
   multi-unit paste uses two ranges and 20 real query matches, retaining both signature marks.
   This bounds the paste range-collection regression, independently of the ordinary batch gate.

4. **Marks, hover and resolutions. Delivered 2026-10-09** in the collaboration plugin and
   the real Edit together example. `mergeReview` opts an attachment into a confirmed-window owner;
   sessionless views, uninterested plugins and single-author documents do no detection work.
   A cancellable MessageChannel task coalesces accepted remote batches outside authoring; local-only
   confirmations dispatch no detector work. A remote request waits for an already-pending local
   acknowledgement, including histories already containing multiple authors, so both confirmed sides
   can be compared. Rejected-only batches leave existing
   marks intact and schedule no syntax work. History resets
   and newer confirmations invalidate published marks; obsolete work releases source snapshots
   before the next run. Detach unsubscribes and releases the review lifetime.

   Unit highlights and an opt-in native gutter lane paint review dots beside text, including
   editors with no line-number gutter. Dots live inside gutter cells so text clipping preserves
   their paint. The shared hover names authors and shows Base, Theirs and Yours.
   Keep both dismisses locally. Keep yours / Keep theirs project author-selective effects in a
   local engine, then submit a bounded ordinary edit through the editor's collaboration author.
   Foreign `setEffects` are never transmitted. Every removed insertion/deletion identity and the
   resulting diff must lie wholly inside the unit; cross-unit edits offer Jump to edit for manual
   review. Actions from dismissed, pending or obsolete versions change no text. A resolution immediately
   retires its local action. On every peer, a causally later accepted edit within the unit supersedes
   the old concurrency edges; replay and fresh attachments derive the same retirement from the
   retained log. New concurrent edits remain reviewable.
   `onMergeReview(unit, versions)` lets hosts append actions. Shared hover controls use a compact
   button footer outside the version scroller. Content-sized placement starts beside the owning
   unit, flips vertically when needed and shifts within its pane and viewport margins.

   Node regressions cover scheduling exclusions, local dismissal, version reconstruction,
   cross-unit safety, stale actions, history reset, obsolete work, release failures and disposal.
   Real-editor browser tests cover both resolutions reaching every peer as accepted ordinary
   edits, shared-hover action handlers, host actions, uninterested attachments and the production
   parser bridge. Fixture hover handlers run synchronously; the standalone scenario owns native
   keyboard and pointer verification. The portable `collaboration-merge-review` scenario holds
   only the example's real BroadcastChannel delivery,
   types through native editor inputs, then clicks each resolution. It checks convergence,
   local dismissal, dot bounds outside text and hover contrast. Revision coverage checks settled
   resolution retirement, reopened hovers, both peers, a unit at a pane edge and a real cross-unit
   manual action. The manual fixture orders peer identities to retain Alice's insertion in the
   first declaration; the other cases retain random identities. Every offered action must be
   hit-testable inside the hover before any click; Playwright auto-scrolling cannot make a clipped
   action pass. Three consecutive native runs passed. Twelve screenshots cover these states;
   the mark, both peers’ hovers, all resolutions, pane-edge hover, manual hover and separate
   `look` capture were read back. Revision evidence is
   `20261009T185446Z-scenario-collaboration-merge-review-N7qcLB`
   and `20261009T185341Z-look-collaboration-html-1440x1000-qzmSYf`. Final hover polish removes
   host focus outlines from comparison regions, keeps keyboard focus visible on buttons, and
   separates content sections by tone. A failing-first browser regression supplies the host focus
   rule; all 22 shared-hover tests pass. The native scenario also checks outline-free, border-free
   content sections before clicking. Refreshed screenshots were read back from
   `20261009T190839Z-scenario-collaboration-merge-review-RQmT0p`; site-mode look evidence is
   `20261009T190932Z-look-collaboration-html-1440x1000-LYR2LA`. Example theme type is
   explicit so its dark page and shared hover use the same palette.

   Integration after the step 3 query and fixed parser runtime merged: author projections now call
   `projectMergeUnits` with the retained base version, a distinct projected version, a scoped source
   reader and `createTreeSitterInputEdits` from the minimal snapshot diff. Each returned unit keeps
   its own injected language; stale/cancelled requests return unavailable and release their loans.
   Two failing-first real-worker tests observed two `parse` calls where one was required. The bridge
   now parses the base once and sends all nine projections through `projectMergeUnits`; its 29-test
   worker suite includes nested Markdown → JavaScript → JSON identities and real stale/cancelled
   replies with source cleanup. The real-editor suite has 55 passes and one existing skip, including
   fenced JSON review and peer-convergent resolution wholly inside the marked unit. Existing Node
   review/detector tests pass (225), as does the two-engine causal oracle (30). The integrated native
   scenario has twelve captures and no page problems. Screenshots were read back from
   `20261009T195503Z-scenario-collaboration-merge-review-m4qxMV`; site-mode look is healthy at
   `20261009T195509Z-look-collaboration-html-1440x1000-oDT0WK`. The cursor-index workaround is
   unchanged for its separate follow-up; this integration makes no new performance claim.

5. **Fregat:** marks for agent edits racing human typing, review annotations on the host, and the
   "Fix with AI" action. Detection runs in the browser, where the parser lives; the server host
   does not parse. Lands with Delta DB phase 4.

### Concurrency append cost

Delivered 2026-10-09. The detector profile in [PR #1164](https://github.com/ShaulLavo/fregat/pull/1164)
attributes 47% of sampled batch CPU to retained-window append. A fresh run of the original
concurrency bench reproduced 1.66–2.39 ms append-and-query medians with an 8,192-edit prefix.
The document has 100k lines and the new batch contains 100 concurrent replacements.

The bottleneck was rebuilding the retained index on each append. An instrumented baseline
spent about 80% of append time sorting, rebuilding membership/live ranges, mapping retained
entries, evicting by full-map traversal, and recreating candidate arrays. This includes
instrumentation overhead. The remaining entry-creation phase also scanned old entries to
skip them. These costs grow with retained edits, not document characters.

`ConfirmedWindow` now keeps a bounded canonical array alongside its ID index. A batch after
the canonical tail sorts only incoming envelopes, retains the previous suffix by reference,
creates only new causal entries, and deletes only evicted map entries. Contiguous causal
positions supply one live interval. Candidate and position arrays keep their suffixes.
Empty batches and exact retries return after validation. Interleaved arrivals retain the
canonical sorting path and exact live-position intervals. The extra array holds references
to existing entries; suffix copies remain proportional to the window size. There is no new
public API, timer, parser work, or whole-document text read.

Evidence is `editor/packages/collab/bench/concurrency-append-evidence.json`. Both runs are
**experiment, shared machine**, under bench-class admission without quiet mode. Each run
alternates baseline/current/current/baseline with 102 timed samples per mode after 40 warmups.
The baseline is `c1b3da7076daf38dd0a6a3bb1a43c2c6a2ccc39b`. Prefix setup, real textbuffer
operations, and equality checks are outside timing. The table pools all 204 samples per mode
for the 8,192-edit prefix; both complete runs and their tails remain in the evidence.

| Authors | Append median before | Append median after | Median reduction | Append p95 after | Append + pairs median after |
| ------- | -------------------- | ------------------- | ---------------- | ---------------- | --------------------------- |
| 2       | 1.252 ms             | 0.272 ms            | 78.3%            | 0.342 ms         | 0.674 ms                    |
| 4       | 1.302 ms             | 0.289 ms            | 77.8%            | 0.355 ms         | 0.637 ms                    |
| 8       | 1.309 ms             | 0.294 ms            | 77.5%            | 0.501 ms         | 0.649 ms                    |

Median append now uses about 14–15% of the 2 ms detector budget. The first eight-author pilot
had a 1.926 ms append p95, so these shared-machine results do not establish a worst-case
bound. Parsing, unit mapping, and version reconstruction remain excluded. The full detector
budget is unchanged and still belongs to step 3.

After building the baseline and current collab packages, rerun the paired measurement with
`node editor/packages/collab/bench/concurrency.mjs --compare <baseline-collab-dist/index.js>`.
The original `bench:concurrency` command still measures full construction against incremental
append-and-query. Final comparison samples assert identical retained edits and exact pairs.
Property tests add 30 seeded causally ready arrival histories with mixed canonical insertion
and tail append, limits including zero, empty/retry batches, effect-command eviction, and
atomic rejection of malformed batches.

### Cost follow-up, 2026-10-10

Status: Approved. The allocation and cursor changes are implemented. The latency work listed
below remains open; this follow-up does not waive the 2 ms target.

`editor/packages/collaboration/bench/runtime-cost-comparison.json` retains the final source
hashes, complete Mac A/B/B/A invocations, raw samples, per-message measurements, power/load
records and Linux allocation profiles. The baseline is
`73cca5d261ab9b2a987c53b90d461b218593053c`. All numbers below are **experiment, shared machine**.
Mac measurements use the Apple M1, macOS 26.4, Node 25.2.1 and headless Chromium. Power
records show AC. The shared Mac turn serializes cooperating controllers, but those controllers
recorded load and power without enforcing either guard. These are **unguarded, lock-serialized
shared-machine experiments**. Browser after runs recorded one-minute loads 3.48/3.54; cursor
after/after/before runs recorded 3.15/3.30/3.25; detector-gate after/after/before runs recorded
3.06/3.10/3.08. The earlier load-below-3 qualification was unsupported and is withdrawn.
Those earlier Mac timing results are descriptive observations; they establish neither a qualified
latency result nor cursor cost-regression proof. Those experiments had no enforced load guard. Linux uses
the i7-14700K and Node 26.7.0 through non-quiet bench-class admission; its wall times are not
verdicts. Raw samples, source hashes and arithmetic summaries remain unchanged.

#### Ordinary batches and allocation

The instrumented tail probe holds input shape fixed: 100k TypeScript lines, 100 edits,
four authors and 8,192 retained records. Every measured batch has 100 ranges, 400 real query
matches, zero parses and zero marks. Current parsing and window construction stay outside
timers, although repeated construction contributes heap pressure between batches. Four
complete ordinary/GC-control/GC-control/ordinary blocks provide 100 samples per mode in each
invocation. Each production version has two invocations, hence 200 samples per mode.

Nested deletion-overlap callbacks created temporary closures for every concurrent pair.
The detector now uses short-circuit loops with the same interval test. Separate V8 allocation
sampling covers 20 detector-only batches per invocation, at a 128-byte sampling interval,
including collected objects. These are allocation estimates, not exact object counts.

| Machine and method                   | Before estimated bytes per batch | After estimated bytes per batch | Before sampled allocations per batch | After sampled allocations per batch |
| ------------------------------------ | -------------------------------- | ------------------------------- | ------------------------------------ | ----------------------------------- |
| Linux, non-quiet A/B/B/A V8 sampling | 4,003,147–4,004,690              | 3,503,210–3,506,924             | 20,143–20,160                        | 18,120–18,128                       |
| M1 Mac, AC A/B/B/A V8 sampling       | 4,011,935–4,015,703              | 3,502,282–3,620,299             | 20,212–20,221                        | 18,110–18,965                       |

The Linux estimate falls about 12.5%; both Mac after runs also allocate less. This removes
measured waste without changing the retained-state model, pair results or syntax requests.
It does not establish a tail-latency improvement.

| M1 instrumented probe     | Median before | Median after | p95 before | p95 after |
| ------------------------- | ------------- | ------------ | ---------- | --------- |
| Ordinary                  | 2.305 ms      | 2.349 ms     | 3.001 ms   | 3.650 ms  |
| Explicit GC outside timer | 4.471 ms      | 4.448 ms     | 4.686 ms   | 4.649 ms  |

Only one of 200 ordinary before samples and two of 200 after samples intersect GC events.
Removing those samples still leaves p95 at 2.988/3.130 ms before/after. The query and parse
counts stay identical, so these tails are not an alternate syntax or projection path.
Explicit GC removes overlapping collections but changes heap conditions and makes this
probe slower. It is not a lower-bound timer. GC explains some extremes, not the ordinary
p95 as a whole. The remaining non-GC variation is unresolved; the path is not declared lean
and the tail work is not dropped.

The unchanged `bench/detector.test.ts` supplies the separate, uninstrumented cost gate.
Two A/B/B/A invocations per version provide 120 complete-detector samples per setting on
the M1 Mac on AC, with 8,192 retained records:

| Authors | Median before | Median after | p95 before | p95 after |
| ------- | ------------- | ------------ | ---------- | --------- |
| 2       | 1.794 ms      | 1.830 ms     | 3.054 ms   | 2.411 ms  |
| 4       | 2.020 ms      | 2.037 ms     | 6.489 ms   | 6.307 ms  |
| 8       | 2.146 ms      | 2.145 ms     | 3.534 ms   | 6.345 ms  |

In these unguarded samples only the two-author median is below 2 ms; no p95 is below it.
These observations cannot establish a qualified gate pass or failure. The allocation change
has no established latency win, and the 2 ms target remains open. The attribution probe includes
query instrumentation and yields with `setImmediate` between samples so GC events can arrive;
the existing gate has its original scheduling. Their p95 values are not interchangeable.
The prior Linux median passes remain historical evidence, not a new Mac verdict.

#### Worker requests, dense conflicts and UI

`bench/runtime.browser.test.ts` uses the production bridge and a real parser worker. Each
invocation warms up once and measures four ordinary/dense/dense/ordinary passes. Two
invocations per production version provide 16 samples per shape. Dense means 50 conflicting
units from the same 100-edit batch; every run asserts all 50 overlap marks.

| M1 Mac, AC A/B/B/A, after version            | Ordinary         | Dense, 50 marked units |
| -------------------------------------------- | ---------------- | ---------------------- |
| Complete detector median/p95                 | 53.000/53.600 ms | 53.900/56.300 ms       |
| Summed request/result round trips median/p95 | 51.200/52.400 ms | 52.100/53.500 ms       |
| Query request/result pairs per batch         | 100              | 150                    |
| Request JSON UTF-8 bytes per batch           | 31,536–31,836    | 47,304–47,754          |
| Result JSON UTF-8 bytes per batch            | 61,444–61,644    | 92,166–92,466          |

The ordinary bridge awaits one worker query per range in
`editor/packages/tree-sitter/src/mergeReview.ts:160–182`. The dense batch adds 50 current-range
queries. Byte counts cover these query envelopes, are computed after timing and are a
reproducible JSON-size proxy. They are not structured-clone wire bytes or a count of all
worker traffic. Round trips include worker query/projection work and any source reads.
Current parsing and window setup are excluded. The approximately 53 ms measures review
completion, not 53 ms of blocked editor-thread execution. These unguarded observations do
not establish a qualified cost comparison with the synchronous detector fixture. The actual
100/150 sequential exchanges identify work to investigate independently of timing.

UI measurements use real two-peer EditorRoom sessions and ReviewView over 100k lines, with
an injected line syntax reader to isolate painting from parsing. Timers sum every ReviewView
update during editing and settlement across both editors, including highlight/gutter geometry
and DOM work. They do not isolate rasterization or compositor presentation. Sixteen after
samples per shape give the following M1 Mac AC A/B/B/A results.

| Marks per editor | Two-editor update calls | Summed update median/p95 | Hover through two frames median/p95 |
| ---------------- | ----------------------- | ------------------------ | ----------------------------------- |
| 1                | 18–19                   | 1.000/1.100 ms           | 33.400/35.400 ms                    |
| 50               | 214–215                 | 7.200/9.100 ms           | 33.200/34.800 ms                    |

Hover timing includes command dispatch, polling for the visible review dialog and two
animation frames. It is not isolated CPU time. The captured dense hover was read back and
shows marks, gutter dots and review actions. The standalone fixture lacks production theme
styling; this is state evidence, not a product appearance review. No React components
participate, so React render counts do not apply. No UI speedup is claimed.

#### Cursor replacement and reruns

`mergeRangeHasErrors` now uses `gotoFirstChildForIndex` directly and releases its cursor.
The previous-sibling inclusion remains inclusive, and EOF checks begin with the last child.
An independent error-node oracle checks late sibling boundaries and EOF in a 100k-line tree.
The Node large-document/cursor/error-range suite passes 20 tests; 29 real-worker merge-unit
browser tests pass. The collaboration corpus passes 225 tests after allocation tuning.

The isolated M1 Mac AC A/B/B/A cursor benchmark measures 100 late comment-line error checks
in a retained 100k-line TypeScript tree with an early damaged declaration. Parsing and
merge-unit query execution are excluded. Five warmups and 20 samples per invocation provide
40 samples per version. Median/p95 is 289.120/290.172 ms before and 249.637/249.954 ms after.
Results are identical. The numerical decrease is an unguarded observation and does not
establish a latency improvement or absence of cost regression. Guarded cursor cost-regression
proof remains open, together with a bound for damaged or injected contexts.

Rerun from the checkout after workspace builds, with an absolute evidence directory:

```sh
bun run build:workspaces
E068_EVIDENCE_DIR="$PWD/evidence" bun run --cwd editor/packages/collaboration bench:merge-review bench/tail.test.ts bench/cursor.test.ts
bun run --cwd editor/packages/collaboration bench:merge-review bench/detector.test.ts
COLLABORATION_EVIDENCE_DIR="$PWD/evidence" bun run --cwd editor/packages/collaboration bench:review-runtime
```

Keep benchmark sources fixed while alternating the recorded baseline and current production
`merge-review.ts` and `mergeUnits.ts` in A/B/B/A order. Each uninstrumented detector invocation
writes `bench/detector-evidence.json`; retain it separately before the next invocation.
For qualified Mac reruns, use the shared Mac turn and have the controller enforce and record
AC power and one-minute load below 3 before each sample block. Holding the turn lock alone
does not enforce these conditions. Linux runs remain non-quiet and report allocation counts
only. Early pilots with unavailable GC, interleaved controls and
an overly broad cursor timer are excluded from the final comparisons.

#### Batched worker reads

The bridge groups all ranges from one syntax read into a single `reviewBatch`
request. Independent detector reads in the same analysis step share that request through
`TreeSitterReviewSyntax.batch`. The worker evaluates them in input order using the existing
current-unit and author-projection query paths. A runtime cancellation flag covers the batch;
individual stale/cancelled results still make the affected read unavailable. Batch release
waits for the worker task and releases every source loan, including when a loan release fails.
The retained projection limit and base-tree ownership are unchanged. Runtime disposal also
cancels entry-local flags. Concurrent pairs share in-flight formatting comparisons by edit and
unit; their independent current/projection reads enter the same batch. A real-parser coarse-unit
regression catches duplicate comparisons while the reads are still pending.

The non-quiet Linux experiment over the same 100k-line, four-author, 100-edit fixtures proves
100 ordinary / 150 dense query exchanges become one total worker request per detector batch.
All eight after samples per shape assert the one-request bound and exact equality against a
reader without coalescing. Both shapes retain their marks, including all 50 dense overlaps.
The baseline traffic in this reproduction is entirely `mergeUnit`; the extra dense ranges
are current deletion footprints, not author projections. Projection batches are separately
covered by real-worker tests, including mixed current/projected reads, nested languages,
stale/cancelled entries, runtime disposal and rejected source-loan release. New projected
sources still use the document-source loan protocol; this experiment does not establish a
constant count of source-transfer messages for arbitrary projection-heavy histories.

| Linux, experiment, shared machine | Ordinary before / after       | Dense before / after          |
| --------------------------------- | ----------------------------- | ----------------------------- |
| Query request/result pairs        | 100 / 1                       | 150 / 1                       |
| Query request JSON UTF-8 bytes    | 31,536–31,836 / 4,521–4,525   | 47,304–47,754 / 6,589–6,593   |
| Query result JSON UTF-8 bytes     | 61,444–61,644 / 24,953–24,955 | 92,166–92,466 / 37,339–37,341 |

JSON sizes remain a payload-size proxy. They are not structured-clone wire bytes. Linux
elapsed times are excluded from verdicts while the PC runs the owner's Bevy workload.
`editor/packages/collaboration/bench/batched-worker-evidence.json` records source hashes,
request counts and guarded Mac A/B/B/A samples. Both portable JavaScript/WASM versions were
built on Linux before taking the Mac turn. The controller enforces AC and one-minute load
below 3 immediately before every sample block; recorded loads were 2.98, 2.76, 2.44 and 2.27.
One warmup pass and four measured fixture-order passes per block give 16 samples per shape
and production version. Every sample matches the non-coalescing reader, and mark hashes
match across versions. These are worker-only **experiment, shared machine** results; UI
samples are omitted.

| Guarded M1 Mac, before / after | Ordinary         | Dense, 50 overlaps |
| ------------------------------ | ---------------- | ------------------ |
| Total worker requests          | 100 / 1          | 150 / 1            |
| Complete detector median       | 50.95 / 48.50 ms | 52.10 / 49.45 ms   |
| Complete detector p95          | 52.20 / 49.90 ms | 53.00 / 50.40 ms   |
| Summed query round-trip median | 49.25 / 47.25 ms | 50.55 / 48.05 ms   |

P95 uses nearest rank. The median completion observations are about 5% lower. The exchange
count goal is met, but one reply still takes roughly 47–48 ms and the 2 ms target remains
open. Count reduction alone does not explain that remaining cost.

Two earlier setup attempts stopped before collecting any timing sample because load was
4.78 and 3.12. A queued retry also reached its ten-minute background limit before admission.
The successful retry used portable bundles and a longer bounded guard wait. Failed attempts
supply no timing verdict; every attempt removed its owned Mac temporary directory.

The runtime bench also now waits for both lazy hover controllers before editing and measuring
hover opening. A reproduced command-dispatch failure showed that two animation frames did
not guarantee the demand-loaded hover plugin was ready. The readiness check is outside all
reported timers; no hover speedup is claimed.

Remaining Approved work:

- [ ] Establish cursor cost-regression proof with an A/B/B/A rerun that enforces and records
      AC power and one-minute load below 3 before each sample block. Retain exact-result checks.
- [ ] Continue the ordinary 2 ms tail investigation using the uninstrumented detector gate and
      instrumented probe together. Do not assign all tails to GC or close the gate from a median.
- [x] Group the current-unit worker exchanges into one request per ordinary/dense batch.
      Retain exact mark equality, cancellation, source ownership and bounded projection caches;
      the batched worker reads evidence above covers the real-worker regression checks.
- [ ] Profile the remaining batched worker cost. The guarded ordinary/dense query-reply medians
      are 47.25/48.05 ms with one request; source hashes and all samples are in
      `editor/packages/collaboration/bench/batched-worker-evidence.json`. Reproduce from
      `editor/packages/collaboration` with `node ../../../node_modules/vitest/vitest.mjs run
--config vitest.review-cost.config.ts`. Start at `queryReviewBatch` and `queryMergeUnit`
      in `editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts`; separate worker query
      execution, source access and exchange latency before assigning the cost to any one of them.
      Linux elapsed times remain diagnostic; repeat timing comparisons with the guarded Mac turn.
- [ ] Bound late damaged-root/error-range checks and wide/injected incremental fallbacks.
      `bench/cursor.test.ts` now reproduces the expensive late damaged-root lookup independently
      of syntax-query execution; repeat it with the existing full-reparse differential corpus.

## Verification

- A scenario corpus written from scratch for each Mergiraf conflict family (independent changes,
  unordered insertions, formatting vs content, moved and edited elements, delete/modify) plus
  ours (same rename two ways, broken parse, duplicate import, stranded insert). Each asserts
  the expected marks, and no marks where Mergiraf would merge cleanly.
- False positives: seeded E066 simulations where authors type in different functions produce zero
  marks across 10,000 runs; where they type in the same function, every run marks it.
- Determinism: all peers in E067 simulations report identical mark sets after convergence.
- Cost: a bench of 100k-line TypeScript with 2–8 authors and 100 concurrent edits per batch
  meets the 2 ms budget; documents without a session show zero detector calls.
- `look` screenshots of a mark, its hover and each resolution, read back.

## Risks and decisions

- Unit granularity decides the noise level. Too small misses real conflicts; too large flags
  every shared function. Start at statements and declarations; tune with the corpus.
- Semantic conflicts across units (one person renames a function, another adds a call to the old
  name elsewhere) are not caught by syntax. A later step can feed language-server diagnostics that
  appear right after a merge into the same review.
- Rebuilding author versions needs edits still inside the retention window; older merges are
  not reviewable. Shares E066's identity-compaction decision.
