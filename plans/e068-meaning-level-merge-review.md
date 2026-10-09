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
3. **Detector:** functional implementation verified 2026-10-09; **step incomplete** until
   worker integration and the unchanged **under-2-ms batch gate** pass. The demand-only
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
   grammar test adapter runs on the Node test thread. There are no typing hooks, subscriptions
   or automatic calls. Null session windows and logs without cross-author pairs return before
   syntax work. A production bridge must still register confirmed/projected snapshots in the
   parser worker and schedule review after accepted batches. Batch-scoped results describe
   pairs involving the supplied IDs; request the full window to replace marks after undo or
   retention changes. This step ships no marks UI or session scheduling.

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

   **Cost gate remains incomplete.** Run
   `bun run --cwd editor/packages/collaboration bench:merge-review` after workspace builds.
   Evidence: `editor/packages/collaboration/bench/detector-evidence.json`, with a separately
   instrumented profile in `detector-profile-evidence.json`. Both are **experiment, shared
   machine**, A/B/B/A. Current retained parsing is prepared outside timing, as detection runs
   after parsing; IPC and UI are excluded. The complete detector includes concurrency append,
   pair selection, identity mapping and real queries. For 100 retained records, median
   2/4/8-author batches are 1.140/1.160/1.266 ms (p95 2.491/2.255/2.708 ms). At 8,192 records
   they are **3.218/3.058/3.100 ms**, p95 **5.478/4.823/5.060 ms**. These do not satisfy 2 ms.
   `detector-baseline-evidence.json` records the intermediate cached-state implementation
   before demand-only fingerprints, not the initial implementation.

   The separately profiled representative batch has 100k lines, 100 edits, four authors and
   8,192 retained records. Mean append is 1.728 ms; exact pair selection alone is 0.486 ms;
   detector work after append is 2.298 ms. Current-unit lookup totals 0.878 ms, including
   0.258 ms inside real query matching: one unit range and four query matches per edit.
   V8 samples estimate 0.159 ms append, 0.456 ms pair selection, 0.757 ms unit selection/query,
   0.121 ms signature/candidate checks, 0.057 ms orphan checks, 0.145 ms identity/effect work
   and 0.487 ms bookkeeping per complete batch. These sampled estimates exclude harness/GC
   and are not additive wall timings. Parsing, token fingerprints and `projectEffects` rebuilds
   are zero in this independent-unit timed workload; reconstruction cost remains unbounded by
   this experiment. Append is the largest separately timed component; unit/query selection
   is the largest sampled category. Keep the existing budget and include marked projection
   workloads and worker transport in the remaining proof.

   A separate **experiment, shared machine** in `paste-evidence.json` compares reviewed head
   `d8ff8d97b4249cf3842e6c72b250c82f9137c6ea` with the revision, using two concurrent insertions
   of 16,000 and one UTF-16 units and a trivial injected reader. After ten warmups per version,
   A/B/B/A supplies 60 samples per version: median/p95 148.301/253.077 ms before versus
   0.086/0.176 ms after. Syntax ranges fall from 16,001 to two. A real 100,000-character
   multi-unit paste uses two ranges and 20 real query matches, retaining both signature marks.
   This bounds the paste range-collection regression, independently of the ordinary batch gate.

4. **Marks, hover and resolutions** in the collaboration plugin, wired into the example page.
5. **Fregat:** marks for agent edits racing human typing, review annotations on the host, and the
   "Fix with AI" action. Detection runs in the browser, where the parser lives; the server host
   does not parse. Lands with Delta DB phase 4.

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
