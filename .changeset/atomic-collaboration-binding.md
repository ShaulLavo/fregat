---
'@singapore-editor/collaboration': patch
'@singapore-editor/collab': patch
'@singapore-editor/core': patch
---

Keep collaborative batches atomic, preserve native edit ordering and Unicode replacements, and defer remote reconciliation behind mutation leases. Respect skipped history and report selective Undo/Redo availability. Recover losing-branch origins before replay and retain shared immutable history records. Validate shared-buffer ownership before attachment and clean up example departures and failed setup.
