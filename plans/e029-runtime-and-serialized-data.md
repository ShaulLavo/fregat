# E029: Document runtime and serialized data boundaries

- Status: Proposed
- Kind: Design
- Owner: Editor
- Priority: P2
- Effort: S
- Dependencies: None
- Inspected baseline: Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`.

## Outcome

Document which representations can cross a worker or process boundary, which can be persisted,
and which rely on live Editor objects. An engineer proposing history persistence or a worker
optimization can identify the required conversion without treating every object as JSON data.

For example, `DocumentSyncPoint` contains a runtime segment identity. Copying its numeric
revision into a file does not make it a restorable synchronization checkpoint. A Tree-sitter
source descriptor may also depend on chunks the receiving worker already holds.

## Current code

[Piece-table types](../packages/textbuffer/src/pieceTableTypes.ts) describe a persistent
tree, reverse index, chunk store, anchors, and lazy buffer line indexes. These structures carry
ownership and identity rules beyond a flat record of visible document text.

[DocumentTextSnapshot](../packages/editor/src/documentTextSnapshot.ts) exposes read methods
and may retain a materialized string. Its readonly shape does not make the object serializable.
[DocumentEditChain](../packages/editor/src/editor/editChain.ts) uses branded runtime objects
for synchronization segments and logical revision scopes.

[Tree-sitter source conversion](../packages/tree-sitter/src/treeSitter/source.ts) builds source
descriptors and resolves them into a document-scoped chunk cache. It supports string chunks
and shared UTF-16 buffers. Descriptors can omit previously sent chunks through `sentChunkLengths`.
[Worker message types](../packages/tree-sitter/src/treeSitter/types.ts) carry protocol data
that is distinct from parser trees and worker-local input caches.

[LSP position conversion](../packages/lsp/src/positions.ts) turns snapshot edits into protocol
content changes. [Line-ending handling](../packages/textbuffer/src/lineEndings.ts)
records normalized text and round-trip facts that hosts need when saving.

The TODO's hot and cold vocabulary is useful shorthand. Its claim that every worker payload
is a self-contained serialized representation needs these qualifications before adoption.

## Scope

Write a concise section in [ARCHITECTURE.md](../ARCHITECTURE.md) and a linked, proposed
`docs/architecture/data-representations.md` inventory. Update vocabulary in touched design
documents only where it clarifies a real boundary. This plan makes no runtime representation change.

Cover storage, anchors, text snapshots, edit-chain synchronization, syntax messages, parser
state, visible paint snapshots, LSP messages, and proposed history records. Mark proposed
formats as proposed. Platform owns session files, persistence destinations, and workspace state.

## Design

Prefer "runtime representation" and "serialized representation" as primary terms. Define
hot and cold once as optional shorthand without confusing them with CPU cache temperature.
Use a classification table that allows more than a binary label.

Each row records the producer, consumer, coordinate units, identity scope, dependencies,
mutability, copy or transfer behavior, disposal, and persistence contract. State whether the
representation is self-contained, requires receiver state, or shares live storage.

Distinguish four questions that often get collapsed: can a value be copied, can it be cloned
to a worker, can it be encoded as bytes, and can those bytes be interpreted after restart?
A typed array can be cloned yet still require a schema, byte order, and ownership agreement.
A shared buffer crosses compatible worker boundaries without becoming a standalone file format.

Document three actual flows: host text into a normalized piece table and back to saved text,
snapshot changes into Tree-sitter source synchronization, and Editor edits into LSP changes.
Show where version and generation checks apply and which caches must exist at the receiver.

[E018](../docs/editing/e018-persisted-undo.md) shipped on 2026-09-20: `serializeHistory` and
`restoreHistory` store each node's edit script against its parent, and Platform restores it when the
content hash matches. Document that format as an existing consumer of this vocabulary.
Explain why serializing runtime tree pointers, sync segment objects, or parser handles does
not preserve their meaning across restart.

## Steps

1. Trace the producer and consumer for each current representation in the inventory. Record
   the exact existing symbol and source path, plus any environmental requirements.
2. Walk open, edit synchronization, and save with representative text. Note normalization,
   offset units, receiver caches, and which identities survive each boundary.
3. Write the terminology section and representation table. Mark each worker payload as
   self-contained, state-dependent, or shared according to its actual implementation.
4. Add small diagrams for the three conversion flows. Link the existing storage, positions,
   and syntax documents instead of repeating their algorithms.
5. Review the proposed history and shared-memory plans against the terminology. Correct
   concrete misclassifications without committing either plan to a storage redesign.
6. Validate every link and symbol. End with an inventory whose claims a reviewer can trace
   directly to source and whose proposed entries cannot be mistaken for shipped formats.

## Verification

This is documentation work. Check links, export paths, type definitions, and the actual
encoder and decoder pairs. Do not run the repository's test suite to validate prose.

Use [Tree-sitter source tests](../packages/tree-sitter/test/source-chunks.test.ts) and
[LSP positions tests](../packages/lsp/test/positions.test.ts) as existing evidence for transfer
and coordinate claims. Inspect their assertions before stating the behavior they establish.

For each conversion diagram, identify one source entry and one consumer entry. A descriptor
that omits already-sent chunks must be labeled dependent on receiver state. A sync point that
compares segment object identity must be labeled runtime-only even though it contains numbers.

Acceptance requires an explicit identity and persistence classification for every listed
representation, with no statement that readonly implies immutable storage or serializability.
If source cannot substantiate a claim, mark it unresolved and name the missing evidence.

## Risks and decisions

Terms can conceal exceptions. Keep the concrete properties in the table even after introducing
hot and cold shorthand. A value can be transportable without being suitable for durable storage.
Avoid renaming production types merely to align with the prose. The value of this plan is
accurate ownership documentation and clearer future designs, not a terminology migration.
