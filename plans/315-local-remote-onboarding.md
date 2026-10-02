# Plan 315: choose the machine before the first folder

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #375](https://github.com/ShaulLavo/fregat/issues/375). Fregat owns the web flow shared by the installed app. This plan starts with design mocks and the owner's choice. UI implementation follows that choice.

## Outcome

A fresh installation offers a local folder path and a remote-machine path before assuming where the workspace lives. Each path ends with a workspace open on the chosen machine. A person who works remotely can connect first without selecting a local folder.

## Current evidence

The owner observed the folder-only screen in the macOS app at `29b9c749e`. Current Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb` still renders [EmptyWorkspace](../apps/web/src/components/empty-workspace.tsx) with one **Choose folder** action. [AppWorkspace](../apps/web/src/components/app-workspace.tsx) chooses between `usePickEntry` and `ProjectPicker` according to connected machines and current origin. It does not expose adding the first remote machine in that empty state.

[MachineForm](../apps/web/src/components/machine-form.tsx) already connects an SSH target or server URL. [ProjectPicker](../apps/web/src/features/environments/components/project-picker.tsx) opens the in-app filesystem picker with the chosen machine's query client. [Plan 114](114-installed-app.md)'s picker machine policy requires verified local-desktop capability for native choosers. A remote browser's machine and its primary server may differ. A server URL does not establish locality.

Reuse the implemented [environment strategy](environments-and-remote-plan.md). [Plan 240](240-remote-project-trust.md) owns checkout execution trust. [Plan 290](290-mesh-device-authorization.md) owns authorization for Mesh control; onboarding cannot grant Mesh access by discovering a reachable host.

## Flow and ownership

Use one flow with explicit states for choosing a path, choosing or connecting a machine, authenticating, selecting its folder, opening the workspace, and recoverable failure. Connection phase stays with `createEnvironmentConnections`. Folder reads and opening use that selected machine's client and scoped identity. The onboarding view owns only its step and draft selection.

The local action uses the native chooser when the app and selected server are verifiably on the same machine and that server advertises an available desktop helper. Otherwise use the in-app filesystem picker and name the machine whose files it lists. In a remote browser, do not label server files as files on the viewing phone or laptop. Browser-local handle workspaces require another filesystem design and are outside this plan.

The remote action supports the existing SSH and HTTPS server forms, including an authorized Mesh-host server URL. After connection confirms identity, select a folder on that host through the in-app picker. Keep credentials in their existing owner. Cancellation preserves a deliberately saved machine but opens no workspace. A failed connection retains an editable draft and actionable error. Identity drift requires the established trust flow.

First-launch choices appear after restoration completes with no open workspace. Do not replace a restoring workspace with onboarding, reset settings, or erase recent projects. A later empty workspace may reuse the actions without replaying a first-launch ceremony.

## Execution checklist

- [ ] Reproduce a fresh state home in web and the installed macOS app. Inspect existing connected machines, picker locality, cancellation, and the remote folder-open path.
- [ ] Make two or three materially different mocks of the first screen and connection-to-folder sequence. Include narrow phone layout, fresh desktop, remote-browser target naming, pending connection, and a recoverable error.
- [ ] Publish the mocks with `bun run show <files…>` and send reachable links or embed screenshots. Record the owner's choice in this plan before implementing the UI. Local filesystem paths alone are not a review deliverable.
- [ ] Implement the selected flow using existing machine form, auth prompts, connection owner, and scoped folder-opening actions. Keep the local branch small and preserve its native-picker policy.
- [ ] Add explicit cancellation and retry transitions. Wait for authenticated machine identity before folder reads. Settle TanStack cache changes before an operation resolves.
- [ ] Add an onboarding gallery tab and `first-workspace-machines` scenario with selectors. Update any affected installed-app verification instructions without duplicating Plan 114's service setup.

## Verification and acceptance

Extend the existing picker tests and `apps/web/src/features/environments/tests/project-machine-picker.test.tsx`. Use real in-process fixture servers with different filesystem roots. Prove a remote connection opens the remote folder, an identical local path stays distinct, failed or cancelled connection opens nothing, and restoration keeps its existing workspace. Preserve native picker cancellation and fallback tests.

Use `verify-fregat` to capture a fresh state home's local branch and remote branch. Read the screenshots back. Verify keyboard and touch navigation, pending/error feedback, retry, and cancellation. Installed macOS proof checks the native local chooser and the in-app remote picker on the actual installed surface. A platform unavailable to the implementer remains explicitly unconfirmed with its required proof named.

Acceptance means both paths end at a usable workspace on the advertised machine. No local folder is required before connecting remotely. The owner reviews remotely viewable mocks before implementation, and final screenshots match that chosen flow.

## Delivery

Use `typescript-best-practices`, `tanstack-query-best-practices`, and `verify-fregat`. Run narrow tests and required gates through the heavy wrapper. Commit owned paths, push, and deploy through the mesh. Any server change needs dev verification and `bun run deploy --server --restart`; web-only work uses `bun run deploy`. Record the mock choice, evidence links, shipped commit, and remaining platform limitations in this plan and root roadmap.
