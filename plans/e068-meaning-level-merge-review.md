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
  (`packages/collab`, `packages/textbuffer` identity runs). `setEffects` turns edits on and off
  for author-selective undo, which can rebuild the text as one author saw it (`packages/collab/src/effects.ts`).
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
    clean. Author versions are rebuilt with `setEffects` limited to that unit's edits.
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
   reference engine.
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
3. **Detector** in the tree-sitter worker: `overlap`, `parse`, `signature`, `orphan`, with author
   versions rebuilt through `setEffects`.
   Before frequent batch requests, route the lazy Markdown parse in
   `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts` (`queryMergeUnit`) through the
   existing `parseTreeSlices` / `resumeTreeSlices` cancellation and progress path. Apply query
   progress/deadline checks in `packages/tree-sitter/src/treeSitter/mergeUnits.ts` (`unitAt`),
   and reuse parent eligibility per snapshot within a batch. Current single-range requests
   synchronously parse Markdown and rebuild parent coverage; no batch latency claim is made.
   Reproduce with 100k-line Markdown and TypeScript fixtures and 100 concurrent edit ranges,
   then measure the plan's 2 ms budget and confirm stale or cancelled snapshots release work.
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
