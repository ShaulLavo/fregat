# Plan 315: choose the machine before the first folder

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #375](https://github.com/ShaulLavo/fregat/issues/375). Fregat owns the web flow shared by the installed app. The owner chose the design on 2026-10-08 (below); UI implementation follows that choice.

## Owner's choice (2026-10-08)

The owner reviewed four first-run mocks next to screenshots of today's screens. The mocks were published as a private, short-lived review app; their source and the research behind them stay in the owner's local reports folder, outside the repository. Mocks A1 and A2 covered the first launch on this machine; B1 and B2 covered an unpaired device, which [Plan 337](337-device-pairing.md) now owns.

The owner chose a combination of A1 and A2:

- The app opens on an empty chat: A2's "What should we work on?" composer, in the background.
- A dialog styled like A1 sits over it. It offers two paths: **choose a folder on this machine**, or **connect a remote machine and choose a folder there**.
- The dialog offers no chat-only or file-only start. Every session needs a project.
- After a folder is chosen, the dialog closes and the person is in the chat for that project, on the machine that holds it.

## Outcome

A fresh installation offers a local folder path and a remote-machine path before assuming where the workspace lives. Each path ends with a workspace open on the chosen machine. A person who works remotely can connect first without selecting a local folder.

## Current evidence

The owner observed the folder-only screen in the macOS app at `29b9c749e`. Current Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb` still renders [EmptyWorkspace](../apps/web/src/components/empty-workspace.tsx) with one **Choose folder** action. [AppWorkspace](../apps/web/src/components/app-workspace.tsx) chooses between `usePickEntry` and `ProjectPicker` according to connected machines and current origin. It does not expose adding the first remote machine in that empty state.

[MachineForm](../apps/web/src/components/machine-form.tsx) already connects an SSH target or server URL. [ProjectPicker](../apps/web/src/features/environments/components/project-picker.tsx) opens the in-app filesystem picker with the chosen machine's query client. [Plan 114](114-installed-app.md)'s picker machine policy requires verified local-desktop capability for native choosers. A remote browser's machine and its primary server may differ. A server URL does not establish locality.

Reuse the implemented [environment strategy](environments-and-remote-plan.md). [Plan 240](240-remote-project-trust.md) owns checkout execution trust. [Plan 290](290-mesh-device-authorization.md) owns authorization for Mesh control; onboarding cannot grant Mesh access by discovering a reachable host.

## Flow and ownership

The first-launch dialog is one flow with explicit states: choose a path, connect a machine (remote path only), authenticate, choose its folder, open the project's chat, and recoverable failure. The empty chat behind the dialog is the ordinary new-chat view; it does not accept a message until a project is open. Closing or cancelling the dialog leaves it reachable from the empty chat, never a chat with no project.

Connection phase stays with `createEnvironmentConnections`. Folder reads and opening use the selected machine's client and scoped identity. The dialog owns only its step and draft selection.

**This machine.** Use the native chooser when the app and selected server are verifiably on the same machine and that server advertises an available desktop helper. Otherwise use the in-app filesystem picker and name the machine whose files it lists. In a remote browser, do not label server files as files on the viewing phone or laptop. Browser-local handle workspaces require another filesystem design and are outside this plan.

**A remote machine.** Supports the existing SSH and HTTPS server forms, including an authorized Mesh-host server URL. After connection confirms identity, choose a folder on that host through the in-app picker. Keep credentials in their existing owner. Cancellation preserves a deliberately saved machine but opens no project. A failed connection keeps an editable draft and an actionable error. Identity drift requires the established trust flow.

The dialog appears after restoration completes with no open workspace. Do not replace a restoring workspace with onboarding, reset settings, or erase recent projects. A later empty workspace shows the same two actions without replaying a first-launch ceremony.

## Execution checklist

- [x] Reproduce a fresh state home in web and the installed macOS app. Inspect existing connected machines, picker locality, cancellation, and the remote folder-open path.
- [x] Make two or three materially different mocks of the first screen and connection-to-folder sequence. Include narrow phone layout, fresh desktop, remote-browser target naming, pending connection, and a recoverable error.
- [x] Publish the mocks privately for remote review and record the owner's choice in this plan (A1 dialog over A2's empty chat, 2026-10-08).
- [ ] Implement the chosen flow: the empty chat behind an A1-style dialog with the two paths, landing in the project's chat using existing machine form, auth prompts, connection owner, and scoped folder-opening actions. Keep the local branch small and preserve its native-picker policy.
- [ ] Add explicit cancellation and retry transitions. Wait for authenticated machine identity before folder reads. Settle TanStack cache changes before an operation resolves.
- [ ] Add an onboarding gallery tab and `first-workspace-machines` scenario with selectors. Update any affected installed-app verification instructions without duplicating Plan 114's service setup.

## Verification and acceptance

Extend the existing picker tests and `apps/web/src/features/environments/tests/project-machine-picker.test.tsx`. Use real in-process fixture servers with different filesystem roots. Prove a remote connection opens the remote folder, an identical local path stays distinct, failed or cancelled connection opens nothing, and restoration keeps its existing workspace. Preserve native picker cancellation and fallback tests.

Use `verify-fregat` to capture a fresh state home's local branch and remote branch. Read the screenshots back. Verify keyboard and touch navigation, pending/error feedback, retry, and cancellation. Installed macOS proof checks the native local chooser and the in-app remote picker on the actual installed surface. A platform unavailable to the implementer remains explicitly unconfirmed with its required proof named.

Acceptance means both paths end in the chosen project's chat on the advertised machine, and no path opens a chat without a project. No local folder is required before connecting remotely. The owner reviews remotely viewable mocks before implementation, and final screenshots match that chosen flow.

## Delivery

Use `typescript-best-practices`, `tanstack-query-best-practices`, and `verify-fregat`. Run narrow tests and required gates through the heavy wrapper. Commit owned paths, push, and deploy through the mesh. Any server change needs dev verification and `bun run install-release --server --restart`; web-only work uses `bun run install-release`. Record evidence links, shipped commit, and remaining platform limitations in this plan and root roadmap.
