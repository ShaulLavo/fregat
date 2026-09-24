# Problems

The diagnostics panel in the bottom panel, beside Terminal.

## Sub-features

Diagnostics for every file holding one, as one tree: a file row (caret, icon, basename, muted
directory, count), then one row per diagnostic carrying its severity label and line, with the
complete message beneath. The whole pane is one Tab stop; the arrows walk from one file into the
next, Left/Right collapse and expand a file, Enter on a file toggles it and Enter on a diagnostic
opens it. Moving the cursor previews the diagnostic in the editor without taking focus from the
tree. When a refresh removes the active row, the row now in its place becomes active. The tab
badge shows the total across all files.

Markers live in `lib/markers/store.ts`, keyed by **(owner, resource)** the way VS Code's
`MarkerService` is. A publish replaces only that owner's markers for that file, so several
checkers coexist, and a server that stops retires its own markers and nobody else's. Sections
lead with the worst severity, then sort by path.

It is **not** workspace-wide: a language server publishes for documents it has open, so a file
appears once it has been opened. A checker that scans the whole tree (`tsc --watch`, lint) is
what would make it workspace-wide, and it would join as another owner without the panel
changing.

There are no severity counter tiles — the row carries its own severity and the badge carries
the total.

## How to get to it (user POV)

The Problems tab in the bottom panel, or `?bottom=problems` in the address.

## How to drive it

`scenario problems-panel-rows` makes a disposable workspace with two TypeScript files that fail
type checking as written, opens both, and switches to Problems. It fails unless there is exactly
one tree with no row Tab stops, no counter tile, a diagnostic row whose `title` recovers file and
line, and ArrowDown crosses from the first file into the second with focus still on the tree;
Left on the first file collapses it. It never types into the checkout.

`scenario bottom-panel-persistence` steps through the empty state on its
way between Terminal and Problems.

## What proves it works

One file row per file, basename before the muted directory, then rows with a severity label on
the left, the line on the right, and the message below. The tree fills the bottom panel's width. The tab badge
matches the total across every section. Switching tabs must not drop another file's section.
With nothing reported, `No problems reported` with `A file is checked once it is opened.`

Pending is `DiagnosticsLoading` — one placeholder for the path line and one per row, mirroring
the loaded view. A skeleton that shows four tiles is stale.
