# Plan 132 schema preflight

Implemented 2026-09-26 on branch `plan-132-p4` against the final chain (migration 38). The
mismatch behavior below is `db.SCHEMA_VERSION_MISMATCH` in `apps/server/src/db/initialize.ts`.

Phase 4 is held until the coordinator confirms that the other approved lane changes have landed.
The owner must approve any reset of real state separately. This record prepares that decision.
It does not authorize a reset, and no real database was opened, copied, migrated or deleted.

## Current baseline

The rollback baseline is Platform `638137c66`. Its migration chain contains versions 11–24,
29 and 30. A new in-memory database built from that chain has 24 application tables, including
`schema_migrations`, and passes `PRAGMA integrity_check`. The inventory includes SQL definitions,
columns, indexes and foreign keys. The local capture is
`/work/tmp/l6-completion/schema-inventory.json`; its generator is beside it.

This is a preliminary inventory. The final equivalence proof must run against the approved
migration chain after the hold is released. It must compare the complete fresh schema with the
collapsed schema, excluding the removed ledger, and exercise the actual services that read and
write those tables. Reverted L5/L9 tables are absent from this baseline. Their replacement PRs
become dependencies only if the owner approves and lands them.

## Exact local paths

Checked on 2026-09-25 using filesystem metadata and the production process's open file paths.
No rows were read.

| Owner       | Database path                                | Evidence                                                                                               |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Production  | `/home/shaul/.platform/fs-metadata.sqlite`   | `platform-prod.service` has this file and its WAL open; `PLATFORM_HOME` and `FS_METADATA_DB` are unset |
| Development | `/work/platform-dev/home/fs-metadata.sqlite` | File exists; `scripts/state-home.ts` supplies this default                                             |

Each database may also have the exact adjacent paths ending in `-wal` and `-shm`.
`/work/platform-production/home/fs-metadata.sqlite` does not exist and is not the production
state path. `FS_METADATA_DB` takes precedence over `PLATFORM_HOME`; recheck both at execution
because a process can use an explicit override. Remote machines require their own path inventory.

## State a reset discards

A reset removes the environment identity, filesystem metadata, saved workspace addresses,
project/worktree/session registrations, command receipts and event history, chat messages,
activities, turns, plans and checkpoint references, provider runtime linkage, terminal leases and
handoffs, terminal scrollback, attachment-upload ownership, and stored usage totals, baselines and
price snapshots. A fresh environment identity can also change the browser's association with
saved local state.

Repository files, worktree directories, settings documents, secrets, palettes, wallpapers, and
browser IndexedDB files live outside this database. A database reset retains those bytes. The
application loses its database records describing ownership and relationships, so retaining files
alone does not preserve sessions or worktree registration.

## Required mismatch behavior

The proposed initializer accepts an empty database or its exact current `PRAGMA user_version`.
A database containing an older schema or an unsupported version must stop startup with a structured
error that includes the resolved database path and the reset instruction. It must not run a
migration, repair data, or continue with a partially compatible schema. The old database must
remain available for rollback. These behaviors still require implementation and fixture proof.

## Reversible reset procedure for owner review

1. Record the running release, effective state path and owning processes. Stop those processes
   before copying or moving SQLite files. Production is currently `platform-prod.service`;
   development is the process started by `bun run dev`.
2. Create a timestamped, private backup directory under `/work/backups/platform/` after checking
   that `/work` is mounted and has sufficient physical space. Copy the database and any adjacent
   `-wal` and `-shm` files together, retaining permissions. Record hashes of the closed source and
   backup files, and check integrity using the backup copy.
3. Move the original database and its sidecars together into a separate retired-state directory.
   Keep both that set and the verified backup. Start the approved new release and verify fresh
   state with the application.
4. To roll back, stop the new process, move its newly created database set aside, restore the
   complete original set to the exact original paths, restore the recorded old release, then
   restart it. Check sessions and worktree registrations before resuming work.

Do not copy a running WAL database with a plain file copy, and do not restore an old database
beneath a running new process. The final owner approval should name the chosen environment,
exact path, release, verified backup and the state loss listed above.
