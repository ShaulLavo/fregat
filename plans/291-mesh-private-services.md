# Plan 291: Retire Mesh public hosting and preserve private apps

- Status: Approved, in progress. Mesh source changes and local checks are complete; CI, merge, release, and installed-fleet verification remain open.
- Date: 2026-10-03
- Owner clarification: 2026-10-09.
- Implementation owner: `ShaulLavo/mesh`.
- Implementation: [Mesh PR #290](https://github.com/ShaulLavo/mesh/pull/290), awaiting CI and merge. Earlier app and widget removal merged in [Mesh PR #285](https://github.com/ShaulLavo/mesh/pull/285).
- Reported in: [Mesh #81](https://github.com/ShaulLavo/mesh/issues/81).
- Coordination: Preserve the private-app observability work from [Mesh #55](https://github.com/ShaulLavo/mesh/issues/55). Device authorization remains [Plan 290](290-mesh-device-authorization.md).

## Outcome and scope

Temporary websites and artifacts remain accessible from the owner's trusted devices. Mesh removes public sharing, visibility controls, public app admission, and its widget injection. Preserve the floating pill as dormant, generic source for another project.

The owner's October 9 clarification replaces the earlier requirement to keep a functional Mesh pill and a Mesh adapter. Loading the preserved bundle must mount nothing. Mesh app pages, management routes, and generated assets must contain no sharing controls or automatic widget loader.

The owner confirmed removal of all public hosting from Mesh on October 9. Remove ordinary public `serve` publishing, the public HTTP gateway, route snapshots and outboxes, named SSH reverse tunnels, public confirmation commands, and the public certificate role. Preserve private apps, private named services, DNS/ACME HTTPS, daemon control authentication, terminal workers, and owner source files. ZeroTier adoption remains a separate plan.

## Implementation and preserved data

The original inspection used Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`. Issue closure transferred tracking to this plan; it did not ship removal. The October 9 implementation uses current Mesh main and preserves existing app identities and owner files.

- [`internal/cli/app.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/cli/app.go) exposes `public` and `private` actions.
- [`internal/apps/types.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/apps/types.go) stores visibility and app hostnames under the public domain. `internal/apps/edge.go` owns app allocation and durable public edge state. `internal/apps/http.go` exposes visibility management.
- [`web/app-pill/src/index.tsx`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/web/app-pill/src/index.tsx) is the pill source. `internal/apppill` embeds its generated assets and transforms HTML.
- [`db/migrations/00009_apps.sql`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/db/migrations/00009_apps.sql) contains `app_state` and `app_names`. Check their remaining private uses before changing schemas.

Keep the generic component in `web/app-pill`, with caller-supplied actions and explicit mounting. Preserve its license notices, drag and flick behavior, touch support, viewport positioning, and reduced motion. Keep its build and browser fixtures with the source. The dormant `internal/apppill` transformer has no app-routing caller. No Mesh adapter or standalone repository is required.

Retain the central private app registry and signed lifecycle exchanges. Preserve app IDs, hostnames, owner keys, sequence numbers, pending operations, name reservations, and tombstones. The origin continues to own source, workers, verified loopback listeners, and cleanup. The registry remains independent of ordinary service snapshots.

Remove the public edge and tunnel framework. The private app registry uses a dedicated loopback HTTPS listener with matching SNI and Host, an authenticated PROXY source in the Tailnet address ranges, and a recognized owner device. Browser pairing and view cookies cannot bypass that ingress check. The registry receives the private-service wildcard certificate through the renewer's `appRegistry` recipient, alongside private named services. That recipient creates no DNS records.

Preserve private app-state bytes, name reservations, and tombstones while removing public route, snapshot, outbox, and tunnel tables. Remove public service fields from current storage and protocol contracts. Retired sharing operations cannot restore public access or replay cached public replies.

Origin-scoped app routing is deferred. Moving the registry now also requires a safe transfer of pending operations, DNS, and retained data. The chosen registry preserves the existing lifecycle while removing public access. This plan adds no separate registry migration work.

## Execution checklist

- [x] Audit app operations, visibility fields, hostname reservations, registry callers, browser controls, and generated assets against current main.
- [x] Prepare generic, explicitly mounted pill source and remove Mesh ownership, sharing, and automatic mounting from the component.
- [x] Prepare removal of the public edge, publisher, tunnel framework, and certificate role. Keep the signed private app registry, its dedicated HTTPS ingress, and the existing app lifecycle.
- [x] Prepare removal of Share, Make public, Make private, visibility state, management frame, widget routes, and runtime HTML injection.
- [x] Prepare private app-state storage with preserved bytes and name reservations.
- [x] Prepare removal of public service metadata and public route/tunnel tables while preserving private apps, named services, sessions, and workers.
- [ ] Validate prepared source changes, including static apps, server apps, cleanup, downloads, expiry, renew, delete, and owner-only failure inspection.
- [ ] Inventory existing managed app data before rollout. Retire public app routes without deleting owner source directories or managed workspaces merely to simplify state. Quarantine obsolete app-sharing metadata from route restoration. Obtain a separate explicit approval for any necessary deletion of kept data.
- [ ] Audit `internal/apps/safety*`, `internal/webauth`, HTTP policies, and security-wave findings by surviving callers. Keep private browser admission, request isolation, credential handling, process checks, and protection for private named services. Delete public-hosting machinery and retire obsolete findings with evidence.
- [ ] Rewrite `docs/plan/06-temporary-apps.md`, `docs/plan/01-decisions.md` D30, overview/status, T29, and the temporary-app parts of `07-quality-and-security-wave.md`. Document the new package home and the remaining private trust boundary.
- [ ] Complete independent review, required gates, merge, patch release, and installed-fleet verification. Prepared source is not a shipped result.

## Verification and delivery

Create a disposable static app and server app from a trusted device. Open their private URLs on the owner's Mac or phone. Exercise reload, source download, renew, delete, expiry, startup failure, and daemon restart. Confirm unauthorized browsers cannot read the private app or manage it.

Probe former public app URLs, public service publishing, hostname claims, SSH reverse tunnels, removed CLI/API actions, and public dispatch after restart. None can publish content. Verify private apps, private named services, authenticated terminal sessions, SFTP, and local SSH forwarding still work.

Run the generic pill's browser fixtures for mouse and touch drag, flick, collapse, keyboard controls, placement, explicit mounting, and disposal. Prove that loading its bundle mounts nothing and that real Mesh app HTML remains unchanged. Search generated assets, protocol types, docs, and persisted state for remaining public-hosting controls. Remaining `public` symbols may describe cryptographic keys or local listener ports; they cannot retain public hosting.

Upgrade stored state containing former public routes, cached replies, and pending operations. Confirm private access, app identities, retained files, name tombstones, and terminal workers survive; public route restoration and retired operations remain unavailable.

Coordinate registry, origin, renewer, and gateway deployment. Preserve the installed wildcard certificate when moving its purpose to private-service, keep terminal workers running, and verify private HTTPS and app lifecycle recovery after daemon restarts.

Run narrow app, pill, routing, and CLI tests, followed by Mesh's required integration gates through the heavy runner. Apply Subtract Before You Add by removing sharing before introducing further app features. Commit, push, release with a patch version, and verify private apps, private named services, and terminal continuity on the installed fleet. Closure of #81 transfers execution to this plan.
