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
| 3   | `features/command-palette/components/code-theme-preview-panel.tsx`, `lib/code-theme/hooks/use-preview.ts`    | palette theme arrow          | new label over skeleton                  | **fixed**     |
| 4   | `features/theme-studio/components/code-tab.tsx`                                                              | theme studio list            | skeleton                                 | **fixed**     |
| 5   | `features/git/components/history.tsx` (`key={selected}`), `commit-details.tsx`, `utils/history-query.ts`     | commit selection             | new hash over skeleton                   | **fixed**     |
| 6   | `features/git/utils/history-query.ts`, `HistoryList key`                                                     | ref switch                   | skeleton, scroll lost (deliberate today) | **fixed**     |
| 7   | `features/git/components/panel.tsx` (`History key={rootPath}`)                                               | root switch                  | remount + skeleton                       | **fixed**     |
| 8   | `features/git/components/panel.tsx`, `hooks/use-status.ts`                                                   | root / session worktree      | `PanelLoading`                           | **fixed**     |
| 9   | `features/chat-mode/components/stage-body.tsx` (`key={sessionId}`), `chat/components/timeline-viewport.tsx`  | session switch               | conversation skeleton under new title    | confirmed     |
| 10  | `features/chat/components/side-panel-content.tsx`                                                            | side-panel session switch    | same as 9                                | confirmed     |
| 11  | `stage-body.tsx`, `side-panel-content.tsx`                                                                   | new chat / empty project     | "Opening draft"                          | likely        |
| 12  | `stage-body.tsx`, `chat-mode/utils/active-session.ts`                                                        | session not yet projected    | "Opening session"                        | likely        |
| 13  | `features/git/components/diff-view.tsx` → `editor/components/diff-editor.tsx`                                | diff tab                     | "Loading comparison"                     | **fixed**     |
| 14  | `features/editor/components/compare-saved-view.tsx`                                                          | compare tab                  | skeleton                                 | **fixed**     |
| 15  | `features/editor/components/history-pane.tsx`                                                                | undo-history compare         | "Comparing states"                       | **fixed**     |
| 16  | `features/workbench/components/file-navigator-panel.tsx` (`key={rootPath}`)                                  | tree root / session worktree | `TreeLoading`                            | **fixed**     |
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

## Rows 8 and 16 proof

`root-switch-no-flicker` clicks three idle fixture sessions with different roots, delaying status
and tree reads by 700 ms. `countBlankFrames` first verifies that loaded rows are observable,
including the file tree's shadow root. Baseline: Git 66 blank frames, files 93. After: both 0.
The scenario also expands a 100-file folder, scrolls 500 px, switches away and back, and verifies
restoration. No provider turn runs.

- Shape 1: `useHeldUntilReady` around each whole panel. Git holds above its branch header and
  actions in both workbench and chat. The file navigator holds its model and actions with the
  root because workspace navigation evicts tree queries. Its key changes only once ready.
- Git state follows the shown root, preserving the commit draft while waiting. Tree view records
  remain separate per root, and capture uses the shown confirmed model after query eviction.
- Baseline evidence: `/work/tmp/fregat-evidence/20260926T185129Z-scenario-root-switch-no-flicker/`.
- After evidence: `/work/tmp/fregat-evidence/20260926T190147Z-scenario-root-switch-no-flicker/`.
  Screenshots read back. DOM tests cover first load, delayed/superseded/error Git switches and
  commit drafts; tree record tests cover per-root expansion and scroll retention.

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

## Rows 3 and 4 proof

The shared `useCodeThemePreview` holds its theme ID with `useHeldUntilReady`; a passive query
observer reads that subject's highlighted tokens. Both headers and bodies render the held subject,
and the selected theme's query drives a header Spinner. Theme Studio now names its sample in a
`ToolPane` header. Pending first loads and errors retain their existing states.

The `palette-theme-no-flicker` and `studio-theme-no-flicker` scenarios arrow through three cold
themes with a 500ms module delay. `countBlankFrames` measured **13 → 0** in the palette and
**62 → 0** in the studio. Both final runs also sampled zero header/body mismatches and checked
that each replacement painted. Four hook tests cover first load, cold replacement, failure and
recovery, and a superseded highlight completing after a return to cached content.

Evidence, screenshots read back, on the worker's Vite port 5248 with throwaway API homes:

- Palette before: `/work/tmp/fregat-evidence/20260926T184106Z-scenario-palette-theme-no-flicker/`.
- Palette after: `/work/tmp/fregat-evidence/20260926T184750Z-scenario-palette-theme-no-flicker/`.
- Studio before: `/work/tmp/fregat-evidence/20260926T184127Z-scenario-studio-theme-no-flicker/`.
- Studio after: `/work/tmp/fregat-evidence/20260926T184803Z-scenario-studio-theme-no-flicker/`.

The baseline's linked font files were blocked by the worktree Vite allow-list; the final runs
allowed the dependency directory and had no failed requests or error logs. No model was invoked.

