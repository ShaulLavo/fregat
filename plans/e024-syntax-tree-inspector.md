# E024: Inspect the live syntax tree

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: Approved
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: M
- Dependencies: None
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`

Decided 2026-09-25: owner — kept.

## Outcome

Browse the parse behind the current editor, inspect node kinds and ranges, follow the cursor's
ancestor path, and select source from a node. A huge tree remains responsive because the inspector
requests and renders only the nodes needed to navigate it.

## Current code

- [The Tree-sitter worker](../editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts) owns live
  trees and injection layers. Browser UI cannot safely receive a WASM node object from that worker.
- [The backend](../editor/packages/tree-sitter/src/treeSitter/workerClient.ts) exposes parsing, range
  queries, and structural selection; inspection requests would be a new, explicitly scoped contract.
- [Worker messages](../editor/packages/tree-sitter/src/treeSitter/types.ts) already identify document,
  runtime session, and snapshot version. Reuse those stale-result and disposal boundaries.
- [Structural selection](../editor/packages/tree-sitter/src/structuralSelection.ts) demonstrates
  selection requests tied to a snapshot. It does not expose a lazy tree browser.
- [The example app](../editor/examples/app/src/app.ts) is the initial host for the reusable inspector.

The original TODO calls this mostly UI, but bounded worker inspection and revision-safe node
identity are prerequisites. Verify available parser traversal and index units at implementation time.

## Scope

Deliver bounded node inspection plus a standalone example panel. Show kind, named/anonymous,
error/missing flags, language, range, and children. Support cursor-to-ancestor reveal and explicit
node-to-selection actions. Query editing, grammar rebuilding, and syntax-only go-to-definition
are future features; they do not belong in this plan's acceptance criteria.

## Design

Begin with the requested Zed comparison: inspect its current `debug: open syntax tree` UX and
source, plus the Tree-sitter web playground. Record pinned source links, keyboard behavior,
selection synchronization, injection presentation, and large-tree handling. These comparisons
have not been performed by this plan; document findings before selecting the UI design.

Keep traversal in the worker. Return immutable small node descriptors and paged child results,
with explicit limits. A proposed node handle includes runtime session, tree revision, and an opaque
identity valid only for that tree. Never reuse a pointer or path as a durable identity across edits.
Ancestor lookup is a separate bounded request so following the cursor does not require a full dump.

Distinguish parser byte/point units from Editor UTF-16 offsets and label displayed units. Convert
through the actual binding's tested conventions. Decide how an injection tree relates to its host
node; show its language and source coordinate range without pretending it is an ordinary child.

On an edit, discard stale handles and resolve the cursor path against the new revision. Browsing
focus and editor selection remain separate: expand/collapse does not move the caret. Guard the
two-way selection path against echo loops and reject results after panel or editor disposal.

## Steps

1. Complete the comparison and write a short interaction contract with a large-tree example.
   Reconcile the required descriptor data with actual backend APIs and supported parser units.
2. Implement a bounded worker inspection protocol with pagination, ancestor lookup, cancellation,
   revision rejection, and disposal. Do not parse a second copy solely for the inspector.
3. Prove descriptor ranges on injected and Unicode source against the current document snapshot.
   Keep missing/error nodes inspectable even when their ranges are empty.
4. Build the example panel with a virtualized accessible tree, keyboard navigation, reveal-cursor,
   range preview, and explicit select. Preserve expansion only where identity can be revalidated.
5. Profile a large tree, rapid typing with the panel open, and repeated open/close. Document the
   public debug entry point and build/export behavior without exposing raw parser objects.

## Verification

Extend the targeted [worker tests](../editor/packages/tree-sitter/test/treeSitter-worker.test.ts) and
the real [browser worker suite](../editor/packages/tree-sitter/test/treeSitter-workerClient.browser.test.ts)
through their package scripts. Verify pagination limits, stale revisions, two editor sessions,
missing/error nodes, deep ancestry, injected languages, and close-before-response cancellation.

Use a real browser for focus, arrow-key tree navigation, cursor synchronization, and selected
range paint. Compare descriptor ranges with known Unicode/CRLF source. Acceptance requires bounded
message/list size, no extra full parse, and released tree/session references after disposal.

## Risks and decisions

Retaining inspector handles must not pin every historic tree. Choose a bounded stale-handle policy
and a visible refresh state. Extremely deep trees need traversal limits and continuation behavior.
If E016 later introduces partial trees, show coverage and unavailable ancestry explicitly rather
than treating an omitted parent as the source root.
