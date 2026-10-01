# Git panel and commit graph

Requested scope: compare the local VS Code checkout with Platform, plan the improvements, then implement. Commit history with a branch and merge graph is the first priority.

## Work checklist

- [x] Ground: trace both implementations and record the current gaps.
- [x] Sketch: compare two graph designs and choose the data and UI boundaries.
- [x] Agree: record the chosen scope here and proceed under the user's implementation request.
- [x] Implement: history reads, graph, filters, commit inspection, and historical diffs.
- [x] Verify: real Git fixtures, focused checks, and the running app with screenshots.
- [x] Ship: deploy the verified change to the mesh and record the served release.
- [x] Review: remove any design scaffolding that implementation made obsolete.

## Research baseline

Platform checkout: `ca707eebeab6c3bba6d116e30e55f91ef56731d5`.
VS Code reference: `/work/projects/references/vscode`, commit `73e2745dc724f41e589bc387d18281cff82f144a`.

The earlier `docs/git-feature-comparison.md` includes historical gaps. This plan will distinguish those from features present in the current source.

Research and design completed before source changes. Implementation follows the scope and checks below.

## Current comparison

| Capability                                                            | Platform today                                         | VS Code source                                                 | Decision                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stage/unstage/discard and commit                                      | Present, including patch APIs and streamed hook output | `scmViewPane.ts`, Git commands                                 | Keep the existing Changes workflow                                               |
| Branch checkout/create and fetch/pull/push/sync                       | Present                                                | Git extension commands                                         | Keep; the older comparison incorrectly treats some as missing                    |
| Commit graph                                                          | Absent                                                 | `scm/browser/scmHistory.ts:292`                                | Implement now                                                                    |
| Paged history pinned to revisions                                     | Absent                                                 | `scmHistoryViewPane.ts:1258`, `extensions/git/src/git.ts:1444` | Implement now, topological order and lookahead exhaustion                        |
| All/current/selected reference history                                | Absent                                                 | `scmHistoryViewPane.ts:1394`                                   | Implement all public refs, HEAD, and individual branch/tag selection             |
| Commit metadata and ref labels                                        | Absent                                                 | `scm/common/history.ts:77`                                     | Subject, author/date, full message, parents, HEAD/branch/tag labels              |
| Commit files and historical diffs                                     | Blob renderer exists, history entry point absent       | `extensions/git/src/historyProvider.ts:339`                    | Lazy file metadata and existing blob diff editor                                 |
| Refresh, current commit, copy identifiers                             | History actions absent                                 | `scmHistoryViewPane.ts:209`, Git extension `package.json`      | Implement graph actions and copy SHA/message                                     |
| History search                                                        | Absent                                                 | Provider supports search; graph tree matches loaded labels     | Search full selected history on the server; filter matching rows                 |
| Incoming/outgoing graph decorations                                   | Remote counts exist, graph absent                      | `scmHistory.ts:420`                                            | Follow-up after ordinary graph topology is verified                              |
| Stash, amend/undo, merge/rebase/cherry-pick, arbitrary commit compare | No complete panel workflows                            | Git extension commands/artifact menus                          | Follow-up milestones; each needs operation-specific recovery and confirmation UX |

## Grounded ownership and runtime flow

`Panel` -> `useStatus` -> environment-owned TanStack client -> `/git/status` -> `GitService`. Git mutations and workspace events invalidate `gitKeys.all`. Add history keys beneath that existing family. History reads use a separate `GitHistory` reader over `repositoryRunner`, which already enforces workspace containment and command time/output budgets. Do not add history state to `GitService`.

Historical files reuse `navigation.openContent` and a blob-backed `git-diff` snapshot. Add an explicit `historical` snapshot source to the document type, persistence codec and address codec. An omitted source currently serializes as `worktree`, which would misclassify a reopened historical diff.

## Chosen design and caller usage

