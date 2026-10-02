# Plan 300: Give each Mesh machine one authoritative name

Status: APPROVED. Land the naming protocol after [Plan 290's device authorization](290-mesh-device-authorization.md). Verify the dashboard report before implementing its correction.

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #86](https://github.com/ShaulLavo/mesh/issues/86) and [Mesh #93](https://github.com/ShaulLavo/mesh/issues/93).

## Outcome

A machine declares one name, and every Mesh client uses that name for its dashboard, picker, session tables, command targeting, and Mesh-managed SSH entries. Renaming through any approved device changes the destination machine's name. Conflicts remain visible and cannot direct a command to an unintended host.

## Evidence and starting points

#86 confirms that per-viewer aliases differ across the fleet. `internal/cli/rename.go` changes only the invoking machine's `hosts.json`. #93 reports the Mac dashboard's local card using its OS hostname while peers call it `mac`. That particular visual report remains unconfirmed.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `HostRecord.Alias` in `internal/cli/config.go` owns the local label. `internal/protocol/control.go`'s `HostInfo` carries the stable key identity but no machine-owned name. `dashboardInventory` in `internal/cli/dashboard.go` uses `os.Hostname()` when the local ID lacks an address-book entry. Local listing and window entry have separate label paths in `internal/cli/command.go` and `internal/cli/window.go`.

Reuse [T06's stable identity](https://github.com/ShaulLavo/mesh/blob/main/docs/tasks/T06-host-identity.md), [D18's shared host key](https://github.com/ShaulLavo/mesh/blob/main/docs/plan/01-decisions.md#d18--one-host-identity-used-by-both-protocols), and existing host/state watch delivery. Keep the cryptographic host ID unchanged during renames. Authentication from Plan 290 makes a peer's naming claim trustworthy.

## Name and conflict contract

Keep one command-safe name using today's `ValidateHostAlias` rules. Choose lowercase letters, digits, interior hyphens, a 63-character limit, and existing reserved-command/session-ID exclusions. The same string is the display name and command target. A separate free-form display name or retained alias would recreate the ambiguity this issue removes.

The destination's state owns `MachineName`, its revision, and its stable host ID. An authorized rename request goes to that destination. The destination validates and persists the new revision, then publishes it in host information and state updates. Peers cache claims read from that authenticated destination by host ID and accept newer revisions. Do not trust another peer's assertion of a destination's name. They retain a stale indicator while the owner is unavailable. They never invent a per-viewer substitute name.

Order duplicate received claims deterministically by stable host ID. Show every conflicting machine's claimed name, identity suffix, and conflict status. While two known machines claim a name, bare-name targeting refuses the ambiguity and lists exact IDs. The lower ID keeps priority for that name. The other machine requires an explicit owner rename before bare-name targeting resumes. A rename targeting a conflict uses the ID. Known conflicts refuse new claims early.

A partition prevents immediate knowledge of an unseen competing claim. Do not promise global uniqueness without communication or add a central session/name database. Treat an unobserved rename as pending publication, propagate authenticated claims on reconnection, and converge to the same conflict result for the same received claim set. Test divergent caches explicitly. Record this limit in user-facing rename results and documentation.

Delete the per-viewer alias field and update all readers in the same delivery. Greenfield storage may discard obsolete local label state after preserving unrelated host identity, addresses, and dashboard settings. Do not retain old names as compatibility aliases or rewrite user-maintained SSH entries.

## Execution checklist

- [ ] Reproduce #93 on a host whose chosen name differs from its OS hostname. Check the first card, HOST column, picker, and local session listing. Capture known-good remote presentation and identify every local fallback before changing it.
- [ ] Inspect authentication and state-watch contracts. Define the machine-owned name/revision and conflict states using existing storage and protocol boundaries. Review the partition and collision contract before implementation.
- [ ] Add destination-owned name persistence and authorized rename. Make retrying the same rename idempotent. Keep identity, endpoints, live workers, and saved terminal containment stable.
- [ ] Publish the name in host information and state-watch updates. Update discovery, bootstrap, and offline caches by stable identity. Reject forged claims, stale revisions, and unauthorized rename requests.
- [ ] Implement deterministic conflict projection and exact-ID targeting. Prove peers agree after receiving the same claims, and ambiguity cannot select a different machine. Include simultaneous renames and reconnecting stale peers.
- [ ] Replace per-viewer alias ownership across CLI resolution, picker, dashboard, session/service tables, update fleet labels, and Mesh-managed SSH output. Preserve aliases read from the user's OS SSH configuration only as bootstrap input, then adopt the destination's declared Mesh name.
- [ ] Remove obsolete local rename semantics and old alias storage. Ensure a local daemon's own card reads its declared name without self-adoption. Verify #93 through a rendered dashboard on the same type of host.
- [ ] Run focused identity, protocol, configuration, CLI, and TUI checks after each unit. Complete Mesh gates, commit and push, pass CI, publish a patch release, and verify one rename from two devices plus offline/reconnect convergence.

## Acceptance and verification

Use independent temporary state directories and real destination state in tests. Cover normalization, reserved names, unauthorized renames, revision replay, collisions, stale caches, concurrent claims, and reconnect convergence. Tests must not rely on the owner's fleet. Use a read-only terminal capture for presentation, and inspect the resulting evidence.

Run affected package tests first, then `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh`. If host-state protocol changes affect release compatibility, run the supported transition checks. Confirm existing workers retain their PIDs and input/output across a rename.

After convergence, every client shows the same destination-owned name and revision. The local dashboard uses it even when OS naming differs. A rename happens once on the destination, and a stale peer updates when it reconnects. Duplicate names produce the same visible conflict and safe targeting on each peer. Old local aliases stop resolving. The host ID and terminal sessions remain unchanged.

Apply `how` to identity and state delivery, `principle-make-operations-idempotent` to rename retries, and `principle-sequence-verifiable-units` to protocol, conflict handling, and UI adoption. Apply `unslop` to names and conflict copy.
