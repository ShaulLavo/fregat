# Versioned documents and the piece table

The text buffer stores pieces that refer to immutable character buffers. A persistent AVL tree orders the pieces and maintains aggregates for navigation. The document's logical text is the pieces read in order.

## What an edit copies

An edit creates the tree nodes along the changed path and reuses unchanged subtrees. Inserted text enters buffer storage, and new pieces refer to it. A previous version keeps its own tree root and remains readable. Editing an older version can produce a separate branch.

This is copy-on-write structural sharing. It avoids copying all document text for every version. It still has costs: changed paths, inserted text, retained versions and bookkeeping all consume memory.

## Reads and snapshots

A snapshot identifies the version a reader sees. Rows and offsets are meaningful within that version. Derived syntax or decoration work must either use the matching version or project its result through the edits that followed it.

The buffer retains immutable source storage while versions or anchors need it. Releasing document and snapshot owners allows retention and reclamation logic to remove data they no longer need.

## Related editor designs

Monaco uses a mutable red-black piece tree. CodeMirror 6 uses an immutable tree of text lines with structural sharing. Zed uses a copy-on-write B+ tree rope built on SumTree. Those data structures solve related storage problems with different public contracts and tradeoffs.

The data structure alone does not prove editor-level speed or memory superiority. Measure open, edit, navigation and retention against the workload your application serves.

Read the [piece-table design](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/storage/piece-table.md) and the generated `textbuffer` reference for the storage API.