```ts
const history = useHistory(rootPath, ref)
// ref is all public refs, HEAD, or one fully qualified branch/tag.
history.fetchNextPage()
const details = useCommitDetails(rootPath, selectedCommit)
openHistoricalDiff(details.data.files[0])
```

The server exposes two reads. `POST /git/history` is a TanStack infinite query with a validated structured cursor, and `GET /git/history/commit` reads one immutable commit. A read stays a query even when POST carries its body.

```ts
type HistoryCursor = { tips: readonly string[]; skip: number }
type HistoryCommit = {
  id: string; parents: readonly string[]; subject: string
  author: string; authorEmail: string; timestamp: number
}
type HistoryRef = { name: string; kind: 'branch' | 'remote' | 'tag' | 'head'; commitId: string }
type HistoryPage = {
  commits: readonly HistoryCommit[]; refs: readonly HistoryRef[]
  next: HistoryCursor | null
}
// Details return full metadata and file status/path/blob pairs, without eagerly reading file text.
readPage(request): Promise<HistoryPage>
readCommit(request): Promise<CommitDetails>
layoutHistory(commits: readonly HistoryCommit[]): readonly GraphRow[]
```

Enumerate only local branches, remote-tracking branches, tags and HEAD. Peel annotated tags; omit tags that name non-commit objects. Never use `--all`: it includes Platform's private checkpoint refs. Pin unique commit tips on the first page, then replay `git log --topo-order` with the same tips and increasing skip. Request one extra record to distinguish exhaustion from a full page. Refresh starts a fresh walk. Commands accept roots through stdin so a large ref set does not become a huge argv list.

The browser derives lanes from commit parent IDs. Every row retains incoming and outgoing lanes; roots remove only their own lane. A loaded prefix has stable geometry when another page is appended. SVG uses graph lane tokens derived from the active theme colors, with no graph library or new dependency. Virtualize rows with the installed TanStack Virtual.

Use a Graph view beside Changes. Keep commit files in a separate details region so expanding a commit cannot break vertical lane continuity. Expand presents the same selection and filters in a wide opaque dialog, with details beside the graph. Narrow mode puts details below it. The graph follows the existing density, bar, type, border and loading tokens.

## Synthesis

Candidate A is the base: raw commit pages with browser layout. Candidate B puts layout on the server and carries signed lane/ref state in continuation tokens. That adds cursor lifecycle and authentication machinery for a read-only view. Both designs agree on pinned public roots, topological order, lazy blob details and editor reuse. Take B's explicit individual-ref filter and disconnected-root acceptance case. Keep cursor validation at the server boundary; do not transmit or trust client-supplied graph geometry.

We accept repeated traversal for deep skip offsets in exchange for no server browse sessions. Page responses and command resources are bounded; the entire repository is never loaded before showing the first page. Commits in shallow clones are limited to locally available history. Merge details compare the first parent and name that choice. Incoming/outgoing pseudo-nodes and repository-changing context actions remain separate follow-ups. Full-history search is implemented in the follow-up below.

The independent cross-judge also selected A, scoring it 28/30 against B at 24/30. Reference decorations stay in the first page and do not silently change during continuation requests.

## Implementation units and acceptance checks

1. Contracts, reader and routes. Real Git fixtures verify merges, first/root commits, detached HEAD, annotated tags, hidden checkpoints, renamed/deleted paths, invalid refs/cursors and page stability when refs move.
2. Pure lane layout. Verify linear, split/merge, octopus merge, disconnected roots, shallow boundaries and page-prefix continuity.
3. History UI and historical documents. Verify loading/empty/error/retry states; keyboard selection; branch/tag filters; loaded-commit find; load more; commit files; historical source roundtrips and blob IDs surviving URL reload.
4. Add `git-history` scenario and feature-map entry. Drive the real Git panel, graph, expanded view, filtering, paging and file diff; inspect screenshots and logs.
5. Run focused types/lint/design checks and deploy with the server bundle, then verify `/platform/release`. Server deployment restarts the production process as required for the new routes.

