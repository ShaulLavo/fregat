# PR 192 local review, 2026-09-28

Reviewed `ec39f092e` against main `74bfd0d61` in
`/work/worktrees/platform/review-192`, with its own Vite on port 5219 and throwaway API homes.
The shared main checkout was used only for comparison runs on its mesh-managed dev route.

## Findings and repairs

- The prepared-input benchmark still called the deleted `TreeViewModel.cleanUp()` twice. This
  reproduced CI's failure locally. Remove those calls and unused bindings. The unchanged gate
  passes: at 50,000 paths, cached construction measured 23.623 ms versus 114.231 ms raw, a 79.3%
  reduction in this run. This verifies the existing threshold, not a before/after speed claim.
- All 64 committed parity baselines predated the shared filter field from PR 187. Fresh main and
  PR captures have **zero mismatched pixels and zero style differences in all 64 comparisons**.
  Refresh baselines from the captured main output, then rerun the PR against them. The run passes.
  `menu-open` is also identical, so no extra menu-anchor exception is needed.
- `tree-parity-behaviour` assumed `src/` stayed expanded after canceling a deferred creation.
  Main reproduces the same timeout. Expand it explicitly when setting up the reload check.
  Add checks for keyboard-menu Escape focus, Rename/New File/New Folder focus, and Delete-dialog
  focus. Run them after the cold folder-hover check so they do not prewarm its directory.
- `copy-feedback` assumed a pre-existing assistant response in an empty throwaway home. Main
  reproduces that timeout after both settings and file-tree copying pass. Seed a mock session and
  clean it up; async clipboard and `execCommand` fallback now complete without a real provider.
- `file-tree-undo` opened its second context against the shared dev API. Reuse
  `openWiredContextPage` so both windows use the isolated server. Match the Delete toast's exact
  title, since the prior "Undid Delete" toast can still be present. The scenario now completes
  through second-window undo, including disk contents, unsaved edits, reload and cross-window
  propagation.

No additional blocking regression was found in the controller extraction, path helper changes,
menu targeting, row removal, or selection subscription lifetime. The existing unfinished work in
app-owned-state and helpers remains outside this PR.

## Evidence

Paths below are under `/work/tmp/fregat-evidence/` unless marked otherwise. Screenshots were read
back, including the tree at rest, dark row menu, clipboard confirmation and undo after reload.

| Check                                        | Evidence                                                      |
| -------------------------------------------- | ------------------------------------------------------------- |
| Original PR parity captures                  | `/tmp/fregat-evidence/20260928T053554Z-scenario-tree-parity/` |
| Fresh main parity captures                   | `20260928T053734Z-scenario-tree-parity/`                      |
| Direct main/PR comparison, 64 identical      | `pr192-main-comparison/results.json`                          |
| Refreshed parity gate, all 64 pass           | `20260928T054056Z-scenario-tree-parity/`                      |
| PR health check                              | `20260928T053734Z-look-1440x1000/`                            |
| Files keyboard rows                          | `20260928T053744Z-scenario-files-tree/`                       |
| Tree clicks during refresh                   | `20260928T053755Z-scenario-tree-file-clicks/`                 |
| Sticky scrolling                             | `20260928T053809Z-scenario-tree-sticky-scroll/`               |
| Copy feedback, mock response and fallback    | `20260928T054446Z-scenario-copy-feedback/`                    |
| File-operation undo, including second window | `20260928T054535Z-scenario-file-tree-undo/`                   |

| file-tree-hover-prefetch | `20260928T053825Z-scenario-file-tree-hover-prefetch/` |
| search-file-actions | `20260928T053838Z-scenario-search-file-actions/` |
| editor-external-edit | `20260928T054034Z-scenario-editor-external-edit/` |
| chat-composer-insert | `20260928T054049Z-scenario-chat-composer-insert/` |
| Behavior and menu focus handoffs | `20260928T054618Z-scenario-tree-parity-behaviour/` |

The parity scenario deliberately produces denied-folder and failed-folder responses. Undo's logs
include in-flight listings of paths just moved away. Browser runs also report software-GPU warnings
and sockets closed during fixture teardown. No TypeScript language-server exit was found. One pair
of simultaneous browser launches chose the same API port; those setup failures were discarded and
subsequent runs were serialized.

## Validation result

- Prepared-input benchmark gate passes after removing the stale teardown calls.
- Tree package: 93 tests. Shared utilities: 32 tests. Tree browser suite: 82 tests.
- Web and scripts typechecks pass. `bun run gates` passes.
- Full visual parity: 64 captures pass, with zero drift.
- Behavior parity passes, including the added row-menu focus handoffs.
- All nine requested dependent scenarios complete after the harness repairs above.

No real provider turn was run. Production deployment is a separate final step after committing
and pushing this review's repairs; the served release must be checked before claiming it shipped.
