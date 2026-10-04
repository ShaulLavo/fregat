# Plan 244: Complete Git branch, remote and worktree workflows

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 241, Plan 239. Size: L. Triage: ZT-25.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Choose pull-with-rebase or guarded force push, open worktrees and delete selected branches or removable worktrees.

## Zed behavior

- `branch_picker::DeleteBranch` and `branch_picker::ForceDeleteBranch` delete the selected branch
  with ordinary or forced deletion. Zed distinguishes local and remote-tracking branches and
  select-only pickers. See `crates/git_ui/src/branch_picker.rs:420` and `:797`.
- `git::PullRebase` requests rebase pull; `git::ForcePush` invokes the push force variant.
  See `crates/git_ui/src/git_ui.rs:225` and `:241`, plus `crates/git_ui/src/git_panel.rs`.
- `git::Worktree` opens the worktree picker. `worktree_picker::DeleteWorktree` and
  `worktree_picker::ForceDeleteWorktree` remove its selected worktree, accounting for open
  workspaces and dirty-state force handling. See `crates/git_ui/src/git_ui.rs:132` and
  `crates/git_ui_core/src/worktree_picker.rs:464` and `:497`.

## Existing implementation

[GitService](../apps/server/src/git/service.ts) supports branch creation/switching, plain pull,
push with upstream setup, and pull-conflict reporting.
[Worktrees](../apps/server/src/git/worktrees.ts) already previews removals, verifies fingerprints,
and uses the common Git directory's mutation lane.
[Worktree fingerprint](../apps/server/src/git/utils/worktree-fingerprint.ts) captures removal
identity. [Project worktree menu](../apps/web/src/features/workbench/utils/project-menu-worktrees.ts)
and the chat-mode worktree manager own existing entry points. Editor is a consumer of open
file documents; branch/worktree operations belong to Fregat.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Add typed branch delete, pull-rebase, force-push, and worktree-picker commands to the
  catalog/table. Plan 206 presets own Workspace/Git, `GitBranchSelector`, and `WorktreePicker`
  bindings, including nested picker editor contexts.
- Carry machine, repository, branch/ref identity, and expected revision through mutation
  admission. Ordinary delete preserves Git's merged-branch checks. Force delete is an explicit
  separate intent. Remote-tracking deletion names that local ref and does not silently delete
  an upstream branch.
- Extend pull with a typed rebase mode. Extend push with explicit force intent, remote target,
  and expected remote OID. Use `--force-with-lease` as Fregat's documented guarded force policy;
  expose stale-lease rejection and preserve conflict/rebase state in the result.
- Reuse worktree removal previews and fingerprints for both variants. Show path and affected
  sessions/documents before forced removal; reject active leases and the main worktree. Do not
  automatically escalate ordinary deletion into force.
- Serialize repository effects, settle branches/status/history/worktrees and filesystem views
  before mutations resolve, and route navigation through the project owner from Plan 239.
  Build the picker with shared listbox, dialog, and pending/error primitives.

## Steps

- [ ] Add failing delete/rebase/lease tests using owned temporary repositories and bare remotes.
- [ ] Extend contracts and service operations, preserving expected identities and conflict state.
- [ ] Wire branch actions and worktree picker to existing preview/removal owners.
- [ ] Settle affected caches and invalidate closed worktree documents through their owners.
- [ ] Register scoped preset rows and add `git-branch-worktree-lifecycle` scenario and selectors.

## Acceptance

Run focused Git branch/push/pull tests and `apps/server/src/git/tests/worktrees.test.ts`.
Cover current/unmerged branches, local remote-tracking refs, detached HEAD, rebase conflict,
stale leases, dirty or busy worktrees, and changed preview fingerprints. Use local bare remotes,
never a hosted account. `git-branch-worktree-lifecycle` opens the picker, exercises ordinary
refusals and explicit force confirmations, and verifies selection/cache settlement after success.
Destructive fixtures live only in owned scratch directories.

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

Unconditional force push, remote branch deletion by a local-ref action, SSH account setup,
and deleting another session's checkout.
