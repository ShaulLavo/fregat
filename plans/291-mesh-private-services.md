# Plan 291: Keep temporary apps private and preserve the pill

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/mesh`.
- Reported in: [Mesh #81](https://github.com/ShaulLavo/mesh/issues/81).
- Coordination: Preserve the private-app observability work from [Mesh #55](https://github.com/ShaulLavo/mesh/issues/55). Device authorization remains [Plan 290](290-mesh-device-authorization.md).

## Outcome and scope

Temporary websites and artifacts remain accessible from the owner's trusted devices. Mesh removes their public sharing, visibility controls, app-specific public hostname claims, and public edge routing. The generic floating pill remains reusable and functional.

Ordinary explicitly named public `serve` routes and authenticated SSH reverse tunnels have separate product contracts. Preserve them unless a call-site audit proves a path exists only for temporary apps. This work withdraws the public temporary-app portions of #2, #3, D30, and T29. It does not supersede daemon control authentication or ZeroTier adoption.

## Current state and extraction home

Inspected committed Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`. The older dirty local checkout lacks these components and must not be used as the execution baseline.

- [`internal/cli/app.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/cli/app.go) exposes `public` and `private` actions.
- [`internal/apps/types.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/apps/types.go) stores visibility and app hostnames under the public domain. `internal/apps/edge.go` owns app allocation and durable public edge state. `internal/apps/http.go` exposes visibility management.
- [`web/app-pill/src/index.tsx`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/web/app-pill/src/index.tsx) is the pill source. `internal/apppill` embeds its generated assets and transforms HTML.
- [`db/migrations/00009_apps.sql`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/db/migrations/00009_apps.sql) contains `app_state` and `app_names`. Check their remaining private uses before changing schemas.

Keep the reusable source in an internal `web/floating-pill` package with generic actions and placement. Keep Mesh-specific management in a small adapter. Move source, exports, build configuration, and browser fixtures together. Preserve its license notices, drag/flick behavior, touch support, viewport positioning, and reduced motion. A standalone repository is unnecessary for this execution.

Use the existing private hostname and TLS infrastructure for origin-host app routes. Retain app IDs as private route identities. Derive their URLs from the origin's registered private service base. Use private browser admission and existing owner grants where still required. The pill must not hold daemon keys or bypass admission. Bind the app proxy and management routes to trusted private listeners, with no app route registration at the public edge.

## Execution checklist

- [ ] On current main, enumerate all app public/private actions, visibility fields, app hostname reservations, app edge publishers, browser sharing controls, and generated assets. Record each surviving caller before deleting shared code.
- [ ] Extract `web/app-pill` into the chosen generic package and Mesh adapter. Prove the generic pill works in a small fixture without Mesh visibility or public-host state.
- [ ] Add private origin-host app routing through the existing service infrastructure. Preserve static apps, server apps, managed workspace cleanup, source downloads, expiry, renew, delete, and owner-only failure inspection.
- [ ] Remove Share, Make public, and Make private controls. Delete CLI/API/protocol operations and visibility state used only by public apps. Reject removed operations rather than retaining dormant compatibility paths.
- [ ] Disconnect temporary apps from public hostname allocation and public edge registration. Remove their public route state and public-only browser visitor behavior. Preserve named ordinary services and SSH tunnel registrations.
- [ ] Inventory existing managed app data before rollout. Retire public app routes without deleting owner source directories or managed workspaces merely to simplify state. Quarantine obsolete app-sharing metadata from route restoration. Obtain a separate explicit approval for any necessary deletion of kept data.
- [ ] Audit `internal/apps/safety*`, `internal/webauth`, HTTP policies, and security-wave findings by surviving callers. Keep private browser admission, request isolation, credential handling, process checks, and protection for ordinary edge routes where applicable. Delete public-app-only machinery and retire obsolete findings with evidence.
- [ ] Rewrite `docs/plan/06-temporary-apps.md`, `docs/plan/01-decisions.md` D30, overview/status, T29, and the temporary-app parts of `07-quality-and-security-wave.md`. Document the new package home and the remaining private trust boundary.

## Verification and delivery

Create a disposable static app and server app from a trusted device. Open their private URLs on the owner's Mac or phone. Exercise reload, source download, renew, delete, expiry, startup failure, and daemon restart. Confirm unauthorized browsers cannot read the private app or manage it.

Probe old public app URLs, direct edge paths, removed CLI/API actions, WebSocket upgrades, and stale app-edge state after restart. None can republish a temporary app. A separately declared ordinary public service and a named SSH tunnel must still work.

Run the pill's browser fixtures for mouse/touch drag, flick, collapse, keyboard controls, placement, HTML injection, and private policy. Read screenshots and return reachable evidence. Search generated assets, protocol types, docs, and persisted desired state for remaining public-app controls. Explain any remaining `public` symbol by its ordinary service caller.

Run narrow app, pill, routing, and CLI tests, followed by Mesh's required integration gates through the heavy runner. Apply Subtract Before You Add by removing sharing before introducing further app features. Commit, push, release with a patch version, and verify private apps and ordinary public services on the installed fleet. Closure of #81 transfers execution to this plan.
