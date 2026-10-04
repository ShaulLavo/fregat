# Plan 240: Expose remote project opening and worktree trust

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 239. Size: M. Triage: ZT-21.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Open a project on a configured remote machine and manage execution trust for its checkout.

## Zed behavior

- `projects::OpenRemote` opens the remote-project chooser. Its `from_existing_connection`
  payload selects the active connection or the server chooser. Preserve both translated
  variants. See `crates/recent_projects/src/recent_projects.rs:486` and
  `crates/recent_projects/src/remote_connections.rs:128`.
- `workspace::ToggleWorktreeSecurity` opens the worktree trust dialog. It lists restricted
  paths and supports trusting a checkout or a parent directory, keyed by remote host.
  See `crates/workspace/src/workspace.rs:8242` and `crates/workspace/src/security_modal.rs:309`.

## Existing implementation

[ProjectPicker](../apps/web/src/features/environments/components/project-picker.tsx) already
chooses a connected machine and opens its folder picker through that machine's query client.
[PickerDialog](../apps/web/src/features/environments/components/picker-dialog.tsx) trusts machine
identity through `connections.trustMachine`. [Environment commands](../packages/client-core/src/commands/environment.ts)
cover connection and switching. Checkout preparation has an
[execution gate](../apps/server/src/orchestration/worktree-execution-gate.ts) and a
[setup runner](../apps/server/src/orchestration/setup-runner.ts), but neither establishes a
repository trust policy. Editor currently has document sessions in
`/work/projects/Editor/packages/editor/src/documentSession.ts`; trust decisions belong to the
Fregat server.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Add typed `project.openRemote` and `workspace.openWorktreeSecurity` commands to the command
  table. Publish `Workspace` and remote-picker contexts. Plan 206 preset data owns bindings,
  including the existing-connection payload.
- Reuse the environment connection and project-opening owners. Carry machine identity and
  canonical root together through picker selection, navigation, queries, and mutations.
- Add a server-owned trust record keyed by machine identity and canonical checkout or explicit
  parent scope. A connection identity change requires fresh checkout trust. Opening and reading
  remain available while restricted.
- Enforce trust at execution boundaries for repository configuration that starts setup tasks,
  language servers, or repository-selected binaries. Inventory those boundaries before wiring
  the dialog. Host-selected actions and agent access permissions retain their existing owners.
- Register execution-affecting policy in `packages/contracts/src/settings/keys.ts` at application
  or machine scope. Keep trust grants in host-owned data. Use TanStack ownership and feature
  keys for asynchronous changes, structured errors, and shared dialog/list primitives.

## Steps

- [ ] Add a failing command test for both OpenRemote payloads against two fixture machines.
- [ ] Inventory execution entry points and add trust contracts, persistence, and boundary tests.
- [ ] Wire remote opening through the existing picker and navigation owners.
- [ ] Implement the security dialog, explicit parent grants, revocation, and identity-change handling.
- [ ] Register commands, contexts, preset rows, and any settings. Run `bun run settings:reference`.
- [ ] Add `remote-project-trust` under `scripts/agent/scenarios/` and selectors in
      `scripts/agent/selectors.ts`.

## Acceptance

Run the focused environment command tests and execution-boundary tests. Extend
`apps/web/src/features/environments/tests/project-machine-picker.test.tsx` to prove identical
paths on different machines stay distinct. The `remote-project-trust` scenario opens a fixture
remote folder, grants and revokes checkout trust, and verifies repository-selected execution
is refused after revocation while browsing still works. A changed machine identity cannot
reuse the old grant.

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

Zed cloud accounts, SSH provisioning, a new remote transport, and Editor-owned trust UI.
