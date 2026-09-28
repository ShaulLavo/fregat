# Processes, leases and dev plumbing each get an owner

Status: wave 2 closeout, reconciled 2026-09-28. Phase 1 and the schema collapse are delivered;
phases 2 and 3 retain the items below. Source review only; remaining runtime checks are explicit.

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
- Item 12: add lifecycle disposal in `@singapore-editor/react` and ghostty-webgpu's `Terminal`,
  verify mounted instances release old resources, then remove the forced full reload from
  `devSourcePlugin`. Until disposal works, preserve the reload.
- Restrict the current `hotUpdate` reload to relevant served modules. It still watches package
  roots and does not check `modules`, so generated `dist/` writes need a focused non-reload proof.
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
