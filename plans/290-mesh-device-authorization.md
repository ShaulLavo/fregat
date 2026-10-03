# Plan 290: Approve devices before Mesh control

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/mesh`.
- Reported in: [Mesh #74](https://github.com/ShaulLavo/mesh/issues/74).
- Priority: Complete before [ZeroTier support](292-mesh-zerotier.md) or remote job coordination.

## Outcome

The owner approves a device key for a particular destination Mesh daemon. The destination verifies possession of that key before dispatching any control message. Approval grants the authority of the daemon's OS account. Approving access to a root daemon requires an explicit root-access acknowledgement.

Mesh keeps its direct WebSocket connections, resumable sessions, and SSH front door. Network membership supplies reachability. The destination's approved keys supply control authorization.

## Current state

Inspected committed Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, rather than the older dirty local checkout.

- [`internal/transport/socket.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/transport/socket.go) rejects browser Origins but accepts clients without an Origin header.
- [`internal/daemon/runtime.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/daemon/runtime.go) reserves a bounded connection slot, upgrades the WebSocket, and enters `connections.run` without client authentication.
- [`internal/identity/identity.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/identity/identity.go) already stores one Ed25519 identity in OpenSSH format. [`internal/sshd/server.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/sshd/server.go) checks the daemon state's `authorized_keys` for SSH authentication.
- [`internal/bootstrap/running.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/bootstrap/running.go) can adopt an existing daemon after an SSH failure. Destination identity currently arrives through a control response, rather than a cryptographic peer handshake.
- Decisions D17, D18, and D23 in [`01-decisions.md`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/docs/plan/01-decisions.md) preserve direct transport and one identity. This plan supersedes D23's reliance on Tailnet admission alone.

## Access and transport decisions

Use the existing Mesh identity and approved-key file. Extract key parsing and authorization from `sshd` into a shared owner. SSH and control connections must consult the same current grants. Grant the complete daemon-account control capability in this first version. Do not add roles or a separate account system.

Use an established TLS 1.3 mutual-authentication handshake over the WebSocket's binary byte stream. `coder/websocket.NetConn` and Go's `crypto/tls` provide the stream and handshake. A certificate wraps the existing Ed25519 key. It does not create a second long-lived identity. Verify the destination key against its pinned Mesh identity and the client key against the receiver's grants. Certificate signatures alone do not establish trust.

The first execution step must prove this composition with the pinned library versions. Preserve control framing, batching, read limits, and health checks after authentication. The shared listener's ordinary HTTP service routes retain their current URLs. This avoids changing browser HTTPS certificates or using SSH as the daemon transport. A failed probe is a design blocker to resolve in this plan before implementation expands, never a reason to invent a signed challenge protocol.

Require the authenticated protocol and remove the unauthenticated network control path in one release. Keep the browser-Origin restriction and concrete Tailnet binds. Local Unix connections retain the existing same-account filesystem boundary. Remote authentication must cover catalog reads, terminal frames, session create/attach/kill/signal, inspection, services, update operations, and power controls. OS permissions continue to bound each operation.

## Enrollment and revocation

The first adopter enrolls through authenticated system SSH, or through a command the owner runs as the destination daemon's OS user. That trusted path reads the destination identity and approves the source public key. Display the destination account and both fingerprints. Require explicit acknowledgement when the destination account is root. Never authorize a client because it sent a key or appeared in discovery.

An already-running daemon without SSH remains adoptable after local approval. Return a reachable command and fingerprint instructions for the owner's Mac or phone. An unauthenticated discovery response cannot become a trusted destination identity. Existing host-book pins must be checked against the authenticated key. A changed identity requires explicit re-enrollment.

Revocation atomically removes the grant and retires that key's active control and SSH connections. Serialize revocation with control and terminal-input admission so no later frame passes on a removed grant. An already accepted operation may finish. Detach clients while keeping PTY workers and running commands alive. Each reconnect performs authentication again. Disable session tickets in the first version so reconnects cannot reuse a stale authorization decision.

## Execution checklist

- [ ] Reproduce the no-Origin control connection against an isolated daemon with disposable state. Record that a session command reaches the handler before the change.
- [ ] Probe TLS over `websocket.NetConn` with current library versions. Exercise proof of both keys, malformed input, fragmented data, deadlines, keepalive, cancellation, and bounded connection slots. Obtain an independent security review of key trust and channel binding before widening use.
- [ ] Define shared `DeviceGrant` and `AuthenticatedPeer` types. Keep the destination OS account implicit in its daemon instance. Implement safe, bounded approved-key reads and atomic local grant/revoke operations.
- [ ] Update bootstrap and existing-daemon adoption to enroll through the trusted path. Pass expected destination identity and source signer to every network dialer, including edge/service callers.
- [ ] Authenticate before creating the Mesh protocol reader or invoking `connections.run`. Bound handshake time and bytes with existing transport policy. Failed authentication releases its reserved slot.
- [ ] Associate active connections with the authenticated key. Apply current authorization at command admission and retire revoked connections without signaling workers.
- [ ] Update SSH to use the shared grants and active-connection revocation. Preserve stock SSH clients, public-key-only authentication, SFTP, and named tunnels.
- [ ] Delete the insecure remote dial path and outdated Tailnet-only authorization statements. Update installation and recovery instructions, including the explicit root warning.

## Verification and delivery

Add portable integration fixtures with separate state directories and generated disposable identities. A trusted client can create, detach, reconnect, inspect, and kill a session. An unknown key, revoked key, wrong pinned destination, raw legacy client, and forged certificate cannot invoke even `host.info`. Repeat the denied checks without an Origin header. A browser Origin remains rejected.

Revoke a connected client and confirm later input and control requests fail. Another approved device must reattach to the same surviving worker. Restart or upgrade the daemon and confirm grants, revocations, and worker survival. Confirm explicit root enrollment and ordinary user enrollment use their actual OS-account permissions. Exercise local Unix access separately.

Run the narrow transport, identity, SSH, and bootstrap tests first. Compare authenticated stream throughput, input latency, and idle connection costs with a measured baseline before broad rollout. Then run Mesh's race, vet, and integration gates through the heavy runner. Use `how` for unfamiliar transport code, `unslop` for copy, and a decision log for the security choices. Commit, push, release with a patch version, and verify the installed fleet. Upgrade the coordinator's host last while live workers remain attached. Closure of #74 transfers execution to this checklist and does not claim the control gap is already fixed.
