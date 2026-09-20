# Search and replace

Workspace text search with a replace pass across files.

## Sub-features

Query, regex and case flags, result grouping by file, open a match in the editor, replace all.

## How to get to it (user POV)

The Search side panel, or the address URL search parameters (`s.*`).

## Driving it with agent:browser

`search-input-undo` types into the query and replace fields and presses Ctrl+Z in each; the step labels carry the remaining value. No replace scenario yet. Add `search-replace-bulk`: open the search panel, type a query that hits many files, run replace, then read two changed files from disk.

`search-type-delete` types `ddd` into the sidebar search slowly enough that `d` and `dd` each stream their 20,000 rows, deletes it the same way, and samples the result tree every frame. The last step label is `changes-N-scrolled-M`; `scrolled` must be 0, because nobody picked a result and the list has no reason to leave the top.

`visual-search-performance` searches `import` across the platform repository, opens the syntax-highlighted search editor, scrolls 20 times, jumps halfway through the results, and drags the search tab into a split and back. Run `trace visual-search-performance` before and after a change with `--compare`. Each action has begin/end markers. The `scenario` run also records elapsed times, mounted editors and rows, syntax tokens, and scroll geometry in `inspection.json`.

`visual-search-headers` measures each file header's allocated height, painted ListRow height, and first excerpt gap. It selects compact and cozy density through Settings, collapses and expands the first file in each, and restores the original density setting. Per-step screenshots and `inspection.json` retain the geometry.

`visual-search-scroll-content` checks that file blocks intersecting the viewport retain mounted editors and text after wheel scrolling and jumps. It then clicks a visible excerpt, presses Enter, and verifies the opened file path.

## Gotchas

Replace runs through the workspace-edit lifecycle with a preview dialog. The dialog's confirm needs the rendered operation id; a stale dialog cannot confirm a newer operation.
