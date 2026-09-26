# Plan 192: Views switch subjects without flashing

## Status and authorization

- Status: PROPOSED 2026-09-26. Rule landed in AGENTS.md ("Loading, Empty And Error States") with
  `useHeldUntilReady`; the file picker preview is fixed on `picker-locations`. The rest is below.
- Origin: owner, 2026-09-26: "the preview flashes we need some rule to make it less annoying and the
  app has 100 examples like this".
- Size: M. Web only: `bun run deploy`. Each row ships on its own.

## The rule

A view that switches from one loaded subject to another keeps the old one whole (header and body)
until the new one can paint, then swaps in one frame. The wait shows as a `Spinner` in the header.
Skeletons are for a region's first load only.

Shapes, in order of preference:

1. `useHeldUntilReady(next, ready)` when the subject and its readiness are separate
   (`features/file-picker/components/preview.tsx` + `hooks/use-preview-ready.ts`).
2. `placeholderData` that carries its subject: the query returns `{ subjectId, … }` and the header
   renders from the data, never from the selection.
3. Drop `key={subject}` on views whose data loads; a remount throws both holds away.

Proof per row: a `countBlankFrames` scenario (`scripts/agent/blank-frames.ts`) that arrows through
subjects and reads `blank-frames-0`, like `quick-open-no-flicker`.

## Sites (survey 2026-09-26; `confirmed` = code path read end to end)

| #   | Where                                                                                                        | Switch                       | Flash                                    | Status       |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------- | ------------ |
| 1   | `features/file-picker/components/preview.tsx`                                                                | picker selection             | tile/skeleton under new name             | **fixed**    |
| 2   | `features/command-palette/components/file-preview-panel.tsx`, `lib/file-preview/components/text-preview.tsx` | quick-open highlight         | panel blanks and collapses               | **fixed**    |
| 3   | `features/command-palette/components/code-theme-preview-panel.tsx`, `lib/code-theme/hooks/use-preview.ts`    | palette theme arrow          | new label over skeleton                  | confirmed    |
| 4   | `features/theme-studio/components/code-tab.tsx`                                                              | theme studio list            | skeleton                                 | confirmed    |
| 5   | `features/git/components/history.tsx` (`key={selected}`), `commit-details.tsx`, `utils/history-query.ts`     | commit selection             | new hash over skeleton                   | confirmed    |
| 6   | `features/git/utils/history-query.ts`, `HistoryList key`                                                     | ref switch                   | skeleton, scroll lost (deliberate today) | confirmed    |
| 7   | `features/git/components/panel.tsx` (`History key={rootPath}`)                                               | root switch                  | remount + skeleton                       | likely       |
| 8   | `features/git/components/panel.tsx`, `hooks/use-status.ts`                                                   | root / session worktree      | `PanelLoading`                           | likely       |
| 9   | `features/chat-mode/components/stage-body.tsx` (`key={sessionId}`), `chat/components/timeline-viewport.tsx`  | session switch               | conversation skeleton under new title    | confirmed    |
| 10  | `features/chat/components/side-panel-content.tsx`                                                            | side-panel session switch    | same as 9                                | confirmed    |
| 11  | `stage-body.tsx`, `side-panel-content.tsx`                                                                   | new chat / empty project     | "Opening draft"                          | likely       |
| 12  | `stage-body.tsx`, `chat-mode/utils/active-session.ts`                                                        | session not yet projected    | "Opening session"                        | likely       |
| 13  | `features/git/components/diff-view.tsx` → `editor/components/diff-editor.tsx`                                | diff tab                     | "Loading comparison"                     | confirmed    |
| 14  | `features/editor/components/compare-saved-view.tsx`                                                          | compare tab                  | skeleton                                 | likely       |
| 15  | `features/editor/components/history-pane.tsx`                                                                | undo-history compare         | "Comparing states"                       | likely       |
| 16  | `features/workbench/components/file-navigator-panel.tsx` (`key={rootPath}`)                                  | tree root / session worktree | `TreeLoading`                            | likely       |
| 17  | `features/chat-mode/components/turn-files.tsx`                                                               | turn / session               | hunks vanish, "0 changes"                | likely       |
| 18  | `features/git/components/branch-actions.tsx`                                                                 | session worktree             | Push/PR buttons vanish                   | likely       |
| 19  | `features/workbench/components/editor-group.tsx` (`EditorBreadcrumbs key`)                                   | tab switch                   | symbol crumbs blank (arguably right)     | left (below) |
| 20  | `features/file-picker/hooks/use-directory-load.ts`                                                           | show-hidden / mode toggle    | list skeleton                            | **fixed**    |
| 21  | `features/settings/components/page.tsx`                                                                      | form ↔ JSON, remote owner    | `PageLoading`                            | **fixed**    |
| 22  | `features/settings/components/widgets/font-sample.tsx`                                                       | font choice                  | label in fallback face                   | **fixed**    |

