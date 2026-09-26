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

| #   | Where                                                                                                        | Switch                       | Flash                                    | Status        |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------- | ------------- |
| 1   | `features/file-picker/components/preview.tsx`                                                                | picker selection             | tile/skeleton under new name             | **fixed**     |
| 2   | `features/command-palette/components/file-preview-panel.tsx`, `lib/file-preview/components/text-preview.tsx` | quick-open highlight         | panel blanks and collapses               | **fixed**     |
| 3   | `features/command-palette/components/code-theme-preview-panel.tsx`, `lib/code-theme/hooks/use-preview.ts`    | palette theme arrow          | new label over skeleton                  | confirmed     |
| 4   | `features/theme-studio/components/code-tab.tsx`                                                              | theme studio list            | skeleton                                 | confirmed     |
| 5   | `features/git/components/history.tsx` (`key={selected}`), `commit-details.tsx`, `utils/history-query.ts`     | commit selection             | new hash over skeleton                   | confirmed     |
| 6   | `features/git/utils/history-query.ts`, `HistoryList key`                                                     | ref switch                   | skeleton, scroll lost (deliberate today) | confirmed     |
| 7   | `features/git/components/panel.tsx` (`History key={rootPath}`)                                               | root switch                  | remount + skeleton                       | likely        |
| 8   | `features/git/components/panel.tsx`, `hooks/use-status.ts`                                                   | root / session worktree      | `PanelLoading`                           | likely        |
| 9   | `features/chat-mode/components/stage-body.tsx` (`key={sessionId}`), `chat/components/timeline-viewport.tsx`  | session switch               | conversation skeleton under new title    | confirmed     |
| 10  | `features/chat/components/side-panel-content.tsx`                                                            | side-panel session switch    | same as 9                                | confirmed     |
| 11  | `stage-body.tsx`, `side-panel-content.tsx`                                                                   | new chat / empty project     | "Opening draft"                          | likely        |
| 12  | `stage-body.tsx`, `chat-mode/utils/active-session.ts`                                                        | session not yet projected    | "Opening session"                        | likely        |
| 13  | `features/git/components/diff-view.tsx` → `editor/components/diff-editor.tsx`                                | diff tab                     | "Loading comparison"                     | confirmed     |
| 14  | `features/editor/components/compare-saved-view.tsx`                                                          | compare tab                  | skeleton                                 | likely        |
| 15  | `features/editor/components/history-pane.tsx`                                                                | undo-history compare         | "Comparing states"                       | likely        |
| 16  | `features/workbench/components/file-navigator-panel.tsx` (`key={rootPath}`)                                  | tree root / session worktree | `TreeLoading`                            | likely        |
| 17  | `features/chat-mode/components/turn-files.tsx`                                                               | turn / session               | hunks vanish, "0 changes"                | **fixed**     |
| 18  | `features/git/components/branch-actions.tsx`                                                                 | session worktree             | Push/PR buttons vanish                   | **fixed**     |
| 19  | `features/workbench/components/editor-group.tsx` (`EditorBreadcrumbs key`)                                   | tab switch                   | symbol crumbs blank (arguably right)     | likely, low   |
| 20  | `features/file-picker/hooks/use-directory-load.ts`                                                           | show-hidden / mode toggle    | list skeleton                            | likely        |
| 21  | `features/settings/components/page.tsx`                                                                      | form ↔ JSON, remote owner    | `PageLoading`                            | likely, edge  |
| 22  | `features/settings/components/widgets/font-sample.tsx`                                                       | font choice                  | label in fallback face                   | likely, minor |

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

## Rows 17–18 proof

`TurnFiles` holds the summary, worktree, open-file callback, hunks and undo states together with
`useHeldUntilReady`. Its count appears only after a successful diff read. First loads use
`CheckpointLoading`; failed reads show an error. The header spinner marks a pending switch.

`BranchActions` holds the worktree, PR title, branch state and PR state with the same hook.
Mutation controls are disabled while the next subject loads. Publishing a repository still
needs only the local branch read; remote actions wait for the PR lookup too.

- `turn-files-no-flicker`: 25 blank hunk frames before, 0 after on both measured switches.
  Every sampled header names the shown hunk's turn, with no loading frame reporting 0 changes.
- `branch-actions-no-flicker`: 15 blank action frames before, 0 after on both measured switches.
- Focused DOM tests cover first load, cross-session retention, genuine empty and failed reads,
  and retaining both Push and the PR link while branch and PR requests finish separately.
- All seven focused DOM tests and the repository typecheck pass. Both manual memos are classified
  `needed` by `compiler:memos` because the hold hook compares identity during render.

Screenshots read back:

- Turn before: `/work/tmp/fregat-evidence/20260926T200646Z-scenario-turn-files-no-flicker/`
- Turn after: `/work/tmp/fregat-evidence/20260926T201420Z-scenario-turn-files-no-flicker/`
- Branch before: `/work/tmp/fregat-evidence/20260926T201219Z-scenario-branch-actions-no-flicker/`
- Branch after: `/work/tmp/fregat-evidence/20260926T201845Z-scenario-branch-actions-no-flicker/`

The turn scenario uses the native checkpoint fixture; branch sessions use a mock provider and never run a model, and
all remotes are local bare repositories. The turn runs include transient `client.RPC_FAILED`
startup/read warnings; the measured switches completed and the final run had no failed HTTP
responses. No deployment was performed for this wave worker PR.
