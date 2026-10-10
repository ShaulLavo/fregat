# Plan 292: Adopt ZeroTier hosts through authenticated Mesh control

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/mesh`.
- Reported in: [Mesh #75](https://github.com/ShaulLavo/mesh/issues/75).
- Schedule: Deferred until [Plan 290](290-mesh-device-authorization.md) authenticates and revokes real control connections.

## Outcome

The owner can adopt a host reached through ZeroTier without installing Tailscale on it. Both IPv4 and IPv6 control and SSH listeners bind to discovered addresses from the explicitly selected provider. A discovered address never grants control permission.

## Current state

At committed Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, [`internal/tailnet/tailnet.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/tailnet/tailnet.go) reads Tailscale state and peers. [`internal/daemon/tailnet_addresses.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/daemon/tailnet_addresses.go) normalizes addresses and validates Tailscale ranges. Bootstrap discovers/provisions Tailscale and refuses a remote with no Tailscale addresses. Existing private DNS/HTTPS and Tailscale Serve behavior are provider-specific.

## Network decisions

Add a small provider interface for the two supported overlays. It returns concrete local listener addresses and discovery observations. Retain Tailscale as the default. ZeroTier enrollment names one joined network ID and uses its installed local CLI/API through a bounded command runner. Do not auto-join networks, invent an address from a hostname, or treat all private interfaces as trusted.

Persist the provider, network ID, stable Mesh identity, and verified endpoints in host records. One record may hold several endpoints for the same authenticated identity. Reject mismatched identity rather than merging hosts by display name or IP. On interface changes, retire stale binds and discover concrete replacement addresses without killing session workers.

ZeroTier support covers Mesh control and the SSH front door. Keep Tailscale Serve, MagicDNS, and current private certificate automation in their Tailscale-specific implementation. Do not silently claim equivalent browser HTTPS on ZeroTier. Any private service address advertised there must be verified using an already supported configured route. General wildcard/public listener binding is outside this plan and remains unavailable by default.

## Execution checklist

- [ ] Confirm Plan 290's unknown/revoked-peer and root-account tests pass on the release being extended.
- [ ] Reproduce ZeroTier-only adoption failure in an isolated host fixture. Record SSH bootstrap success, missing Tailscale addresses, and refused Mesh ports.
- [ ] Define provider and endpoint types. Update discovery, host-book persistence, bootstrap verification, and daemon listener construction as one contract. Preserve provider-specific status diagnostics.
- [ ] Implement bounded ZeroTier discovery for the chosen joined network ID. Handle absent CLI, disconnected service, denied network, incomplete address allocation, and malformed output with actionable results.
- [ ] Make `mesh add` select the provider explicitly and enroll the device key through the authenticated bootstrap path. Existing-daemon adoption must still require prior approval and pinned identity.
- [ ] Update both control and SSH IPv4/IPv6 listener lifecycle. Preserve direct terminal traffic and workers during provider-address changes.
- [ ] Document provider selection, installation prerequisites, key approval, recovery, and the limits of DNS/HTTPS support. Update D23 and the overview without implying network membership supplies authorization.

## Verification and delivery

Use portable captured discovery output for parser tests. Real network acceptance uses isolated temporary hosts and a joined ZeroTier test network. It is an operator proof, not a test hard-coded to this fleet. Record a stated skip when the overlay/tool is unavailable in CI.

Adopt a ZeroTier-only destination through system SSH and verify encrypted authenticated control, session creation, detach, reconnect, inspection, and SSH access. Repeat over IPv4 and IPv6 where the test network provides them. Unknown and revoked keys remain denied even from the same network. A wrong network ID, wrong pinned host identity, and unintended interface bind must fail. A Tailscale-only host must retain its existing behavior.

Run narrow provider, bootstrap, listener, and host-book tests, then Mesh's lifecycle integration gates through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill. Commit, push, release with a patch version, and verify installed listeners and direct terminal traffic. Closure of #75 transfers execution to this Approved dependency-bound plan.
