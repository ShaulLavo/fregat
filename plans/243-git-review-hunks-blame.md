# Plan 243: Complete repository review, hunk navigation and blame

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206, Plan 241, Plan 229 for the single multi-file review projection. Size: L. Triage: ZT-24.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Open repository changes, start an agent review of a branch diff, expand or toggle hunks, visit edit locations, and inspect line blame.

## Zed behavior

- `git::Diff` opens the configured repository or branch diff. `git::OpenModifiedFiles` opens
  changed source files. See `crates/git_ui/src/project_diff.rs:117` and
  `crates/git_ui/src/git_ui.rs:331`.
- `git::ReviewDiff` computes a merge-base branch diff and starts an agent thread with the diff
  attached and the review prompt submitted. It declines outside a merge-base comparison.
  See `crates/git_ui/src/branch_diff.rs:391` and `crates/agent_ui/src/agent_panel.rs:542`.
- `editor::GoToHunk` and `editor::GoToPreviousHunk` navigate diff hunks.
  `editor::ExpandAllDiffHunks` expands all regions and `editor::ToggleSelectedDiffHunks` toggles
  regions intersecting selections. See `crates/editor/src/git.rs:513`, `:546`, and `:1006`.
- `editor::GoToNextChange` and `editor::GoToPreviousChange` navigate the editor's edit-location
  change list. They restore stored selection anchors. See `crates/editor/src/navigation.rs:1639`.
- `git::Blame` toggles inline file blame; `editor::BlameHover` opens blame for the cursor's line.
  See `crates/editor/src/git.rs`, including `:790`.

## Existing implementation

[Document types](../apps/web/src/lib/documents/utils/types.ts) carry `GitComparison` identities.
[Diff queries](../apps/web/src/features/git/utils/diff-query.ts) and
[diff presentation](../apps/web/src/features/git/utils/diff-presentation.ts) serve existing review
views. [Turn diff view](../apps/web/src/features/chat/utils/turn-diff-view.ts) serves checkpoint
reviews. [GitService](../apps/server/src/git/service.ts) reads diffs and object content; no blame
operation was found. Editor has `createDiffRegionStore` in
`/work/projects/Editor/packages/diff/src/regions.ts` and document change subscriptions in
`/work/projects/Editor/packages/editor/src/documentSession.ts`; no edit-location change-list owner
was found. Extend these as `editor/packages/diff/` and `editor/packages/editor/` after Plan 207.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Register commands in the catalog/table. Bind them as Plan 206 preset data in `Editor`,
  `GitDiff`, `GitReview`, and Git contexts. Change-list commands target the focused view's
  document, independently of Git status.
- Extend typed comparison documents to represent repository review and file identities. Reuse
  the current diff controller. Use Plan 229's multibuffer owner when available for Zed's single
  multi-file projection; repository-list navigation remains useful before that integration.
- Route branch review through the existing session/composer mutation owner with repository,
  base ref, and captured diff revision. Attach the diff and submit the review request once.
  Cross-feature orchestration belongs in keymap/shared domain owners. Tests use mock providers.
- Editor owns hunk navigation, expansion, and edit-location anchors. Record local edits and
  map anchors through later transactions. Walking the change list changes selection and scroll
  without changing text or consuming undo history.
- Add machine/repository/path/revision-scoped blame queries and structured server errors.
  Parse porcelain records into typed line ranges and commit metadata, including uncommitted
  lines. Editor exposes gutter/hover contributions; Fregat supplies Git data and opens commits.
- Retain the old complete comparison while a new revision loads. Preserve source-side hunk
  identity on refresh. Shared loading, focus, hover, and error-boundary rules apply.

## Steps

- [ ] Reproduce missing hunk/change-list/blame commands with focused failing tests.
- [ ] Extend comparison identity and wire repository diff/open-modified commands and agent branch review.
- [ ] Add Editor hunk actions and per-document edit-location tracking.
- [ ] Add blame contract/service/query and inline/hover contributions.
- [ ] Register scoped preset rows and add `git-review-navigation` scenario and selectors.
- [ ] Integrate the single multi-file review projection after Plan 229.

## Acceptance

Run Editor hunk/change-list fixtures and a real temporary-repository blame test with uncommitted,
renamed, and Unicode lines. Hunk navigation survives refreshed diffs; edit-location navigation
works in a clean repository and preserves undo. `git-review-navigation` opens repository changes,
opens modified files, launches a fixture-agent branch review with one submission, toggles/expands
hunks, visits edits, and inspects inline/hover blame. Switch
repositories during an outstanding blame request and verify the response cannot repaint the new file.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run install-release` or `bun run install-release --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Staging and restoring, review-comment backend expansion, and Git-history navigation disguised as
editor change history.
