# Editor

Text editing of workspace files with tabs, dirty state, save, undo, and language-server features.

## Sub-features

Open, edit, save (`Control+s`), auto-save modes, undo/redo, multiple tabs, dirty-close dialog, conflict toast when the file changes on disk, cursor breadcrumbs, minimap.

## How to get to it (user POV)

Open the command palette (`Control+Shift+P`), type a file name, press Enter. Or click a file in the tree.

## Driving it with agent:browser

`scenario editor-type-burst`, `scenario editor-large-paste`, `scenario editor-fast-scroll`, `scenario editor-caret-burst`. These open `--file` (default `use-events.ts`) through the palette. For a save, press `Control+s` in a scenario and check the file on disk plus `bun run logs --action fs.write`.

`scenario editor-find` opens the find widget with `Control+f`, types a dense query, a sparse one and one that matches nothing, and steps through matches. It fails unless the count reads `N of M` with no floor marker and the position moves; the count is exact past the 19,999-highlight cap.

`trace editor-fast-scroll --file keys.ts` waits for startup before the `ready` marker, then runs repeated 1,200px sweeps and alternating 6,000px jumps through the settings registry. Compare scrolling after `ready` separately from file opening. The editor holds its complete previous paint until the next scroll paint is ready; its browser regression checks this with zero overscan, including horizontal jumps.

Split views: `scenario editor-split-drag` checks edge previews, modifier changes, shared editing/undo, nested layouts, resize/reload, cancellation and duplicate collapse. `scenario editor-split-actions` checks keyboard reorder, moves, tab-strip insertion, menu size limits, numbered focus and independent scroll restore. `scenario editor-split-state` uses a disposable committed workspace to check Find and Save in the focused pane, closing one dirty copy, and the final-view save prompt. Split scenarios isolate their terminal sessions and clean them up.

`scenario editor-split-content` creates and removes its own committed scratch workspace. It moves Settings and Search between groups, checks their split commands stay disabled, and copies HEAD references, history, and saved comparisons in empty and populated states. It checks read-only editing and focus in the destination group without writing repository files.

`scenario editor-split-folds` copies a collapsed structural fold, unfolds one occurrence, then nests, collapses, and moves groups. It checks both fold states and stable tab IDs across actual editor remounts in a committed scratch workspace, without changing repository files.

`scenario editor-split-blur` transfers focus to another document during a drag while the page stays visible. It releases the pointer there, verifies the next drag still splits, and checks that window blur also cancels keyboard dragging.

`scenario editor-split-targets` checks that unchanged center, strip, and equivalent edge drops show no destination. It also checks insertion after tab-strip auto-scroll and clipped tabs overlapping a neighboring pane's strip.

`scenario editor-split-order` keeps different tab orders in two groups while opening another file and reloading. `scenario editor-split-breadcrumbs` checks that each pane retains its own cursor scope for the same file and for different files.

`scenario editor-split-history-state` creates a workspace edit through Search Replace All, selects its history barrier, and moves that history tab into a group already displaying another history tab. The barrier selection must survive without collapsing the source group.

`scenario editor-diagnostics-lifecycle` repeatedly opens/closes a file, opts into URL tracing, exceeds the diagnostic retention bound, stops collection, and reloads without tracing. `trace --no-console` omits console listeners as a capture-overhead control; `observed.json` records upload requests, bytes, event counts and client IDs.

## Gotchas

`scenario editor-external-edit` creates a disposable workspace with a folder linked outside the project. It removes a line on disk, atomically replaces the open file, retargets the symlink, replaces its target directory, and verifies that subsequent edits still arrive. An external write while another tab opens and closes must preserve unsaved text and offer a conflict. The project filesystem subscription count must stay unchanged across both tab operations. Fixture files are cleaned up afterward; screenshots and `inspection.json` retain the evidence.

`trace editor-theme-preview --file syntax-highlighting.ts` previews three code themes twice and cancels. Compare traces for worker session restarts and inspect the scenario's screenshots for the editor behind the picker. It restores the committed theme without writing settings.

`trace editor-syntax-native --file large.ts --workspace work/tmp/fregat-evidence/syntax-benchmark-fixtures` and `trace editor-syntax-shiki` run the same opening, 20 single-character edits, and scrolling with Native Dark or GitHub Dark. Pass the native evidence directory to Shiki's `--compare`. Use disposable TypeScript copies in that workspace; the scenarios disable auto-save in the browser context and never save. `inspection.json` includes worker round trips, Tree-sitter's internal timings, first text/highlight paint marks, and phase boundaries. Compare the first edit separately from later edits because Shiki loads grammars in the background. Repeat with `scenario` to check timings without Chrome's CPU profiler. Both paths must actually paint multiple syntax colors, and Shiki must retain a Tree-sitter worker.

`scenario editor-syntax-shiki-settled` adds two seconds before editing to separate background startup work from the first edit. Syntax scenarios isolate and clean up their terminal sessions.

Click `.editor-virtualized-viewport`, not the hidden textarea; the viewport intercepts pointer events. The typing scenario leaves the buffer dirty; it undoes but does not save. A conflict toast appears if another process writes the open file during the run.

