# Plan 245: Add a stash picker and stash lifecycle

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 241, Plan 243. Size: L. Triage: ZT-26.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Inspect, apply, pop or drop a selected stash in the current repository.

## Zed behavior

- `git_picker::ActivateStashTab` selects the stash picker tab.
  `stash_picker::ShowStashItem` opens the selected stash commit/diff; `stash_picker::DropStashItem`
  drops that selected entry. See `crates/git_ui/src/git_picker.rs` and
  `crates/git_ui/src/stash_picker.rs:168` and `:317`.
- `git::ApplyCurrentStash`, `git::PopCurrentStash`, and `git::DropCurrentStash` target the stash
  represented by the focused stash diff. Apply retains it; pop removes it on successful apply;
  drop deletes its reference. See `crates/git_ui/src/commit_view.rs` and
  `crates/git_ui/src/stash_picker.rs:298`, `:337`, and `:353`.

## Existing implementation

[GitService](../apps/server/src/git/service.ts) has repository status and object/diff reads;
no stash service or picker was found under `apps/server/src/git/` and
`apps/web/src/features/git/`. [Document types](../apps/web/src/lib/documents/utils/types.ts)
and Plan 243's review controller can represent a stash comparison.
[Git mutation keys](../apps/web/src/features/git/utils/mutation-keys.ts) and
[status settlement](../apps/web/src/features/git/utils/settle-status.ts) provide existing
ownership. Editor's `/work/projects/Editor/packages/diff/src/editorDiffPlugin.ts` renders the
comparison; stash lifecycle remains with Fregat after Plan 207.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Add stash list/detail queries, lifecycle mutations, and catalog/table commands. Plan 206
  preset data enables `GitPicker`, `StashList`, and `StashDiff > Editor` bindings once those
  contexts exist. Picker actions and diff actions resolve their own selected stash.
- Model stash identity as repository plus commit OID and captured reflog identity. A list index
  is display data. Re-resolve the entry under the repository mutation lane before pop/drop and
  reject a changed identity, including duplicate OIDs at different reflog entries.
- Represent stash content as worktree, index-parent, and untracked-parent comparisons. Reuse
  Plan 243's read-only review controller with an explicit stash owner. Preserve the selected
  entry and whole diff while a new detail query loads.
- Apply/pop report conflict state and settle status/files/diff caches on partial application.
  Pop retains the stash when apply fails. Drop has an explicit confirmation; retry cannot
  delete the next reflog entry after renumbering.
- Reads and effects use TanStack with per-feature keys and serialized scope. Add structured
  errors and shared picker/loading primitives. Define cache settlement before resolving.

## Steps

- [ ] Add failing list/detail/apply/pop/drop tests in real owned temporary repositories.
- [ ] Add contracts and server operations with stable reflog admission and conflict results.
- [ ] Add stash tab, selection owner, and comparison document integration.
- [ ] Wire mutations, confirmations, settlement, commands, and scoped preset rows.
- [ ] Add `git-stash-lifecycle` scenario and selectors.

## Acceptance

Run the new focused stash service and Git mutation tests. Cover index and untracked parents,
apply conflicts, failed pop retaining the entry, concurrent reflog insertion/drop, duplicate OIDs,
and retry after a completed drop. `git-stash-lifecycle` selects two seeded stashes, shows each
diff, applies one, pops another, and cancels then confirms drop. Verify repository selection and
shown stash identity throughout.

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

Automatic stashing during pull, stash creation UI, provider-generated stash messages, and
using the shared checkout as a fixture.
