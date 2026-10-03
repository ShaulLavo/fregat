# Editor split views verification — 2026-09-19

Follow-up: [review fixes and no-op drop verification](2026-09-19-editor-splits-review-fixes.md).

The editor now supports nested groups with independent tab bars. Drag a tab to any content edge to split, to the center to move, or to a tab strip to insert. Ctrl on Linux/Windows and Option on macOS copies a document view. Tab menus provide Split Right, Split Down, and Move to Group. Settings and Search move as singleton tools.

Groups resize and restore on reload. Copies share file text and undo while retaining independent selection, scroll, folds, and comparison/history presentation. Closing one dirty copy keeps the document open; closing its last view offers Save, Discard, and Cancel.

## Browser evidence

Each scenario ran against the existing dev server. Screenshots were read after each successful run. Paths below contain the summary, screenshots, inspection output, observed browser problems, and operation-window logs.

| Scenario               | What it proves                                                                                                                                        | Evidence directory under `/work/tmp/fregat-evidence/` |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `editor-split-drag`    | Edge previews, live copy modifier, shared editing/undo, nested splits, resize/reload, cancellation, duplicate merge                                   | `20260919T192745Z-scenario-editor-split-drag`         |
| `editor-split-actions` | Keyboard reorder, left-edge move, menu split sizing, move chooser, numbered focus, independent raw scroll restore, tab-strip insertion preserving IDs | `20260919T194219Z-scenario-editor-split-actions`      |
| `editor-split-state`   | Find and Save in the focused pane, real saved disk contents, dirty-copy close and final-view prompt                                                   | `20260919T193349Z-scenario-editor-split-state`        |
| `editor-split-content` | Singleton moves, read-only HEAD copies, empty/populated saved comparisons, current/selected history copies and destination focus                      | `20260919T193253Z-scenario-editor-split-content`      |
| `editor-split-folds`   | Copied folds, independent unfolding, stable view IDs and fold state through actual editor remounts                                                    | `20260919T193610Z-scenario-editor-split-folds`        |
| `editor-split-blur`    | Pointer and keyboard cancellation on window blur, pointer release in a different document, immediate successful next drag                             | `20260919T194306Z-scenario-editor-split-blur`         |

The final integration runs reproduced and fixed URL bootstrap duplicating tabs in restored groups, capped reopen scroll overwriting per-view scroll, and dnd-kit retaining a sensor after blur. The content scenario also caught a missing read-only guard for HEAD references. Disposable content fixtures and verification-owned terminal sessions were cleaned up.

The browser reported existing orchestration/WebSocket startup warnings, unavailable adapters, GPU screenshot warnings, and missing theme endpoint responses. A reload drive recorded a workspace event stream disconnect. These did not fail the split assertions. No performance claim is made.

## Focused checks

Passed focused group placement/layout, drag geometry, tab menu/strip, command registry, navigation ownership and identity, workspace cache, document lifecycle, diff/history presentation, and affected fixture tests. The final cache/navigation regression run passed 21 tests; the final drag/menu/command run passed 66 tests. These counts overlap earlier runs and are not a combined total.

Web, client-core, TUI, and scripts typechecks passed. Changed-file lint and formatting checks, the design census, linked-source validation, and `git diff --check` passed.

Fold lifetime support also changes the linked `/work/projects/Editor/packages/editor` source. Its five new lifecycle tests and 49 existing fold tests passed, followed by typecheck, lint, formatting, and build. The platform build resolves that linked package; both checkouts are part of this implementation.

## Deployment

Release `20260919T194711Z-e4ee5f1d-editor-splits` is served at [the mesh deployment](https://omarchy.mesh.shaulavo.dev/platform/). `bun run deploy --slug=editor-splits --reason='Add editor split views'` passed candidate verification and the live browser check. `/platform/release` confirmed the release. The server bundle was reused without restarting the service.

The production `editor-split-folds` scenario passed all six phases, including copy, nested split, duplicate collapse, and drag to the top edge. Both independent fold states survived. Screenshots were inspected, the fixture stayed unchanged and was removed, and the operation window had no warn-level logs. Evidence: `/work/tmp/fregat-evidence/20260919T194731Z-scenario-editor-split-folds/`. The deployment check is `/work/platform-production/releases/20260919T194711Z-e4ee5f1d-editor-splits/live-check.json`.