## Follow-up order

1. Arbitrary commit comparison and incoming/outgoing graph markers.
2. Stash list and inspect/apply/pop/drop workflows.
3. Amend/undo commit and branch rename/delete.
4. Merge/rebase/cherry-pick with explicit abort and conflict recovery.

Each follow-up should use this graph's immutable commit/file model rather than introduce another history or diff implementation.

## Verification record

Implemented the first milestone. The focused node run passed 50 tests across history API, graph layout, and address tokens. A later API rerun also covered nested annotated tags whose intermediate tag ref was deleted. Web, server and scripts typechecks passed. Focused lint and the web design census passed without new exceptions.

The running development API predates `/git/history`, so verification used the mesh production build through the repository CLI. The dev server was not restarted. The first browser runs caught a missing command-palette prefix in the scenario and a workbench route validator that still rejected historical sources. Both were corrected before the successful run.

Successful real-repository scenario: `/work/tmp/fregat-evidence/20260914T134328Z-scenario-git-history/`. Inspected the sidebar graph, expanded dialog, commit details, historical diff, and reloaded diff screenshots. The run loaded 200 commits and exercised keyboard navigation, loaded-commit find and current-branch filtering. No failed requests, page errors or Git warnings appeared. Chromium reported its existing GPU adapter/ReadPixels warnings.

The verification skill was renamed to `verify-fregat` by concurrent repository work during this task. The new scenario and Git feature-map entry use that current location. Changes from that work were preserved.

Initial live release with all server fixes: `20260914T134237Z-8d098706-git-history`. The final release is recorded below.

The saved-tab codec also preserves historical sources and blob IDs. A further real-Git regression reproduced a 500 when opening a historical file whose whole directory had since been removed. Repository discovery now climbs to an existing directory while preserving permission failures. The six history API tests and three existing Git API tests passed after the fix. This closes a required path for browsing older commits, rather than adding a second diff implementation.

Final release: `20260914T134729Z-11a71118-git-history`, confirmed by `/platform/release` for both web and server. The mesh live check passed. The final `git-history` browser run completed all nine steps at `/work/tmp/fregat-evidence/20260914T134807Z-scenario-git-history/`; screenshots were inspected. No page errors, failed requests, or warning/error log events occurred. The only browser warnings were the existing unavailable GPU adapter and ReadPixels messages. All work checklist items above are complete; follow-up milestones remain explicitly separate.

## File-row and preview follow-up

Kept the Changes/Graph tabs and the collapsible Changes sections, per the revised request. The selected commit preview now appears above the sidebar graph; the expanded graph keeps its side-by-side layout. Historical changed files and working changes share `FileRow`, including file-type icons, density, path labels, status placement, and keyboard activation. `ChangeFileRow` supplies the working-tree actions and context menu. The separate historical row renderer was deleted.

The browser scenario now checks collapse/reopen, preview placement, shared file rows, and keyboard opening of historical diffs. Long commit messages are scrolled to expose the changed files in a separate evidence screenshot.

Follow-up verification passed web and scripts typechecks, focused lint, design census, and the mesh live check. Release `20260914T140951Z-66f3e1d8-git-file-rows` reuses the running server bundle. The eleven-step scenario completed at `/work/tmp/fregat-evidence/20260914T141018Z-scenario-git-history/`; screenshots were inspected, with no page errors, failed requests, or Git warning/error logs. Browser warnings were the existing GPU adapter/ReadPixels messages.

## Remembered Git panel state

The selected Changes/Graph tab and the commit-information collapse choice now live in the existing per-workspace layout cache, scoped by environment. The commit hash is the disclosure control; collapsing it hides the description, author, date, parents, and copy-message action while leaving changed files available. New commit selections use the remembered choice.

