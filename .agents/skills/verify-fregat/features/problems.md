# Problems

The diagnostics panel in the bottom panel, beside Terminal.

## Sub-features

Diagnostics for every file holding one, a section per file: a path header, then one row per
diagnostic carrying its severity label and line. Clicking a row opens the diagnostic; hovering
one previews it in the editor. The tab badge shows the total across all files.

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

`scenario problems-panel-rows` opens a file, switches to Problems, types an unresolvable
identifier so the server has something to report, and waits for a row. It then opens a second
file and does the same. It fails unless at least one row appears, no counter tile is rendered,
the first row's `title` recovers its file and line, and the second file **adds** a section
rather than replacing the first.

`scenario bottom-panel-persistence` steps through the empty state on its
way between Terminal and Problems.

## What proves it works

One section per file: a path header whose muted directory follows the basename, then rows with
a severity label on the left, the line on the right, and the message below. The tab badge
matches the total across every section. Switching tabs must not drop another file's section.
With nothing reported, `No problems reported` with `A file is checked once it is opened.`

Pending is `DiagnosticsLoading` — one placeholder for the path line and one per row, mirroring
the loaded view. A skeleton that shows four tiles is stale.
