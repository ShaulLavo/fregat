---
'@singapore-editor/collab': patch
'@singapore-editor/textbuffer': patch
---

Add a persistent textbuffer-backed FugueMax engine with compact identity-run placement, exact remote edits and snapshot replay. Reuse the textbuffer character allocator for optimistic participants. Expose semantic character identity diagnostics for simulator convergence checks.

Retain compact insertion/deletion provenance and deduplicated operation states for atomic undo and redo, including hidden overlapping deletions and same-ID revival.