`renders editor-caret-burst` isolates 300 arrow-key moves without changing text. Compare the `ready` and `moved` snapshots in `render-steps.json`; setup renders are not caret-driven renders. Use `renders editor-type-burst` separately for document-change subscriptions. Each step snapshot is cumulative.

`renders editor-focus-clicks` clicks within the already-focused editor, then compares dragging and actual terminal/editor focus transitions. Compare ready to clicked for repeated-click claims; terminal-focused and editor-refocused are controls, not part of that count. Production names are minified; confirm the component in the served bundle before attributing its counts.

The click scenario waits 750ms between clicks so debounced document highlights, code actions and hover requests can finish. Faster clicks cancel those requests and can hide subscription bugs. Inspect `BottomPanel` (the Terminal/Problems container) separately from `TerminalPanel` and `TerminalTabs`; React Scan can outline the whole container when only that parent renders.

`scenario editor-row-height-audit` opens `--file`, then forces `--editor-row-height: 0px` on the editor and opens `README.md`. Every initial text paint logs `editor.layout.rows_audited` (debug) with the row pitch, painted height, line-height and the CSS vars on the editor and the root; a disagreement logs `editor.layout.row_height_mismatch` (warn) with the same fields. The client batches logs about once a minute, so the run's `logs.txt` is usually empty: read `bun run logs --action editor.layout.row_height_mismatch` a minute after the run. A rows-stacked or text-clipped editor without that warn is a gap in the audit itself.

`scenario editor-lsp-hover --file main.tsx` inserts a `const`, hovers its name, checks the language server tooltip names it, then inserts a name with a Cyrillic letter and checks that its diagnostic and its character warning share one tooltip. Undoes both edits.

`scenario editor-lsp-signature-help` types `console.log(`, checks the signature surface names the call, then types `)` and checks it goes away. Both characters are read as keystrokes, not as edits: auto-close writes a typed `(` as `()`, and typing over the closer it inserted changes no text at all, so neither is visible in the document change. The surface and its Markdown renderer load on that first `(`, so this also covers the lazy chunk. Undoes the edit.

`scenario editor-lsp-completion --file main.tsx` reaches `console.l` by typing straight through, pausing after `c`, and accepting `console` with Enter, each at three key delays, and checks the list offers `log` and no globals. Also worth running with an `.astro` or `.mjs` file.

`scenario editor-format-chord --file arguments.ts` appends a badly spaced line, presses Alt+Shift+F and then Mod+Shift+F, and checks each one reformats it. Pick a short file: the line has to be on screen. Undoes both.

`scenario editor-undo-barrier --file a.ts --workspace work/tmp/plan121-undo` types a note, renames `renameMe` across `a.ts` and `b.ts` through F2 and the preview dialog, presses Ctrl+Z past the note into the workspace-edit barrier, checks the "Undo stopped at a workspace edit" toast, then opens the History tab, picks the barrier state and undoes the rename from the pane's own "Undo workspace edit" action; it waits for the barrier to leave the graph before switching tabs, because the file's path stays reserved until the undo finalizes. The workspace must hold those two files; create them if the folder is gone.

`scenario editor-undo-branch --file a.ts --workspace work/tmp/plan121-undo` types A, undoes, types B, undoes, types C and CC, opens the file's History tab through the palette, checks five retained states, previews B against the current text, compares B with C by shift-clicking, restores B and checks the pane returns to the current state. `Show history` is also in the palette for any file tab; the tab's address is `h/<path>`.

`scenario editor-undo-reopen` builds a disposable workspace, types and saves, closes the tab, reopens the file and undoes back to the text from before the save, then redoes, reloads the window and undoes again. Both undos can only come from the history stored in IndexedDB (`platform-editor-history`), so a failure means persistence or the content-hash match broke. Typing lands as several states, so the scenario repeats the chord until the row matches.

`scenario editor-markdown-punctuation --file README.md` hovers en dashes and invisible characters in the editor and a saved-file diff, checks their explanations, opens Unicode settings, and undoes its sample.

Native grammar coverage: `editor-native-coverage-light` and `editor-native-coverage-dark` open an MDX, SQL or Astro file or a Markdown fence fixture, check native worker use, edit syntax, undo and redo. Use `--workspace work/tmp/fregat-evidence/syntax-benchmark-fixtures --file Component.astro`, `--file Component.mdx`, `--file mdx-injections.md`, `--file queries.sql`, `--file sql-injections.md` or `--file injections.md`. Fenced MDX must retain its heading and emphasis markers in Markdown preview; injected code is displayed as source. `editor-syntax-native` retains the whitespace control for timing comparisons.

Editor title actions are the active tab's controls at the end of its tab strip, declared in `apps/web/src/keymap/editor-title-actions.ts` as a command plus a `when` over the tab. `editor-title-diff-toggle` opens a diff tab, switches stacked/split from the title and switches back, because the toggle writes the real `editor.diff.viewMode` setting. `git-commit-message-file` covers the accept and discard pair.
