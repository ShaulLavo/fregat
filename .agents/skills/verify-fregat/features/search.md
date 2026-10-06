# Search and replace

Workspace text search with a replace pass across files.

## Sub-features

Query, regex and case flags, result grouping by file, open a match in the editor, replace all.

## How to get to it (user POV)

The Search side panel, or the address URL search parameters (`s.*`).

## Driving it with agent:browser

`search-input-undo` types into the query and replace fields and presses Ctrl+Z in each; the step labels carry the remaining value.

`search-replace-refresh` opens a dirty buffer beside two disk matches, pauses actual replacement finalization until the dirty-buffer overlay refreshes, and checks the completed replacement summary. It then drives Workspace Edit Undo and Redo through the command palette, checking restored matches and actual disk contents. Its disposable fixture keeps dirty-buffer text separate from saved files.

`search-type-delete` types `ddd` into the sidebar search slowly enough that `d` and `dd` each stream their 20,000 rows, deletes it the same way, and samples the result tree every frame. The last step label is `changes-N-scrolled-M`; `scrolled` must be 0, because nobody picked a result and the list has no reason to leave the top.

`visual-search-performance` searches `import` across the platform repository, opens the syntax-highlighted search editor, scrolls 20 times, jumps halfway through the results, and drags the search tab into a split and back. Run `trace visual-search-performance` before and after a change with `--compare`. Each action has begin/end markers. The `scenario` run also records elapsed times, mounted editors and rows, syntax tokens, and scroll geometry in `inspection.json`.

`visual-search-narrow`, `visual-search-broad` and `visual-search-pathological` are the search view's performance probe, one tier per trace so each fits Chrome's buffer. Each opens the search editor, retypes its tier's query (`createError`, `useState`, and `a` limited to `apps/server/src/fs/tests/**`, so the dense tier stays under the backend's 20,000-match cap and every run sees the same files) into the editor's own input, then flings the view (20 × 1,200 px), wheels it slowly (40 × 120 px), jumps halfway, flings the sidebar list, and presses ArrowDown 20 times in it, with begin/end markers per phase. `inspection.json` records per phase: frames, long tasks, the worst task, editor hosts mounted, removed and live, DOM nodes added and removed, the view's scroll height, and the page's live highlight ranges. The scenarios only search and scroll (`readOnly`), so they also drive a production build served on a loopback port: `vite build --base /` into a scratch folder, `apps/server` with `NODE_ENV=production`, `WEB_ROOT`, a throwaway `PLATFORM_HOME` with providers disabled, then `trace visual-search-broad --url http://127.0.0.1:<port>/`.

`search-view-all-matches` searches `fixture` with the include filter set to `**/proxy-session.test.ts` (over 800 matches in one file), opens the search editor, scrolls to the end of the file block, and fails unless the view is tall enough for a row per match. `inspection.json` records the match count, the view's scroll height and the last source line on screen; compare that line with `rg -n fixture` on the file.

`visual-search-headers` measures each file header's allocated height, painted ListRow height, and first excerpt gap. It selects compact and cozy density through Settings, collapses and expands the first file in each, and restores the original density setting. Per-step screenshots and `inspection.json` retain the geometry.

`visual-search-scroll-content` checks that file blocks intersecting the viewport retain mounted editors and text after wheel scrolling and jumps. It then clicks a visible excerpt, presses Enter, and verifies the opened file path.

`search-result-line-pick` builds a one-file fixture whose third excerpt row is source line 4, hovers a text row, the action column and a row gap in the search editor, then picks a line from the source-line gutter and checks the opened editor's cursor line. Rows are asked of the editor (`rowAtPoint`), so a pointer beside it still resolves one.

`search-file-actions` makes a disposable nested workspace and checks the file menu Search shares with Files and Git: right-click a file heading (Open File, Copy Path, Copy Relative Path — the relative path must equal what Files copies) and a match row (adds Open Match, which opens the exact location), then Shift+F10 on the focused tree and Escape, which must leave the cursor where it was and focus on the tree. It repeats the heading menu and Shift+F10 in the search editor. The menu never toggles or opens the row it was opened on.

## Gotchas

Replace runs through the workspace-edit lifecycle with a preview dialog. The dialog's confirm needs the rendered operation id; a stale dialog cannot confirm a newer operation.

`search-result-recycle-focus` focuses an excerpt, scrolls until the same editor slot shows another file, checks that focus returns to the tree, and presses Enter to verify that the originally selected file opens.
