---
"@singapore-editor/core": patch
"@singapore-editor/collab": patch
"@singapore-editor/collaboration": patch
"@singapore-editor/textbuffer": patch
---

Keep collaborative undo branches in the editor history graph. Switch branches with one author-selective effect command, restore character-ID selections and jump locations, and persist history against its document and character identities. Continue allocating fresh edit and character IDs when a document reopens, and recover local history after rejected commands.