Reproduced the refresh reset before changing the UI at `/work/tmp/fregat-evidence/20260914T145658Z-scenario-git-history/`. The fixed panel cache round-trip test, web/scripts typechecks, focused lint, and design census passed. Release `20260914T145905Z-a9783491-git-panel-state` passed the mesh live check without restarting the server. The fourteen-step browser scenario passed at `/work/tmp/fregat-evidence/20260914T145922Z-scenario-git-history/`; inspected the restored Graph tab and collapsed commit information screenshots. No page errors, failed requests, or Git warning/error logs occurred.

## Full-history search and graph restoration

The initial persistence fix saved only the tab and information disclosure. Graph navigation now belongs to the workspace layout too: reference, search text, selected commit, expanded view, page count, graph scroll and details scroll. Changes group disclosure also uses the workspace cache. Reload fetches the saved number of pages before restoring the graph position. Commit details still load directly by immutable commit ID.

Search replaces the loaded-row finder with server queries over the selected public history. Git matches literal, case-insensitive message text and author identity; a unique commit-ID prefix is resolved only if reachable from the selected history. Matching IDs are combined, deduplicated and paginated in commit-date order. Filtered rows preserve their real parents for inspection but draw no ancestry lines through omitted commits. Clearing search restores the normal graph. Search reads still use the existing Git process byte/time limits and TanStack query cancellation; a limit is an error rather than a partial-success result.

The browser reproduction at `/work/tmp/fregat-evidence/20260914T151347Z-scenario-git-history/` confirmed the old search left unrelated rows visible. Real-Git tests now cover matches older than the first page, message bodies, literal punctuation, author and commit-ID search, branch scope, hidden private refs, and pagination while refs move. The search pagination test caught Git's argument-order behavior: `--max-count` enables traversal, so `--no-walk` must follow it. The fix was verified against real Git. Cache tests round-trip the complete graph state.

Full-history follow-up verification: 31 focused tests passed across the history API, graph layout, and workspace-cache files. Web and server typechecks, focused lint, and design census passed. The scripts typecheck is blocked by unrelated DOM typing errors in the concurrently edited `scripts/agent/tree-occlusion.ts`; it reports no Git scenario errors.

The browser caught a scroll-restoration mismatch caused by using 24-pixel estimates for compact 20-pixel rows. The graph now uses the boot-aware density setting for fixed row geometry. The final nineteen-step scenario also types the query character by character, restores a selected search result, restores 200 loaded commits and their scroll position, finds an older commit by hash, clears the search and restores the cached pages, and restores Current branch in the expanded graph. Evidence: `/work/tmp/fregat-evidence/20260914T152637Z-scenario-git-history/`. Inspected search, cleared-search, and branch-restoration screenshots. No page errors, failed requests, or Git warning/error logs occurred; browser warnings were the existing GPU adapter/ReadPixels messages.

Final web release: `20260914T152510Z-6ce0470f-git-history-search`. Running server release: `20260914T152127Z-6ce0470f-git-history-search`. Both are confirmed by `/platform/release`; mesh live checks passed.

## Circular commit markers

Reproduced compact-row distortion: the 10-pixel HEAD marker rendered at 10 × 8.33 pixels because the whole SVG scaled from 24 to 20 pixels high. Only the connecting paths now use the stretching viewBox. Commit circles render in viewport coordinates, centered at 50% of row height, so their horizontal and vertical radii stay equal.

Web typecheck/build, focused lint, and mesh live check passed. The Git scenario now measures dot width and height in the sidebar and expanded graph. It failed before the fix at `/work/tmp/fregat-evidence/20260914T162659Z-scenario-git-history/` and passed all nineteen steps afterward at `/work/tmp/fregat-evidence/20260914T162805Z-scenario-git-history/`. Both graph screenshots were inspected. No page errors, failed requests, or Git warning/error logs occurred. Live web release: `20260914T162746Z-62db0266-git-graph-circles`; the server was reused without restarting.
