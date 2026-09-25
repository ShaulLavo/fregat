# Git

Status, stage and unstage, commit, push, pull, fetch, sync, pull request creation, and file diff views.

## Sub-features

Status list with tree dots, stage/unstage single and many, discard, commit with generated message, remote actions, compare with saved.

## How to get to it (user POV)

The Git side panel. Diff opens as an editor tab.

## Driving it with agent:browser

`bun run agent:browser scenario git-history` checks Changes collapse/reopen across refresh, Graph tab restoration, the selected commit, disclosure state, full-history search filtering and search restoration. It also measures commit-dot width and height in the sidebar and expanded graph, expands the graph, loads older commits, restores pages and scroll after refresh, searches an older commit by hash, clears search, restores a branch filter, and opens/reloads a historical file diff. Use a repository with commits that change files; 200+ commits exercises pagination and older-commit search.

Every git action is a `useMutation` with a key under `['git', 'mutation', ...]`; `caches` lists them with status while they run. History POST is a read through an infinite query. A mutation proof reads `git status --porcelain` in the workspace after the action.

## Gotchas

Commit runs hooks; a hook rejection is an expected outcome, not a transport fault. Stage and unstage are not optimistic on purpose.

Graph roots exclude `refs/platform/*`. A browsing session pins tips and ref labels until refresh. Merge file lists compare the first parent. History ends at shallow-clone boundaries. Search matches messages and authors case-insensitively as literal text, or a unique commit-ID prefix, across the full selected history. Filtered results omit ancestry lines. Branch/search selection, commit preview, expanded view, pages, scroll positions, and disclosure choices persist with the workspace. Historical diff URLs carry the explicit `historical` source and immutable blob IDs.

`git-history-search-no-flicker` types a commit search one key at a time and samples every frame. The step label must read `blank-frames-0`: the previous rows stay up until the new ones arrive, and the footer loader is the only sign of the wait.

`git-commit-hook-colors` commits in a fixture repository whose rejecting `pre-commit` hook prints truecolor, 16-color and 256-table SGR. The Commit output log must show no escape text and the colored spans must carry a computed color. The hook exits 1, so nothing is committed.

`git-commit-message-persists` types a commit message in a fixture repository, reloads the window and requires the same text back. The draft is stored per repository location and cleared by a successful commit.

`git-fix-with-agent` also resolves the failed hook with an external commit and requires the old output and failure notice to disappear. Editing the file before that commit must keep the output visible.

`git-fix-with-agent` types something into the open chat, fails a commit on a rejecting hook, presses Fix with AI and requires the failed step and the hook's output in the composer of a new chat, without the text typed earlier. The notice reads the newest git mutation from the mutation cache, so any failing step (stage, push, pull, sync) raises it and a retry clears it.

`git-commit-message-file` opens `COMMIT_EDITMSG` from an empty-message commit twice: Discard commit message in the editor title must close it with HEAD unchanged, and Accept commit message must save, close and leave HEAD carrying the typed subject. Closing the tab by hand commits the same way; a file left with only comment lines aborts.

`scenario git-stage-settles` builds a throwaway repository under `/work/tmp`, stages and unstages one file through the row buttons, and counts `/git/status` requests between the Stage click and the row appearing under Staged. The count must be zero: stage, unstage and discard settle the status query from the write's own response, and only discard reads status first (`admitDiscard` refuses it when the displayed changes are stale).

`scenario git-discard-confirm` discards in a fixture repository through the row button: the dialog must appear, Cancel must leave the file edited, Discard must restore it from HEAD, and an untracked file must ask to Delete and then be gone. Every Discard entry point (row button, group actions, file and group menus) goes through that one panel dialog. A rapid Stage → Unstage burst must leave the panel matching `git status --porcelain`. It never drives the dev workspace, where Stage would stage real work.

`git-commit-slow-hook` commits through a `pre-commit` hook that prints once and then stays silent for 35 seconds. It takes about 45 seconds and proves two things: hook-running git commands get the 15 minute limit rather than the 30 second local one, and the commit stream's reader skips the server's 15 second heartbeats.

`scenario git-changes-scroll` builds a 3,000-file fixture repository, wheel-scrolls the Changes list and prints rAF frame gaps (`idle` is the control) plus mounted rows, then requires a recycled row's Stage button to show its tooltip through the shared layer. Rows carry no per-row ticker, `Tooltip` root or query observer; those made scrolling lag.

`scenario git-open-all-diffs-spam` clicks Open all diffs eight times in a row on a six-file fixture. No error banner may appear and all six diff tabs must open: a superseded navigation must not abort the diff fetch the next one joined.

`scenario editor-press-participants` double-clicks a diff separator (the diff must stay unfocused and the label unselected), then Ctrl+clicks a call in the diff and in the editor and waits for the caret on the definition line. It fails when the editor ignores press participants.

`scenario git-diff-expand-tokens` samples every frame while unchanged context is expanded and collapsed in a TypeScript diff: no frame may show diff rows without syntax-token ranges. It cannot see an uncoloured frame between two layout effects, only a toggle that loses its tokens.

`scenario git-diff-inline-tint` opens a diff where one line becomes several and reads `CSS.highlights`: the word tint must be present on open, unchanged after a hide/unhide of unmodified lines, and never cover a whole added line.

`scenario git-diff-line-comment` presses the changed line of a diff and reads the selection bar: it must name that line, and still name it after unhiding the unmodified lines above has shifted every row.

`scenario git-diff-hover-tokens` hovers an identifier inside a diff pane and checks the hover's fenced code is painted with token colours: a diff lends its private syntax backend to the editor's snippet tokens, because the diff editor itself has no language.

`scenario chat-git-tab-switch` opens a file, enters chat mode and clicks Graph then Changes in the Git tool. The Git panel must stay: a panel change records the selected document in the address but must not set `tool: editor`, which only opening a document does.

`scenario chat-git-turn-rows` opens the chat Git tool and screenshots the Working tree and Turn scopes. Both draw `GitFileRow`: icon, name, directory, `+/-` counts and the status letter. It needs a selected session with a checkpointed turn.

`scenario git-submodules-init` declares a submodule in a fixture repository and deinitializes it, which is what `git worktree add` leaves. The Git panel must say `1 submodule is not initialized`; Initialize must check it out on disk and the notice must go. New session worktrees initialize submodules on their own per `git.worktreeSubmodules` (recursive by default, project override in `git.projectWorktreeSubmodules`); a failed clone keeps the worktree and leaves this notice as the retry.

`scenario git-auto-pull` turns on `git.autoPull` for the throwaway server, clones a fixture from a local bare remote and opens it. With an untracked file and a new upstream commit fetched, the panel must say `Auto-pull paused: uncommitted changes` and HEAD must not move. Removing the file must fast-forward HEAD to `origin/main`, and the header chip must drop its `↓` count without a refresh. The setting is restored afterwards.

`scenario git-merge-request` registers a fixture on a branch whose `origin` is `git@gitlab.com:fregat/fixture.git` (its remote-tracking ref made locally) and puts `scripts/agent/fixtures/fake-glab.mjs` first on the throwaway server's PATH. The stage header must offer `Merge request`; clicking it must call `glab mr create --source-branch feature/merge` and then show the `#5` link. Other forges are covered by `apps/server/src/git/tests/forges.test.ts` at the CLI/HTTP boundary.
