# Processes, leases and dev plumbing each get an owner

Status: Approved, active wave 2 closeout, updated 2026-09-30. Phase 1 and the schema collapse
are delivered; phases 2 and 3 retain the items below.

## Active closeout after the package move, 2026-09-30

Plan numbers record creation order. This plan's process ownership and development plumbing
predate 207; the source migration now supplies canonical package locations for its remaining work.

- [x] Update the general roadmap for 207's delivered source migration and deferred publication.
- [x] Prove loaded source still reloads and generated/unserved package files do not reload.
- [x] Restrict the reload hook to modules served in the browser environment.
- [x] Pass whole-tree gates and the full repository typecheck.
- [x] Restart the mesh-managed dev route and verify the application loads.

Baseline `typecheck:dev` fails in the notification badge test: its 2D canvas spy conflicts with
the WebGPU `getContext` overload loaded by Ghostty's source types. Keep this failure in the
configuration follow-up; it predates this HMR change. Resource disposal and memory measurements
remain separate closeout units below. The 13 focused Vite/source-resolution tests and normal
web typecheck pass. The real Vite watcher regression failed before the fix for both generated
and unloaded files; both pass after the fix, and loaded source still sends one full reload.
After restarting `:5173` on `omarchy`, `agent:browser look --doctor` passed with no browser
or log problems. Screenshot read back in `/work/tmp/fregat-evidence/20260930T084038Z-look-1440x1000/`.

Turbo owns task scheduling and build dependencies. Vite serves these packages directly from
source. The current Editor controller is retained in React state and the Ghostty runtime has
a static query with infinite retention. Ordinary unmount disposal exists; safe replacement
across hot updates still needs proof before removing the reload fallback.

## Delivered schema collapse

`apps/server/src/db/initialize.ts` accepts an empty database or `SCHEMA_VERSION`, currently 1,
and refuses a mismatch. The migration chain is deleted. On 2026-09-28, read-only queries found
`PRAGMA user_version = 1` in both `/work/platform-dev/home/fs-metadata.sqlite` and
`~/.platform/fs-metadata.sqlite`. Production `/platform/release` reported phase `serving`, no
pending release and a passed live check for `20260928T173104Z-4a85ec00-main`.

The old instruction to reset those databases at the next deploy is obsolete. Do not reset them
for this plan. The historical backup/reset procedure remains in
[the preflight record](../docs/verification/2026-09-25-schema-collapse-preflight.md); this audit
does not establish which backups were retained. A future schema bump needs its own concrete
state-loss review and authorization.

## Phase 2 remaining

- Item 10: reconcile the generated tsconfig from `dev-sources.ts` with every typecheck path.
  Editor sources must be checked under the intended settings without competing configurations.
- Item 12: prove hot updates replace the retained Editor controller and cached Ghostty runtime,
  releasing their resources, then remove the forced full reload from `devSourcePlugin`.
  Preserve the fallback until that proof passes; ordinary unmount disposal is already present.
- Re-measure Vite memory against today's Vite/rolldown versions. The 2026-09-25 proposal for
  `RAYON_NUM_THREADS=4 MIMALLOC_PURGE_DELAY=0` is not in `apps/web`'s `dev:vite`. Treat the old
  2.50 GB → 1.31 GB result as a historical experiment, not current proof. Use the existing
  configuration policy for any permanent tuning; avoid adding speculative environment controls.

Linked-source dependency prebundling landed in `6d940b3c5`: `optimizeDeps.include` explicitly
lists transitive dependencies of the excluded Editor packages. Recheck a cold cache for late
optimizer reloads before changing it. The former proposal to add all sources to
`optimizeDeps.entries` is superseded unless that proof finds a remaining gap.

## Phase 3 remaining and transferred work

- The Electrobun `vibrancy.m` window-title lookup is transferred to Plan 114 Gate 3, which replaces
  that host. Verify native window ownership and vibrancy on the Mac there; do not repair an
  Electrobun pointer workaround solely to delete it afterward.
- Item 11 remains deferred: the harness patches `globalThis.WebSocket` to rewrite terminal ids.
  The capture prefix identifies terminals for `chat-queue`, `terminal-history` and product
  captures. Default browser runs have isolated servers; only `--shared-dev` needs this behavior.
  Remove it only with equivalent capture ownership across reloads.

## Order and closeout

Finish the bounded development-plumbing work before Plan 114's launcher cutover. The existing
desktop connects to mesh-managed servers and its quit path only flushes desktop observability;
114 must preserve that ownership. This plan does not own shared-server or terminal-host shutdown.

Close each remaining item with the narrow relevant configuration/lifecycle test and actual
cold-start, HMR or memory evidence. Record transferred/deferred items explicitly. No UI or schema
change is required merely to reconcile this plan.