Inverse bug: `features/chat/hooks/use-session-goal.ts` holds the previous session's goal under the new
session's header (`keepPreviousData` without a subject check). Fix with shape 2.

## Order

9/10 (most used), 5, 2, 3/4, then 8 + 16 (they flash together with 9 on a worktree switch), then the rest.

## Row 2 proof

Quick open holds the shown file with `useHeldUntilReady`, including its filename, until its head
read or image decode settles. `TextPreview` observes that ready result, so a failed read is shown
without starting another read. The shared 64 KB default head budget is unchanged.

`quick-open-no-flicker` uses fixture files and delays head reads by 300 ms. Preview blank frames:
31 before, 0 after. Search-list blank frames: 0 before and after. Every sampled frame retained the
preview height and paired its header with the shown body; all three subjects painted. DOM tests
cover successful, binary and missing-file reads.

- Before: `/work/tmp/fregat-evidence/20260926T184042Z-scenario-quick-open-no-flicker/`
- After: `/work/tmp/fregat-evidence/20260926T184641Z-scenario-quick-open-no-flicker/`

## Rows 19–22 proof

`rest-no-flicker` delays directory reads by 400 ms and font samples by 1500 ms, toggles hidden
entries in separate List and Columns folders, switches form → JSON → Defaults → form, chooses
a font, and clicks between two editor tabs. It uses disposable filesystem fixtures and sends
no model turns. Each loaded region is sampled with `countBlankFrames`.

| Region                 | Before | After |
| ---------------------- | ------ | ----- |
| Picker List            | 6      | 0     |
| Picker Columns         | 7      | 0     |
| Settings view          | 0      | 0     |
| Font sample ready face | 44     | 0     |
| Breadcrumb path        | 0      | 0     |

Row 19 remains keyed. File breadcrumbs and the editor change tabs immediately; retaining the
previous tab's symbol names and navigation targets beside the new path would be misleading.
The file path remains present while the new tab's symbols arrive.

Row 20 uses same-directory placeholder data carrying `currentEntry` and entries, including in
Columns view. Navigating to another directory still uses the existing prepared navigation.
Row 21 holds view, scope, owner and the JSON buffer with `useHeldUntilReady`; the scope and view
controls render the held subject, and the header shows a spinner. Separate form and JSON query
subscriptions stay attached to their owners. Clicking the held tab cancels a pending switch.
Row 22 holds the sample text and face together, with a spinner while the next face loads; a
failed font load settles to its fallback.

The local settings scenario had no blank frames before the change. A controlled hook test proves
that an uncached JSON owner and a missing JSON buffer retain the old form, scope and owner until
both are ready. DOM tests also cover picker mode/visibility changes, cancellation, font success
and failure, and reset actions across two real in-process owners. All 28 targeted tests passed.

- Before: `/work/tmp/fregat-evidence/20260926T202726Z-scenario-rest-no-flicker/`
- After: `/work/tmp/fregat-evidence/20260926T202931Z-scenario-rest-no-flicker/`

Screenshots were read back, including the waiting font sample. The final scenario had no console
errors, failed responses or warning/error log events. The baseline fixture's missing initial
commit caused an unrelated project-create conflict; the final fixture commits before opening.

The DOM run temporarily deduplicated `@singapore-editor/core` within this worktree: the shared
Editor React checkout resolved core through another worker's benchmark checkout, causing a
piece-table identity failure. No shared dependency links were modified.
