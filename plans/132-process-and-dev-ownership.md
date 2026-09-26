# Processes, leases and dev plumbing each get an owner

Status: Phase 1 deployed 2026-09-23. Phases 2 and 3 landed on lane L4 2026-09-25 except the items
below. **Phase 4 implemented 2026-09-26** (branch `plan-132-p4`): the migration chain (versions 11
to 38) is one schema at `PRAGMA user_version` 1. The backup and reset of the dev and production
databases is pending the deploy, with the owner. Covers `apps/desktop`, `apps/tui`, `apps/server`,
`apps/web/vite.config.ts` and `scripts/`.

Everything done is in git history (`git log -- plans/132-process-and-dev-ownership.md`). This file
keeps only what is left.

## Phase 4 — the reset at deploy

`apps/server/src/db/initialize.ts` creates the schema in an empty database, accepts one at
`SCHEMA_VERSION`, and refuses anything else at boot with `db.SCHEMA_VERSION_MISMATCH`, whose
message names the database file. A schema change bumps `SCHEMA_VERSION`. The equality with the
chain was proved against migration 38 before the chain was deleted, by `schema-equivalence.test.ts`
in the commit "One schema at user_version 1, proved equal to migrations 11–38".

Left: deploy with `bun run deploy --server`, after backing up and moving aside
`/work/platform-dev/home/fs-metadata.sqlite` and `~/.platform/fs-metadata.sqlite` with their `-wal`
and `-shm` files. The exact procedure is in the PR body and in
`docs/verification/2026-09-25-schema-collapse-preflight.md`. Sessions, chat history, terminal
history, worktree registrations and usage totals in those files are lost; the deploy reason says so.

## Phase 2 — left

- Item 10: one generated tsconfig (the one `dev-sources.ts` writes) serving every typecheck path.
  It typechecks the Editor's source under Platform's settings, which the Editor lane owns.
- Item 12: `import.meta.hot.dispose` in `@singapore-editor/react`'s controller and ghostty-webgpu's
  `Terminal`, then delete the forced reload in `devSourcePlugin` (`apps/web/vite.config.ts`).
- Vite memory (research `132mem`, 2026-09-25). A lane Vite's RSS is rolldown's dependency optimizer:
  a cold optimizer cache leaves about 2.2 GB in mimalloc arenas that are never returned
  (rolldown#10985), and each in-process `server.restart` keeps the old server alive (rolldown#10887).
  Three measured changes:
  1. Launch Vite with `RAYON_NUM_THREADS=4 MIMALLOC_PURGE_DELAY=0` in `apps/web`'s `dev:vite`
     (`run-with-env.ts` takes leading assignments). Cold-cache RSS 2.50 GB → 1.31 GB, same look time.
  2. Add the linked sources to `optimizeDeps.entries` from `readDevSources`, excluding tests and
     benches, so a cold start bundles once and the first page does not reload.
  3. `devSourcePlugin`'s hook reloads only when `modules` is non-empty. It watches whole package
     roots, so an Editor `bun run build` rewriting `dist/` reloads every open page today.

  Revisit the environment settings when rolldown#10985 or #10887 ships a fix.

## Phase 3 — left

- Item 6: `vibrancy.m` resolves the native window by title because Electrobun's `createWindow`
  pointer type is not a public contract, and messaging a non-Objective-C pointer would crash the
  app. Verifiable only on the Mac: owner check.
- Item 11, deferred: the harness patches `globalThis.WebSocket` to rewrite terminal ids. The capture
  prefix is also how `chat-queue`, `terminal-history` and product captures find their own terminals,
  and a page URL parameter does not survive the app's URL rewriting across reloads. Since Plan 146 a
  default run has its own server, so this matters only for `--shared-dev` captures.
