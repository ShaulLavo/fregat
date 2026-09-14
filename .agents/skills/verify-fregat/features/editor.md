# Editor

Text editing of workspace files with tabs, dirty state, save, undo, and language-server features.

## Sub-features

Open, edit, save (`Control+s`), auto-save modes, undo/redo, multiple tabs, dirty-close dialog, conflict toast when the file changes on disk, cursor breadcrumbs, minimap.

## How to get to it (user POV)

Open the command palette (`Control+Shift+P`), type a file name, press Enter. Or click a file in the tree.

## Driving it with agent:browser

`scenario editor-type-burst`, `scenario editor-large-paste`, `scenario editor-fast-scroll`, `scenario editor-caret-burst`. These open `--file` (default `use-events.ts`) through the palette. For a save, press `Control+s` in a scenario and check the file on disk plus `bun run logs --action fs.write`.

## Gotchas

Click `.editor-virtualized-viewport`, not the hidden textarea; the viewport intercepts pointer events. The typing scenario leaves the buffer dirty; it undoes but does not save. A conflict toast appears if another process writes the open file during the run.

`renders editor-caret-burst` isolates 300 arrow-key moves without changing text. Compare the `ready` and `moved` snapshots in `render-steps.json`; setup renders are not caret-driven renders. Use `renders editor-type-burst` separately for document-change subscriptions. Each step snapshot is cumulative.

`renders editor-focus-clicks` clicks within the already-focused editor, then compares dragging and actual terminal/editor focus transitions. Compare ready to clicked for repeated-click claims; terminal-focused and editor-refocused are controls, not part of that count. Production names are minified; confirm the component in the served bundle before attributing its counts.

The click scenario waits 750ms between clicks so debounced document highlights, code actions and hover requests can finish. Faster clicks cancel those requests and can hide subscription bugs. Inspect `BottomPanel` (the Terminal/Problems container) separately from `TerminalPanel` and `TerminalTabs`; React Scan can outline the whole container when only that parent renders.
