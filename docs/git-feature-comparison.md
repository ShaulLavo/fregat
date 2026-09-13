> [!IMPORTANT]
> **STATUS: 🟡 NEEDS UPDATE (reviewed 2026-06-06).** Re-baseline parity status. (Reference paths repaired 2026-06-12.)

# Git Feature Comparison

This compares the current Platform Git implementation with Zed (checkout not
vendored — see upstream https://github.com/zed-industries/zed) and VS Code at
the vendored checkout `references/vscode`.

The main target is feature parity with Zed. VS Code is treated as a second pass
for useful extras once the Zed-level workflow is covered.

## Sources

Platform:

- `apps/server/src/git/*`
- `apps/server/src/app.ts`
- `apps/web/src/features/git/*`
- `@singapore-editor/diff/*`

Zed:

- `docs/src/git.md`
- `crates/git/src/*`
- `crates/project/src/git_store.rs`
- `crates/project/src/git_store/*`
- `crates/git_ui/src/*`
- `crates/git_graph/src/git_graph.rs`
- `crates/git_hosting_providers/src/*`
- `crates/settings_content/src/project.rs`
- `crates/settings_content/src/settings_content.rs`

VS Code:

- `extensions/git/package.json`
- `extensions/git/package.nls.json`
- `extensions/git/src/commands.ts`
- `extensions/git/src/repository.ts`
- `extensions/git/src/model.ts`
- `extensions/git/src/blame.ts`
- `extensions/git/src/historyProvider.ts`
- `extensions/git/src/artifactProvider.ts`

## Current Platform Implementation

Status: implemented enough for a basic Git panel and diff review.

- Repository detection for a selected workspace path via `git rev-parse`.
- Repository metadata: branch, commit, ahead count, behind count, root path.
- File status from `git status --porcelain=v2 -z`, including modified, added,
  deleted, renamed, untracked, ignored, and conflicted.
- Status decorations in the file tree.
- Git panel with staged and worktree groups.
- Stage, unstage, and discard one file or a group of files.
- Working tree and staged diffs.
- Untracked file diffs using `git diff --no-index /dev/null <path>`.
- Rename and deletion diff snapshots.
- Blob-backed snapshot diff documents, so an opened diff remains stable after
  the index or worktree changes.
- Split/stacked diff display through `@singapore-editor/diff`, drawn as real read-only
  editors carrying the package's diff plugin.
- Inline changed-word highlighting in diff rows through `annotateInlineChanges`.
- Line-range selection in an open diff, handed to the agent as a `@@` block.
- Commit from the panel with a single-line message.
- Empty-message commit request opens `COMMIT_EDITMSG`, but saving that file does
  not yet complete or abort the commit.
- Branch list, checkout, and create branch.
- Fetch, pull, and push using Git defaults.
- Backend `apply-patch` endpoint can apply patches to the worktree or index, but
  there is no hunk/selection UI using it yet.

Important current limits:

- No hunk-level stage, unstage, or restore UI.
- No previous/next hunk navigation. The diff package published one, nothing ever
  called it, and it was removed with `DiffView`.
- No blame, file history, commit graph, or timeline.
- No stash support.
- No branch delete/rename, remote management, tags, merge, rebase, or cherry-pick.
- No Git merge conflict resolution UI.
- No worktree support.
- No clone/init flow.
- No integrated Git authentication/askpass flow.
- No binary diff handling.
- No settings surface for Git behavior.

## Zed Parity Checklist

### Repository Model And Refresh

| Feature                                    | Zed | Platform | Gap                                                                                                          |
| ------------------------------------------ | --- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Detect repository for project paths        | Yes | Yes      | Mostly covered for one selected workspace path.                                                              |
| Track multiple repositories in a workspace | Yes | Missing  | Add repository discovery, active repository selection, and per-repo status.                                  |
| Active repository selection                | Yes | Missing  | Zed has `SelectRepo`; Platform assumes the current root path.                                                |
| Auto-refresh on external Git changes       | Yes | Partial  | Platform invalidates Git queries on workspace file events, but has no Git-aware watcher/index refresh model. |
| Pending operation/job state                | Yes | Missing  | Zed tracks pending ops and current Git jobs.                                                                 |
| Operation cancellation                     | Yes | Missing  | Zed exposes cancel behavior; Platform runs short RPC calls only.                                             |
| Trust/unsafe repository handling           | Yes | Missing  | Zed and VS Code guard unsafe repos; Platform does not.                                                       |
| Git binary selection/settings              | Yes | Missing  | Platform shells out to `git` from PATH.                                                                      |
| Git enable/status/diff settings            | Yes | Missing  | Zed can disable Git, status, or diff separately.                                                             |
| Sub-repository awareness                   | Yes | Missing  | Zed models repos/worktrees in a project store.                                                               |

### Status Model

| Feature                          | Zed | Platform | Gap                                                                                                               |
| -------------------------------- | --- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Tracked index/worktree status    | Yes | Yes      | Covered for common statuses.                                                                                      |
| Partially staged state           | Yes | Partial  | Platform can show the same file in both staged and worktree groups, but has no explicit partial-state affordance. |
| Unmerged/conflict status details | Yes | Partial  | Platform collapses unmerged states to `conflicted`.                                                               |
| Copied status                    | Yes | Missing  | Platform maps `C` to `renamed`; the UI TODO notes copied status is not fully supported.                           |
| Type-changed status              | Yes | Partial  | Platform maps `T` to modified.                                                                                    |
| Ignored status                   | Yes | Partial  | Parsed, but not surfaced as a first-class panel workflow.                                                         |
| Diff stats per file              | Yes | Missing  | Zed shows added/deleted counts in the panel.                                                                      |
| Status summary/count badge       | Yes | Missing  | Zed can show a Git panel count badge.                                                                             |

### Git Panel

| Feature                               | Zed | Platform | Gap                                                                                                   |
| ------------------------------------- | --- | -------- | ----------------------------------------------------------------------------------------------------- |
| Git panel with changed files          | Yes | Yes      | Basic staged/worktree groups exist.                                                                   |
| Panel open/focus/toggle actions       | Yes | Partial  | Platform has a tabbed workspace panel and collapsible Git content, but no command palette action set. |
| Flat file list                        | Yes | Yes      | Covered.                                                                                              |
| Tree view for changed files           | Yes | Missing  | Zed supports flat/tree toggle.                                                                        |
| Sort by status or path                | Yes | Partial  | Platform sorts by path only.                                                                          |
| Status display style setting          | Yes | Missing  | Zed supports icon vs label-color styles.                                                              |
| File icon and folder icon settings    | Yes | Partial  | Platform shows file icons, but no Git-panel-specific settings.                                        |
| Scrollbar/dock/default-width settings | Yes | Missing  | Platform uses current workspace layout only.                                                          |
| Open all modified files               | Yes | Missing  | Platform can open all diffs, not the live files.                                                      |
| Open all diffs                        | Yes | Yes      | Platform has `Open all diffs`.                                                                        |
| Context menu for Git actions          | Yes | Missing  | Zed exposes stage, stash, diff, restore, trash, tree/sort actions.                                    |
| Keyboard navigation in Git panel      | Yes | Partial  | Basic row keyboard open exists; no next/previous/first/last/range selection.                          |
| Stage range of entries                | Yes | Missing  | Zed has `StageRange`.                                                                                 |
| Add file to `.gitignore`              | Yes | Missing  | Zed has `AddToGitignore`.                                                                             |
| Restore tracked files separately      | Yes | Partial  | Platform discard uses restore/clean for selected paths, but not a tracked-only workflow.              |
| Trash untracked files                 | Yes | Missing  | Platform deletes untracked files with `git clean -f`; no trash behavior.                              |
| Group conflicts separately            | Yes | Missing  | Platform labels conflicted files but has no Conflicts panel section.                                  |

### Diff And Review

| Feature                                | Zed | Platform | Gap                                                                       |
| -------------------------------------- | --- | -------- | ------------------------------------------------------------------------- |
| Split diff view                        | Yes | Yes      | Covered.                                                                  |
| Unified diff view                      | Yes | Yes      | Covered.                                                                  |
| Persistent diff-view style setting     | Yes | Partial  | Platform has a per-view toggle, but no Git setting equivalent.            |
| Project Diff showing all changes       | Yes | Partial  | Platform opens individual diff tabs; no editable all-changes multibuffer. |
| Editable diff excerpts                 | Yes | Missing  | Zed Project Diff excerpts are editable.                                   |
| Stage current hunk                     | Yes | Missing  | Backend patch apply exists, but no UI/action wiring.                      |
| Unstage current hunk                   | Yes | Missing  | Same.                                                                     |
| Restore current hunk                   | Yes | Missing  | Same.                                                                     |
| Stage and move to next hunk            | Yes | Missing  | Zed has `StageAndNext`.                                                   |
| Unstage and move to next hunk          | Yes | Missing  | Zed has `UnstageAndNext`.                                                 |
| Restore and move to next hunk          | Yes | Missing  | Zed has `RestoreAndNext`.                                                 |
| Stage/unstage selected ranges          | Yes | Missing  | VS Code also has this.                                                    |
| Hunk navigation                        | Yes | Missing  | The package's navigation API had no caller and went with `DiffView`.      |
| Expand skipped unchanged context       | Yes | Yes      | `@singapore-editor/diff` supports expandable hunk separators.                     |
| Word diff highlighting                 | Yes | Partial  | Platform annotates inline changes, but lacks global/language settings.    |
| Collapse untracked diff                | Yes | Missing  | Zed has a panel setting for this.                                         |
| Branch diff against default/merge base | Yes | Missing  | Zed has `BranchDiff` and `DiffType::MergeBase`.                           |
| Review branch diff with agent          | Yes | Missing  | Zed wires branch diff to agent review.                                    |
| Diff clipboard/text diff action        | Yes | Missing  | Zed has text diff view actions outside normal Git changes.                |
| Binary file detection                  | Yes | Missing  | Platform reads diff sides as UTF-8 text.                                  |

### Gutter, Blame, And History

| Feature                            | Zed | Platform | Gap                                                         |
| ---------------------------------- | --- | -------- | ----------------------------------------------------------- |
| Git gutter indicators              | Yes | Missing  | Zed supports gutter visibility and hunk style settings.     |
| Inline blame on current line       | Yes | Missing  | Zed has delay/padding/min-column/summary settings.          |
| Blame view/action for current file | Yes | Missing  | Zed runs incremental blame against current buffer contents. |
| Blame author avatars               | Yes | Missing  | Zed supports hosting-provider avatars.                      |
| File history                       | Yes | Missing  | Zed shows per-file commit history and opens commit diffs.   |
| Paginated file history             | Yes | Missing  | Zed supports skip/limit.                                    |
| Commit details view                | Yes | Missing  | Zed can show a commit and load a commit diff.               |
| Commit graph                       | Yes | Missing  | Zed has `crates/git_graph` and graph data APIs.             |
| Search commits                     | Yes | Missing  | Zed can search commits in graph/log data.                   |
| Compare refs/commits               | Yes | Missing  | Zed supports branch diff and graph commit data.             |

### Commit Workflow

| Feature                                  | Zed | Platform | Gap                                                                                                   |
| ---------------------------------------- | --- | -------- | ----------------------------------------------------------------------------------------------------- |
| Commit staged changes                    | Yes | Yes      | Basic `git commit -m` exists.                                                                         |
| Commit message textarea in panel         | Yes | Partial  | Platform has a single-line input, not a multiline editor.                                             |
| Expanded commit editor                   | Yes | Partial  | Platform opens `COMMIT_EDITMSG` on empty message, but save does not complete/abort commit.            |
| Commit message preferred line length     | Yes | Missing  | Zed defaults to 72 and exposes settings.                                                              |
| Merge message support                    | Yes | Missing  | Zed reads merge messages.                                                                             |
| Pre-commit hook handling                 | Yes | Partial  | `git commit` runs hooks implicitly, but Platform has no hook state/errors beyond raw command failure. |
| Amend commit                             | Yes | Missing  | Zed has `Amend`.                                                                                      |
| Signoff                                  | Yes | Missing  | Zed has `Signoff`.                                                                                    |
| Uncommit/undo last commit                | Yes | Missing  | Zed performs soft reset after commit.                                                                 |
| Show recently submitted commit with undo | Yes | Missing  | Zed shows an uncommit bar after commit.                                                               |
| AI commit message generation             | Yes | Missing  | Zed has `GenerateCommitMessage` and model settings.                                                   |
| Custom commit-message prompt/rules       | Yes | Missing  | Zed integrates this with agent rules.                                                                 |
| Co-author suggestions                    | Yes | Missing  | Zed has `ToggleFillCoAuthors`.                                                                        |
| Block commit with unresolved conflicts   | Yes | Missing  | Platform lets Git fail naturally.                                                                     |

### Branches And Refs

| Feature                        | Zed                   | Platform | Gap                                                                       |
| ------------------------------ | --------------------- | -------- | ------------------------------------------------------------------------- |
| List branches                  | Yes                   | Yes      | Platform lists local branches only via `git branch --format`.             |
| Current branch and upstream    | Yes                   | Yes      | Platform reports upstream per branch and repo ahead/behind.               |
| Local and remote branch picker | Yes                   | Missing  | Platform only lists local branches.                                       |
| Create branch                  | Yes                   | Yes      | Covered.                                                                  |
| Create branch from start point | Yes                   | Partial  | Backend accepts `startPoint`; web API wrapper does not expose it.         |
| Checkout/switch branch         | Yes                   | Yes      | Covered.                                                                  |
| Delete branch                  | Yes                   | Missing  | Zed confirms deletion and prevents deleting current branch.               |
| Delete remote branch           | Yes                   | Missing  | Zed/VS Code support remote branch deletion.                               |
| Rename branch                  | Yes                   | Missing  | Zed has `RenameBranch`.                                                   |
| Detached checkout              | Partial               | Missing  | VS Code has this explicitly; Zed worktree/display handles detached state. |
| Default branch lookup          | Yes                   | Missing  | Zed resolves default branch.                                              |
| Branch picker metadata         | Yes                   | Missing  | Zed can show author name and recent commit info.                          |
| Check whether HEAD was pushed  | Yes                   | Missing  | Zed can list remote branches containing HEAD.                             |
| Tags                           | No major Zed UI found | Missing  | VS Code has tag create/delete.                                            |

### Remotes, Network, And Hosting

| Feature                              | Zed | Platform | Gap                                                                                            |
| ------------------------------------ | --- | -------- | ---------------------------------------------------------------------------------------------- |
| Fetch                                | Yes | Yes      | Basic `git fetch`.                                                                             |
| Fetch all remotes                    | Yes | Partial  | Plain `git fetch` depends on Git config; no explicit all-remotes action.                       |
| Fetch specific remote                | Yes | Missing  | Zed has `FetchFrom` and `FetchOptions::Remote`.                                                |
| Pull                                 | Yes | Yes      | Basic `git pull`.                                                                              |
| Pull with rebase                     | Yes | Missing  | Zed has `PullRebase`.                                                                          |
| Push                                 | Yes | Yes      | Basic `git push`.                                                                              |
| Push to selected remote/branch       | Yes | Missing  | Zed has `PushTo`.                                                                              |
| Set upstream on push                 | Yes | Missing  | Zed has `PushOptions::SetUpstream`.                                                            |
| Force push                           | Yes | Missing  | Zed has `ForcePush`.                                                                           |
| Remote selector in panel             | Yes | Missing  | Zed shows a selector when multiple remotes exist.                                              |
| Create remote                        | Yes | Missing  | Zed has `CreateRemote`.                                                                        |
| Remove remote                        | Yes | Missing  | Zed repository API supports it.                                                                |
| Resolve push remote using Git config | Yes | Partial  | Platform delegates to `git push`, but does not display or choose the resolved remote.          |
| Askpass/auth modal                   | Yes | Missing  | Zed has an askpass modal and delegate.                                                         |
| Git hosting providers                | Yes | Missing  | Zed supports GitHub, GitLab, Bitbucket, Gitea, Forgejo, Gitee, Azure, SourceHut, and Chromium. |
| Create pull request                  | Yes | Missing  | Zed has `CreatePullRequest`.                                                                   |
| Permalink to line/commit             | Yes | Missing  | Zed builds hosting-provider permalinks.                                                        |
| Provider avatars                     | Yes | Missing  | Zed can show author avatars through hosting providers.                                         |

### Merge Conflicts

| Feature                                | Zed     | Platform | Gap                                                                                |
| -------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------- |
| Detect conflicted files                | Yes     | Partial  | Platform parses unmerged status as `conflicted`.                                   |
| Conflicts section in panel             | Yes     | Missing  | Zed groups conflicts separately.                                                   |
| Parse conflict marker regions          | Yes     | Missing  | Zed has `ConflictSet`.                                                             |
| Highlight ours/theirs regions          | Yes     | Missing  | Zed renders conflict highlights.                                                   |
| Resolve with ours                      | Yes     | Missing  | Zed provides conflict buttons.                                                     |
| Resolve with theirs                    | Yes     | Missing  | Zed provides conflict buttons.                                                     |
| Resolve with both                      | Yes     | Missing  | Zed provides conflict buttons.                                                     |
| Save resolved conflicts from diff view | Yes     | Missing  | Zed tests this in Project Diff.                                                    |
| Agent-assisted conflict resolution     | Yes     | Missing  | Zed has conflict resolution actions through agent UI.                              |
| Merge/rebase/cherry-pick abort         | Partial | Missing  | VS Code exposes these strongly; Zed has pull/merge conflict UI and Git operations. |

### Stashing

| Feature                        | Zed | Platform | Gap                                                                     |
| ------------------------------ | --- | -------- | ----------------------------------------------------------------------- |
| Stash all changes              | Yes | Missing  | Zed has `StashAll`.                                                     |
| Stash selected paths           | Yes | Missing  | Zed repository API has `stash_paths`.                                   |
| Include untracked in stash     | Yes | Missing  | Zed uses `git stash push --include-untracked`.                          |
| List stash entries             | Yes | Missing  | Zed parses index, OID, timestamp, branch, message.                      |
| Stash picker                   | Yes | Missing  | Zed has `ViewStash` and `stash_picker`.                                 |
| Apply latest stash             | Yes | Missing  | Zed has `StashApply`.                                                   |
| Pop latest stash               | Yes | Missing  | Zed has `StashPop`.                                                     |
| Apply/pop/drop selected stash  | Yes | Missing  | Zed supports indexed stash operations.                                  |
| View stash diff                | Yes | Missing  | Zed has a stash diff view.                                              |
| Apply/pop/drop from stash diff | Yes | Missing  | Zed has `ApplyCurrentStash`, `PopCurrentStash`, and `DropCurrentStash`. |

### Worktrees

| Feature                              | Zed | Platform | Gap                                             |
| ------------------------------------ | --- | -------- | ----------------------------------------------- |
| List linked worktrees                | Yes | Missing  | Zed parses `git worktree list --porcelain`.     |
| Worktree selector                    | Yes | Missing  | Zed has `Worktree`.                             |
| Create worktree                      | Yes | Missing  | Zed can create worktrees from branches/commits. |
| Remove worktree                      | Yes | Missing  | Zed supports force remove.                      |
| Rename worktree                      | Yes | Missing  | Zed supports rename.                            |
| Open linked worktree                 | Yes | Missing  | VS Code also has open-current/new-window flows. |
| Worktree directory setting           | Yes | Missing  | Zed has `git.worktree_directory`.               |
| Resolve linked worktree to main repo | Yes | Missing  | Zed handles main repo path and common dir.      |

### Clone And Init

| Feature                          | Zed | Platform | Gap                                        |
| -------------------------------- | --- | -------- | ------------------------------------------ |
| Initialize repository            | Yes | Missing  | Zed has `Init`; Platform has no endpoint.  |
| Clone repository                 | Yes | Missing  | Zed has `Clone`; Platform has no endpoint. |
| Default branch fallback for init | Yes | Missing  | Zed has `git_panel.fallback_branch_name`.  |
| Integrated clone modal           | Yes | Missing  | Zed has clone UI.                          |

### Settings And Customization

| Feature                           | Zed | Platform | Gap          |
| --------------------------------- | --- | -------- | ------------ |
| Git panel button visibility       | Yes | Missing  | Zed setting. |
| Git panel dock/default width      | Yes | Missing  | Zed setting. |
| Panel starts open                 | Yes | Missing  | Zed setting. |
| Tree view toggle setting          | Yes | Missing  | Zed setting. |
| Sort-by-path setting              | Yes | Missing  | Zed setting. |
| Status style setting              | Yes | Missing  | Zed setting. |
| Diff stats setting                | Yes | Missing  | Zed setting. |
| Count badge setting               | Yes | Missing  | Zed setting. |
| Git gutter visibility             | Yes | Missing  | Zed setting. |
| Gutter debounce                   | Yes | Missing  | Zed setting. |
| Inline blame settings             | Yes | Missing  | Zed setting. |
| Hunk style setting                | Yes | Missing  | Zed setting. |
| Git path display style            | Yes | Missing  | Zed setting. |
| Commit message line length        | Yes | Missing  | Zed setting. |
| Word diff global/language setting | Yes | Missing  | Zed setting. |

## VS Code Nice-To-Have Checklist

These are not required for Zed parity, but they are useful ideas from VS Code's
Git extension.

### Repository And SCM Platform

| Feature                                      | Why It Matters                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Public source-control provider API           | Lets extensions or internal tools contribute SCM providers and actions. |
| Multi-repository source control view         | Better support for monorepos, nested repos, and multi-root workspaces.  |
| Open/close/reopen repositories               | Lets users hide noisy repositories without disabling Git globally.      |
| Parent-folder repository detection prompt    | Useful when opening a subfolder inside a repo.                          |
| Repository scan settings and ignored folders | Avoids expensive scans in `node_modules` or generated trees.            |
| Status limit warnings                        | Protects the UI from huge repos with tens of thousands of changes.      |
| Optimistic updates                           | Makes stage/unstage feel immediate while Git catches up.                |
| Git output/log panel                         | Essential for debugging failed commands.                                |
| Progress and cancellation support            | Important for clone/fetch/push/pull/stash on large repos.               |

### Staging And Discarding

| Feature                                               | Why It Matters                                        |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Stage all tracked changes                             | Faster than selecting changed tracked files manually. |
| Stage all untracked changes                           | Useful when separating new files from edits.          |
| Stage all merge changes                               | Specific workflow during conflict resolution.         |
| Stage selected ranges                                 | More precise than hunk staging.                       |
| Stage hunk/block and stage selection from diff gutter | High-value review workflow.                           |
| Revert selected ranges                                | Complements partial staging.                          |
| Clean all tracked/untracked separately                | Safer bulk discard options.                           |
| Discard untracked changes to trash                    | Safer than immediate delete.                          |
| Close diff on operation setting                       | Keeps review tabs tidy after stage/discard.           |

### Commit Workflow

| Feature                               | Why It Matters                                      |
| ------------------------------------- | --------------------------------------------------- |
| Commit all                            | One-command tracked-change commit.                  |
| Commit staged                         | Explicitly commits only staged changes.             |
| Empty commit                          | Useful for CI retriggers and markers.               |
| Commit amend                          | Common fixup workflow.                              |
| Signed-off commits                    | Required in many open-source workflows.             |
| No-verify commits with confirmation   | Useful escape hatch for broken hooks.               |
| Smart commit                          | Can stage and commit in one action when configured. |
| Commit input validation               | Subject/body length warnings.                       |
| Commit templates and restore template | Handles repo-specific commit templates.             |
| Editor as commit input                | Better multiline commit messages.                   |
| Save-before-commit prompts            | Prevents committing stale editor contents.          |
| Post-commit command                   | Can automatically push or sync after commit.        |
| Commit diagnostics hook               | Can block/warn on diagnostics before commit.        |
| Add AI co-author setting              | Useful if AI-generated changes need attribution.    |

### Branches, Tags, And Refs

| Feature                                  | Why It Matters                                            |
| ---------------------------------------- | --------------------------------------------------------- |
| Branch prefix setting                    | Useful for team branch naming conventions.                |
| Branch validation regex                  | Prevents invalid or non-compliant branch names.           |
| Branch whitespace replacement            | Makes branch creation smoother.                           |
| Random branch names                      | Convenience feature, low priority.                        |
| Branch protection prompts                | Prevents accidental commits/pushes on protected branches. |
| Branch sort order                        | Makes large branch lists usable.                          |
| Checkout detached                        | Useful for inspecting old commits.                        |
| Pull before checkout                     | Avoids switching onto stale branches.                     |
| Create branch from ref                   | Useful from history/graph UI.                             |
| Create/delete tags                       | Common release workflow.                                  |
| Delete remote tags                       | Completes tag management.                                 |
| Copy branch/tag/commit/stash identifiers | Small but helpful context-menu affordance.                |

### Network Operations

| Feature                                   | Why It Matters                                     |
| ----------------------------------------- | -------------------------------------------------- |
| Sync command                              | Combines pull and push into a single action.       |
| Sync with rebase                          | Matches teams that prefer rebase.                  |
| Publish branch                            | Handles first push/upstream setup.                 |
| Fetch prune                               | Keeps remote refs clean.                           |
| Fetch all                                 | Useful for multi-remote repos.                     |
| Fetch/pull/push a selected ref            | Better advanced control.                           |
| Push tags                                 | Release workflow.                                  |
| Push follow-tags                          | Common Git option.                                 |
| Force push with lease                     | Safer force push default.                          |
| Force-push confirmations                  | Prevents destructive mistakes.                     |
| Auto-fetch                                | Keeps behind counts current.                       |
| Auto-stash                                | Helps pull/rebase with dirty worktrees.            |
| Prune-on-fetch and fetch-on-pull settings | Useful automation.                                 |
| Terminal authentication integration       | Makes terminal Git commands share editor auth.     |
| Integrated askpass                        | Needed for HTTPS remotes without terminal prompts. |
| GitHub authentication integration         | Smooth first-time clone/push.                      |

### Merge, Rebase, And Cherry-Pick

| Feature                          | Why It Matters                       |
| -------------------------------- | ------------------------------------ |
| Merge branch                     | Common operation outside terminal.   |
| Abort merge                      | Essential recovery action.           |
| Rebase branch                    | Common branch cleanup workflow.      |
| Abort rebase                     | Essential recovery action.           |
| Cherry-pick commit               | Useful from history/graph.           |
| Abort cherry-pick                | Essential recovery action.           |
| Merge editor integration         | Strong conflict resolution UX.       |
| Compute conflicts with Git diff3 | Better conflict context.             |
| Complete merge command           | Clear end-state for merge workflows. |

### History, Timeline, And Graph

| Feature                            | Why It Matters                                                    |
| ---------------------------------- | ----------------------------------------------------------------- |
| Timeline provider                  | File history integrated into the workbench.                       |
| Open commit from timeline          | Fast commit inspection.                                           |
| Copy commit hash/message           | Common review/debug workflow.                                     |
| Select commit for compare          | Lets users compare arbitrary history points.                      |
| Compare with selected              | Completes commit compare flow.                                    |
| Compare with remote                | Useful before pull/push.                                          |
| Compare with merge base            | Useful for PR review.                                             |
| Repository graph artifact provider | VS Code exposes branches/tags/stashes/worktrees as SCM artifacts. |
| Multi-diff editor                  | Better review of many files than separate tabs.                   |

### Stash

| Feature                                        | Why It Matters                                  |
| ---------------------------------------------- | ----------------------------------------------- |
| Stash staged only                              | Lets users temporarily move just index changes. |
| Stash include untracked                        | Common work interruption flow.                  |
| Use commit input as stash message              | Reduces duplicate typing.                       |
| Prompt to save files before stash              | Prevents stashing stale disk state.             |
| Drop all stashes                               | Useful cleanup command.                         |
| Stash operations from editor/history artifacts | Keeps stash workflows contextual.               |

### Worktrees

| Feature                              | Why It Matters                                             |
| ------------------------------------ | ---------------------------------------------------------- |
| Detect worktrees with limits         | Supports modern multi-branch workflows safely.             |
| Create worktree                      | Lets users work on another branch without stashing.        |
| Open worktree in current/new window  | Good editor-level workflow.                                |
| Delete worktree                      | Completes the lifecycle.                                   |
| Migrate worktree changes             | Advanced but useful when moving changes between worktrees. |
| Include files when creating worktree | Helps copy local config files.                             |

### Decorations, Blame, And UI Polish

| Feature                                | Why It Matters                                     |
| -------------------------------------- | -------------------------------------------------- |
| Status bar branch/sync item            | Fast branch and sync visibility.                   |
| Count badge modes                      | Lets users choose all/tracked/off.                 |
| Inline open-file action                | Fast navigation from SCM list.                     |
| Reveal in file tree or OS file manager | Common context action.                             |
| Blame editor decoration templates      | Customizable inline blame display.                 |
| Blame status bar item template         | Lightweight blame without inline clutter.          |
| Ignore-whitespace blame option         | Cleaner blame for format-only changes.             |
| Reference details toggle               | Controls detail level in branch/tag/history lists. |
| Open/close all diff editors            | Helps keep review sessions tidy.                   |

## Suggested Platform Milestones

1. Close the high-value Zed panel/diff gaps:
   - Hunk and selected-range stage, unstage, restore.
   - Git panel tree view, status/path sorting, diff stats, conflict section.
   - Safer discard flows: tracked restore vs untracked trash.

2. Add Zed-level repository workflows:
   - Branch delete/rename, remote branches, remote selector.
   - Fetch from remote, pull rebase, push to remote, set upstream, force push.
   - Init and clone.

3. Add review/history features:
   - Git gutter.
   - Inline blame and full blame action.
   - File history and commit diff view.
   - Project Diff or multi-diff all-changes review.

4. Add interruption and recovery workflows:
   - Stash list/apply/pop/drop and stash diff.
   - Merge conflict region parsing and resolution buttons.
   - Uncommit/amend/signoff.

5. Add larger repo/platform features:
   - Multi-repository discovery and active repo selection.
   - Worktrees.
   - Commit graph and commit search.
   - Hosting providers, line permalinks, create pull request.
   - Askpass/auth integration.

6. Consider VS Code extras after Zed parity:
   - Sync/publish branch, fetch prune, push tags/follow-tags.
   - Smart commit, no-verify commit, commit validation, post-commit command.
   - Merge/rebase/cherry-pick commands and abort flows.
   - Source-control provider API.
   - Repository scan limits, progress/cancellation, and Git output logging.
