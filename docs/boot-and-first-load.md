# Boot and first load

What must be on screen at first frame, how first-load JavaScript is measured, and how a page open across
a deploy keeps loading its lazy chunks. Written by Plan 109 (retired 2026-09-25; its measurements are
in git history).

## Initial appearance

[HTML bootstrap](html-bootstrap.md) supplies current appearance and native image preloads in the
first document. Its named producer/renderer/reader contract replaces appearance storage reads;
normal settings projections own changes after startup.

## What boot is

**Boot is the first usable frame of the last layout the user left.** On screen: the titlebar, the
activity rail, the sidebar pane that was open, the editor group with the active tab's text painted
from the restored snapshot, and chat mode's session rail when chat mode is the saved mode. Panes
the user left closed are empty shells. Everything else may arrive after that frame, as long as it
is prefetched on idle or on a real signal (D4) and has a loader and an error boundary (D5, D7).

| Owner                                                        | Class             | Why                                                                               |
| ------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------- |
| `features/workbench`                                         | boot              | The layout itself.                                                                |
| `features/editor`                                            | boot              | The active tab paints at first frame.                                             |
| `features/workspace`                                         | boot              | The file tree is the default sidebar pane.                                        |
| `features/chat-mode`                                         | boot (contested)  | Boot only when chat mode is the saved mode; a mode switch could load it.          |
| `features/chat`                                              | boot (contested)  | The session rail is boot in chat mode; the timeline and composer could follow it. |
| `features/environments`                                      | boot              | The connection gate decides whether anything renders.                             |
| `features/address`                                           | boot              | The URL is the layout's address.                                                  |
| `features/server-update`                                     | boot              | A titlebar item, tiny.                                                            |
| `lib`, `state`, `keymap`, `components`, `hooks`, `providers` | boot              | Shared layers the frame is built from.                                            |
| `features/git`                                               | first interaction | A sidebar pane; boot only when it was the open pane.                              |
| `features/search`                                            | first interaction | Opens from a chord or the rail.                                                   |
| `features/command-palette`                                   | first interaction | Input opens immediately; content and previews load through a module query.        |
| `features/file-picker`                                       | first interaction | Dialog loads on demand, prefetched on idle.                                       |
| `features/terminal`                                          | on demand         | Behind its boundary since Phase 3 (idle prefetch).                                |
| `features/settings`                                          | on demand         | Behind its boundary since Phase 3 (idle prefetch).                                |
| `features/logs`                                              | on demand         | A tool pane opened on purpose.                                                    |
| `features/dev`                                               | on demand         | The `/dev` gallery, a separate entry.                                             |

Contested: `features/chat` and `features/chat-mode` split by the saved mode. Deferring them in
workbench mode is a product call, because a first chord into chat would then wait on a chunk.
"First interaction" rows are candidates only with a prefetch on a signal, never on click (D4).

## Loading boundaries

A boundary is a dynamic `import()` at a point where a feature is absent from the first frame, with
no static import of the same module left. Terminal, settings, the file picker and command palette
content use shared module query options on the resource query client. The query owns pending,
error, retry and the loaded module; idle prefetch uses those same options. Closed dialogs keep
their queries disabled. Their loading views remain dismissible, and the palette's controlled input
retains typing while its content loads. Failed imports show Retry and Reload; a browser that
retains a failed module URL may require Reload.

`agent:browser scenario deferred-dialogs` delays both dialog modules and checks typing across
palette load and closing/reopening the pending picker.

## Bundle size

Bundle size is not gated; deal with it when it's a real problem (owner, 2026-10-09).
CI, commit hooks and `verify` impose no first-load byte limits or per-owner budgets.
The former gate, pins and build-based report were removed. Vite's production build
log still reports output sizes. Investigate download size alongside measured startup
behavior when users encounter a problem.

## Assets across deploys

`carryAssets` in `scripts/deploy/release.ts` hardlinks into each new release the served release's
hashed assets it lacks, up to a week old, so a page loaded before a deploy keeps resolving its lazy
chunks. A hash names one content, so a carried file never shadows a new one.

## Historical measurements

The September 26 dialog split reduced first-load JavaScript from 1,761,157 to
1,722,852 gzip bytes in builds using the same linked Editor revision. Picker and
palette content moved out of first load. Per-owner gzip estimates divided each
chunk's gzip by rendered module share, so splitting a chunk could change attributed
size without changing that owner's rendered bytes.

The October 6 reviewed PR851 source `10d087ec19f5d3abe0d733a665f26f4cda3f9123`
measured phone JavaScript at 1,470,125 gzip bytes. Phone home was 1,203,579 bytes
and phone CSS was 38,667 bytes, counted separately. Its receipts are in
`track200/pr808-placement-implementation/candidate`; independent proof is in
`track200/pr808-placement-review`. These historical byte counts describe download
size. They do not establish runtime performance or current build size.
