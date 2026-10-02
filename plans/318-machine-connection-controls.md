# Plan 318: show persistent connection intent and confirm removal

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #350](https://github.com/ShaulLavo/fregat/issues/350). Fregat's web machine settings and environment connection owner implement the change. [Plan 315](315-local-remote-onboarding.md) reuses these controls where relevant.

## Outcome

A machine row shows whether automatic connection is enabled as a lasting choice. Removing its saved definition requires confirmation that names the actual effects. Remove remains available when the row offers an install or update.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [MachineRow](../apps/web/src/features/settings/components/machine-row.tsx) derives `connected` from live or pending phases. Its ghost **Remove** button calls `disconnectMachine` and then the settings removal directly. There is no confirmation. An update offer does not currently remove the button.

[environment-connections.ts](../apps/web/src/state/environment-connections.ts) owns a `desired` set. `connectMachine` adds the name and `disconnectMachine` removes it, writes it through [connected-machines.ts](../apps/web/src/state/connected-machines.ts), cancels recovery, and stops the SSH connection when applicable. This intent survives reload. Observed phases can be offline, blocked, reconnecting, or identity-drift while connection remains desired.

Machine definitions contain SSH target, port, URL, and label in [the contract](../packages/contracts/src/machines.ts). SSH keys come from the existing SSH configuration. No credential-reference field exists in that definition. Settings removal hides rail projections and releases owned connections, while shared environment identities and retained caches have their own lifecycle. Confirmation copy must follow verified effects and cannot promise deletion of credentials or remote sessions.

## State and removal contract

Expose desired connection intent from the connection owner's Zustand store. Keep it synchronized with the owner's existing connect, disconnect, configuration removal, and restoration transitions. Do not derive intent from `phase` or maintain a second UI boolean.

Use a persistent toggle with `aria-pressed` and a label describing automatic connection. Show the observed phase separately. An enabled connection may be **Connecting**, **Offline**, **Blocked**, or need an identity decision. Turning the toggle off cancels connection attempts and automatic retries. Reload keeps it off. Turning it on invokes the established connect/auth flow. An error updates the existing row state and explains the available action.

Move Remove to a destructive action that opens a shared confirmation dialog. Name the machine and saved address. Restore focus to the machine section after successful removal. State that removal forgets the saved machine entry, disables its automatic connection, and removes its view when no other configured entry owns that environment. Verify any additional local credential reference before naming its removal. Keep SSH keys, remote files, remote session data, and unrelated connection owners under their existing ownership rules.

Serialize confirmation and removal through the existing settings and environment mutation owners. A cancelled dialog performs no disconnect or write. One confirmation authorizes removal of the saved entry. On confirm, disable desired connection, make the bounded disconnect attempt, and remove the definition. A remote stop failure does not prevent local removal; report the remaining uncertainty through the existing operation result. Preserve unrelated server-side connection owners. Settings-write failure retains the definition and an actionable retry. Retrying must converge without duplicate disconnects or removing another alias's live connection. Do not add a second confirmation or a separate forget workflow.

Remove is reachable in idle, live, connecting, reconnecting, offline, blocked, identity-drift, and update-available rows. An operation already in flight may temporarily disable a conflicting control, but an offered update alone cannot hide or disable removal. Update mutations and removal use one machine operation scope so they settle in a defined order.

## Execution checklist

- [ ] Reproduce the current immediate removal and persistent disconnect using a real fixture machine. Inventory settings removal, SSH stop, cache/projection, and alias-owner effects.
- [ ] Expose reactive desired connection intent and cover connect, failed connect, disconnect, restore, and configuration deletion. Keep observed phases separate.
- [ ] Replace momentary connect/disconnect presentation with the persistent toggle and phase feedback. Use shared controls and existing mutation state.
- [ ] Add the destructive confirmation with machine/address recovery, cancel, pending, disconnect-failure, settings-failure, and retry states. Preserve removal availability beside install/update offers.
- [ ] Extend real settings and federation tests. Update the existing immediate-remove expectation so only confirmed removal changes the saved document.
- [ ] Add `machine-settings-controls` browser scenario and gallery examples for connected, disconnected, offline-with-intent, identity-drift, and update-available rows.

## Verification and acceptance

Run focused cases in `apps/web/src/features/settings/components/tests/machines-section.test.tsx` and `apps/web/src/state/tests/environment-connections.test.tsx` through the existing real in-process fixtures. Prove cancel leaves settings, desired intent, and connection untouched. Confirm removal updates settings. Cover reload persistence, failure/retry, update offer, and two names pointing to one environment.

Run the browser scenario and `look` with `verify-fregat`. Read screenshots for connected, disconnected, and update-available rows. Also inspect an offline row whose connection toggle remains enabled. Verify keyboard focus, dialog cancellation, pending feedback, destructive tone, and the full saved address. Removal must require confirmation in every phase. The persistent toggle must reflect intent rather than claim an unreachable host is live.

## Delivery

Apply `typescript-best-practices`, `tanstack-query-best-practices`, and the shared design rules. Run the narrow checks and required gates through the heavy wrapper. Commit by path, push, and deploy through the mesh. Server changes, if required by verified removal behavior, need dev verification and a server restart deployment. Record the shipped commit and read-back screenshots in this plan and root roadmap.
