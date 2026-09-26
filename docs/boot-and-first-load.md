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
| `features/command-palette`                                   | first interaction | Opens from a chord; must answer the first keystroke.                              |
| `features/file-picker`                                       | first interaction | Opens from a chord or a dialog.                                                   |
| `features/terminal`                                          | on demand         | Behind its boundary since Phase 3 (idle prefetch).                                |
| `features/settings`                                          | on demand         | Behind its boundary since Phase 3 (idle prefetch).                                |
| `features/logs`                                              | on demand         | A tool pane opened on purpose.                                                    |
| `features/dev`                                               | on demand         | The `/dev` gallery, a separate entry.                                             |

Contested: `features/chat` and `features/chat-mode` split by the saved mode. Deferring them in
workbench mode is a product call, because a first chord into chat would then wait on a chunk.
"First interaction" rows are candidates only with a prefetch on a signal, never on click (D4).

## Loading boundaries

A boundary is a dynamic `import()` at a point where a feature is absent from the first frame, with
no static import of the same module left (Rolldown reports `[INEFFECTIVE_DYNAMIC_IMPORT]`
otherwise). It is `use()` over a cached import (`lib/retryable-import.ts`), so Retry in the
surrounding `RenderErrorBoundary` asks the network again. It prefetches on idle or on a real
signal, never on click, and a pending boundary renders a real loader. Terminal and settings are
the two boundaries today.

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
