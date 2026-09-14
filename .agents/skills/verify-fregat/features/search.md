# Search and replace

Workspace text search with a replace pass across files.

## Sub-features

Query, regex and case flags, result grouping by file, open a match in the editor, replace all.

## How to get to it (user POV)

The Search side panel, or the address URL search parameters (`s.*`).

## Driving it with agent:browser

No scenario yet. Add `search-replace-bulk`: open the search panel, type a query that hits many files, run replace, then read two changed files from disk.

## Gotchas

Replace runs through the workspace-edit lifecycle with a preview dialog. The dialog's confirm needs the rendered operation id; a stale dialog cannot confirm a newer operation.
