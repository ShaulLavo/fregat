# Boot and first load

What must be on screen at first frame, how first-load JavaScript is gated, and how a page open across
a deploy keeps loading its lazy chunks. Written by Plan 109 (retired 2026-09-25; its measurements are
in git history).

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

## The first-load gate

`bun run --cwd apps/web bundle:gate` (`apps/web/scripts/bundle-gate.ts`) builds through
`bundle-report.ts` and compares first-load script gzip ([disk]) in total and per owner against
`apps/web/scripts/first-load-pins.json`. The total may grow 1%. Each owner may grow by the larger of
5% or 2 KB; an owner new to first load counts from zero. The failure names every owner that grew.
`--write --reason=…` re-pins and appends the reason to the file's history. It runs in `verify` and
in CI's typecheck job. First pin: 1,607,295 B gz, after Plan 129 Q2 and the evlog dedupe.

Verified: a static import of `features/settings/components/page` in `main.tsx` fails the gate with
`grew: apps/web/src/features/settings 12379 -> 57583` and `packages/contracts 32403 -> 37700`
(total 1,676,329 against a limit of 1,623,368); restoring the file restores the pinned build. The
gate has no `--dir`, so it never reads a stale `bundle-stats.json`.

## Assets across deploys

`carryAssets` in `scripts/deploy/release.ts` hardlinks into each new release the served release's
hashed assets it lacks, up to a week old, so a page loaded before a deploy keeps resolving its lazy
chunks. A hash names one content, so a carried file never shadows a new one.

## September 26 dialog split

The pin was last set at `ef0d170a0`. Rebuilding that commit with the current linked Editor
`0f87310155df0720968e7bf8739d65cb18cd6249` gives 1,751,113 B gzip; its historical pin was
1,743,278 B. Main at `9aaaeee87`, with the same linked Editor, gives 1,761,157 B. The dialog
split gives **1,722,852 B**, removing 38,305 B and ending 20,426 B below the historical pin.
The new total limit is 1,740,081 B; the 1% total and 5%/2 KB owner margins are unchanged.

Between the two rebuilt commits, chat adds 31,620 rendered bytes from goals, schedules and MCP
approval, the picker adds 12,247 from places and drives, and contracts add 6,790. Client-core
removes 25,514 rendered bytes when editor commands move to the Editor catalog. The historical
Editor pin also predates the currently linked build. These are separate from this change's
removal of picker and palette content from first load.

Owner gzip estimates divide each chunk's gzip by rendered module share. Splitting chunks can
increase an owner's estimate while reducing its rendered bytes. The pin history records a line
for every owner whose estimate rises above the historical pin, including those redistributions.
The picker falls from 24,536 to 81 B and the palette from 17,277 to 1,781 B attributed gzip.
Shared component code falls from 28,888 to 21,588 B.

## October 6 accepted measured reference

Root preference 33 accepts the independently reviewed PR851 source
`10d087ec19f5d3abe0d733a665f26f4cda3f9123` as the measured reference. The phone JavaScript baseline
changes from 1449825 to 1470125 B gzip, with phone home 1203579 B and phone CSS 38667 B counted separately.
The Editor baseline changes from 99601 to 105972 B, a canonical rounded approximate shared-chunk
share. The reference retains admitted filesystem, settings, preview and attachment source meaning,
held immutable byte and reader references, capture, admission, release and current write authority,
including the useful PR851 optional-presentation split. Raw receipts are in
`track200/pr808-placement-implementation/candidate`; independent proof and comment6009794865 are
in `track200/pr808-placement-review`. Original phone and Editor gate failures remain preserved.
Current assembly `81eb3c2b548cce327cd0729b657bda0ba8a47697` has changed verification inputs scanned by
Tailwind, so its bytes remain unmeasured here and byte equivalence is not claimed. Exact-head full
CI checks the current assembly against this reference with the existing 1% total and 5%/2 KiB owner
margins. Reading, desktop 1772746 and every other owner baseline remain unchanged. Performance,
functional, timeout and hardware qualification remain separate.