## Rows 5–7 proof

Commit details hold the displayed root and commit with `useHeldUntilReady`. History holds its
root, view and settled search until the requested pages are ready. The status query no longer
unmounts the graph, and neither History nor CommitDetails remounts on selection. The list resets
scroll on a ref switch when the new rows arrive, preserving the deliberate behavior in row 6.

`git-history-no-flicker` clicks through commits, refs and two fixture repositories with history
reads delayed 450 ms. It asserts zero blank frames for each switch and checks every sampled
commit frame for a matching header hash and message. No provider runs a turn.

| Switch | Before | After |
| ------ | -----: | ----: |
| Commit |     60 |     0 |
| Ref    |     16 |     0 |
| Root   |     14 |     0 |

- Before: `/work/tmp/fregat-evidence/20260926T184222Z-scenario-git-history-no-flicker/`
- After: `/work/tmp/fregat-evidence/20260926T185111Z-scenario-git-history-no-flicker/`
- Screenshots read back. DOM coverage gates a real in-process commit request and verifies the
  held hash, files and header spinner. The existing first-load panel-state test also passes.

## Rows 8 and 16 review corrections

The shown tree resolves its active file from that root's active or parked workspace. Its
selection capture and ancestor-directory fetch use the same root, so switching to another
workspace's selected file cannot overwrite the saved expansion or scroll association.

A missing root, a root replaced by a file, or an invalid root path discards the saved model and
shows the terminal load error. The rejected root stays marked until a successful root read,
preventing a held pane's cleanup from saving the removed rows again after query eviction.
Permission-denied refreshes retain the saved rows and show the refresh warning. Invalidating
one root preserves the other root's persisted observation.

- Failing before: selecting different files in A and B made the expansion/scroll return check
  time out in `/work/tmp/fregat-evidence/20260926T200109Z-scenario-root-switch-no-flicker/`.
  The delayed deleted-directory DOM test expected `error` and received `ready` with saved rows.
- Focused verification: 59 tests across tree loading, reload observations, tree synchronization,
  and editor workspace state passed. The tests include real missing-directory, non-directory,
  and permission-denied responses, plus cleanup after query eviction and subsequent recovery.
- Repository typecheck passed. The bundle gate failed only on the total: 1,761,886 gzip bytes
  against a 1,760,711 limit, 1,175 bytes over. No owner failed; pins were left unchanged.
- Final browser proof: `/work/tmp/fregat-evidence/20260926T201142Z-scenario-root-switch-no-flicker/`.
  The scenario selects different files before B's first tree read, checks A's scroll during the
  delayed hold, restores A's expansion and scroll, and records zero blank frames for both panes.
  It then deletes A during a held root read and verifies that the settled error replaces all rows.
  Screenshots 04, 06, and 10 were read back. The sole failed response is the intentional missing
  root's 404; no page errors. Mock provider only, no model turns. Vite 5254 stopped after the run.
- `bun run gates`, including knip, and the final scripts typecheck passed. No deployment.

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

## Rows 13–15 proof

The workbench holds comparison tabs with `useHeldUntilReady` until Git has resolved the
comparison and any checkpoint blobs, or the saved-file read has settled. The active tab's label,
breadcrumbs and body use the held subject; its header shows a spinner during the wait. Errors
release the hold. Split comparisons reuse both editor instances after removing the tab key.

Undo history holds its displayed state, including the focused header and selected pair, while the
next comparison resolves. Focused and pair comparisons share one body so changing between them
preserves the editor instance.

- Row 13, `diff-no-flicker`: delayed Git blob reads, **20 → 0** blank frames. Every sampled frame
  pairs the active tab label with the shown body.
- Row 14, `saved-comparison-no-flicker`: warm saved comparisons, **0 → 0** blank frames, with
  every frame pairing its tab label and body. DOM tests
  also cover a delayed saved-file read, a superseded selection and a failed read.
- Row 15, `history-comparison-no-flicker`: Shift+arrow through pairs, **0 → 0** blank frames. A DOM
  regression fails before the fix because the editor is destroyed; it passes after the fix with
  the same editor DOM node. A separate test proves both split-editor instances survive tab changes.

Before evidence:

- `/work/tmp/fregat-evidence/20260926T201644Z-scenario-diff-no-flicker/`
- `/work/tmp/fregat-evidence/20260926T201659Z-scenario-saved-comparison-no-flicker/`
- `/work/tmp/fregat-evidence/20260926T201712Z-scenario-history-comparison-no-flicker/`

After evidence, screenshots read back:

- `/work/tmp/fregat-evidence/20260926T202812Z-scenario-diff-no-flicker/`
- `/work/tmp/fregat-evidence/20260926T203038Z-scenario-saved-comparison-no-flicker/`
- `/work/tmp/fregat-evidence/20260926T201804Z-scenario-history-comparison-no-flicker/`
