# TUI workbench

The workbench connects the existing TUI foundation to the server's filesystem, Git, search,
logs, workspace-edit, LSP, and terminal routes. Plan 081 completed this slice on 2026-09-07.
[Agent sessions](tui-agent.md) followed in Plan 082. Worktree parity and distribution remain
subsequent work in [the strategy](tui-plan.md).

## Implementation

| Surface    | Behavior                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation | Folder workbenches, file history, pane selection, address round trips, per-folder persistence, and narrow layouts.                                                               |
| Files      | Shared tree controller, lazy directory reads, Git status decorations, filtering, creation, rename, and confirmed deletion.                                                       |
| Viewer     | Read-only text, line numbers, bundled Shiki syntax tokens, find, go-to-line, hover, definitions, and active-file diagnostics.                                                    |
| Editing    | External editor handoff with filename extension, snapshot-precondition commit, and durable conflict drafts that preserve the original precondition.                              |
| Git        | Whole-file diff projections, split or stacked rows, expandable context, stage, unstage, discard, streamed commit progress, generated messages, remote operations, and draft PRs. |
| Search     | Streamed results, include and exclude globs, regex and case controls, and previewed atomic replacement.                                                                          |
| Logs       | Structured event history, histogram, filters, live tail, pause, and JSON details.                                                                                                |
| Terminal   | Embedded byte rendering, multiple shells, native input and mouse handling, resize, clipboard actions, raw attach, and clean detach.                                              |

Shared code lives in `packages/client-core`: whole-file diff conversion, workspace search,
typed SSE parsing, and workspace-edit commit handling. Web callers use the same implementations.
The TUI imports the tree model through `@workspace/tree/model` without importing DOM components.
All service sockets are host-injected, including the in-process test sockets.

Focus registration survives temporary availability changes. Native widgets that appear after
an asynchronous load acknowledge focus after their commit. An open dialog owns input until it
closes; background focus requests stay deferred without exposing a target to terminal input.
Commands stay registered while their pane is visible, including when the palette captures the
originating pane. History persistence observes every navigation change, including Back and Forward.

## Feasibility

- [Terminal feasibility](tui-research/terminal-feasibility.md) covers byte rendering, input,
  multiple viewers, real Neovim, raw attach, host resize, and terminal restoration.
- [Viewer feasibility](tui-research/viewer-feasibility.md) records the published tree-sitter
  worker failure and the bundled Shiki path that passes Bun and standalone compilation.

The server tracks negotiated in-band resize mode 2048. It reports dimensions through that
protocol when enabled, in addition to the PTY resize. A joining viewer gets replay followed by
a repaint request; already attached viewers do not receive a duplicate replay.

## Verification

Tests drive the actual Elysia routes and native OpenTUI renderer. PTY and LSP substitutes are
limited to process boundaries. Native terminal checks also run the actual interactive app and
Neovim inside a host PTY, without opening a second listening server.

The checks cover wide and narrow file navigation, pane focus, keyboard overrides, stale edit
rejection, LSP responses, Git mutations, search cancellation and replacement, JSONL tailing,
diff layout boundaries, terminal fan-out, raw attach, resize, and mode restoration.

The workbench review added these permanent regressions:

| Behavior                                                                                                                | Regression                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested project saves target the selected file, including when a duplicate matches its snapshot.                         | [Viewer edits](../apps/tui/src/viewer/tests/edit.test.ts)                                                                                      |
| Rolled-back writes retain drafts; interrupted successful saves recover without confusing a later rollback with success. | [Workspace writes](../apps/tui/src/viewer/tests/workspace-write.test.ts)                                                                       |
| Palette typing and Enter never reach the PTY during resize.                                                             | [Terminal overlays](../apps/tui/src/terminal/tests/overlay.test.tsx)                                                                           |
| Long lines expose keyboard and search targets, including wide characters and layout changes.                            | [Long lines](../apps/tui/src/viewer/tests/long-line.test.tsx), [Horizontal scrolling](../apps/tui/src/viewer/tests/horizontal-scroll.test.tsx) |
| Nested-root replacement and optional, named, and numeric captures produce the intended text.                            | [Search replacement](../apps/tui/src/search/tests/replacement.test.ts)                                                                         |
| Delayed diffs cannot restore discarded changes; failed mutations restore the selected diff.                             | [Git state](../apps/tui/src/git/tests/workbench.test.ts), [Git pane](../apps/tui/src/git/tests/pane.test.tsx)                                  |
| File-tree focus follows the command at wide widths, and pane dialogs retain focus.                                      | [Pane navigation](../apps/tui/src/workbench/tests/pane-navigation.test.tsx)                                                                    |
| Back and Forward persist the displayed file and restore it in a fresh session.                                          | [History persistence](../apps/tui/src/workbench/tests/history-persistence.test.tsx)                                                            |

Run TUI checks with `bun --bun vitest run` in `apps/tui`. The TUI build also checks types and the
generated palette. Shared extraction checks include client-core and affected web callers.
After the review fixes, the full TUI suite passes 234 tests across 66 files. The TUI build, lint,
and client-core typecheck pass. The original shared-code extraction also passed web and server
typechecks, nine DOM diff-view tests, and ten shared-model/SSE tests.
The working decision trail is `/work/tmp/platform-tui-workbench/decisions.tsv`.

The existing preview service on port 3301 was started with an older origin allowlist and rejects
`platform-tui://local`. Its normal launcher must be restarted with that origin before attaching.
The complete interactive app is verified against the real server fixtures. No additional dev
server is started. Native host verification is on Linux; testing in a physical terminal running Kitty remains unverified.
