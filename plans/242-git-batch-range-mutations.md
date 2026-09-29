# Plan 242: Complete batch, range and next-change Git mutations

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 206, Plan 241. Size: L. Triage: ZT-23.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Stage or unstage selections and hunks, advance after acting, restore tracked changes and trash untracked files.

## Zed behavior

- `git::StageAll` and `git::UnstageAll` act on the active repository. `git::ToggleStaged` uses
  the focused entry or selected editor hunks. `git::StageRange` stages or unstages the changes
  list interval between its staging anchor and selected entry, skipping unresolved conflicts. See
  `crates/git_ui/src/git_panel.rs:3079`, `:3195`, `:3483`, and `:8932`.
- `git::Restore` restores selected editor hunks. `git::StageAndNext`, `git::UnstageAndNext`,
  and `git::RestoreAndNext` act on those hunks and navigate onward. Restore-and-next wraps when
  all hunks are not expanded. See `crates/editor/src/git.rs:883` and `:1613`.
- `git::RestoreTrackedFiles` reverts tracked entries in the current directory context or
  repository. `git::TrashUntrackedFiles` handles untracked entries through a destructive prompt.
  See `crates/git_ui/src/git_panel.rs:2951` and `:3002`.

## Existing implementation

[GitService](../apps/server/src/git/service.ts) has path-batch stage/unstage, discard,
`applyPatch`, and `patchApplies`. Its discard path also runs `git clean`; it cannot implement
tracked restore and untracked trash as one operation.
[useIndexMutation](../apps/web/src/features/git/hooks/use-index-mutation.ts) serializes writes
per repository and settles status. [Diff line selection](../apps/web/src/features/git/utils/diff-line-selection.ts)
preserves old/new addresses across projections. Editor supplies diff rows and region expansion
in `/work/projects/Editor/packages/diff/src/editorDiffPlugin.ts` and `regions.ts`, but those
APIs do not build a selected patch. After Plan 207, extend `editor/packages/diff/`.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Add catalog commands and typed targets for repository batches, changes-list intervals,
  files, and hunks. Keep Zed's StageRange list semantics explicit. Plan 206 presets activate
  `Git > ChangesList` and `Editor`/`GitDiff > Editor` contexts, with agent-review restrictions.
- Resolve selection into repository, source side, object IDs, and hunk addresses before writing.
  Editor packages own projection and selected-hunk geometry. Fregat owns filesystem and index
  effects. Save dirty buffers through their document owner before deriving an index patch.
- Build partial patches from authoritative hunks, including deletion-only and addition-only
  ranges. Preflight the exact source version under the server repository lane. Reject a stale
  target with a structured error and refresh the view.
- Keep tracked restore, index changes, and untracked trash distinct in contracts. Reuse removal
  admission for confirmed path sets. Implement trash through the machine's recoverable-trash
  owner and report unsupported storage explicitly.
- Settle status, diff, and changed file documents before resolving the TanStack mutation.
  Advance by surviving hunk/path identity after settlement, only on success. Selection and
  mutation failure stay visible.

## Steps

- [ ] Add failing real temporary-repository tests for batch and partial-hunk targets.
- [ ] Add target contracts and Editor selected-hunk/patch primitives under `editor/packages/diff/`.
- [ ] Split tracked restore and untracked trash from discard, with fresh path admission.
- [ ] Implement serialized mutations, settlement, list interval anchors, and next-change targeting.
- [ ] Register commands/preset rows and add `git-range-mutations` scenario and selectors.

## Acceptance

Run focused Git service patch tests, Editor patch fixtures, and Git mutation settlement tests.
Cover mixed staged/unstaged edits, adjacent hunks, empty HEAD, renames, binaries, stale objects,
and a queued mutation after the first changes status. Unsupported partial targets fail explicitly.
`git-range-mutations` stages a list interval, toggles selected hunks, exercises each next variant,
and confirms tracked restore and untracked trash against an owned fixture repository. Unselected
content and index entries retain their exact bytes.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run deploy` or `bun run deploy --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Branch-wide reset, agent edit acceptance, stash operations, and modifications to the shared checkout.
