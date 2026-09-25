# Plan 152: A development primary ships its working tree to remote machines

## Status and authorization

- Status: PROPOSED — nice to have, after [Plan 151](151-remote-server-releases.md). Decisions have
  recommended answers.
- Priority: P2. The production path (Plan 151) is what unblocks the Mac; this plan is for
  developing Platform against a remote machine.
- Effort: S. It reuses Plan 151's transfer, runtime install, launcher and button.
- Risk: LOW.
- Planned at: Platform `e1d61502`, 2026-09-25. Origin: the owner split production ("whatever's
  built", Plan 151) from dev syncing. A full source mirror on the remote was considered and
  dropped by the owner on 2026-09-25: it bought only editing or `--watch` on the remote, at the cost
  of an Editor checkout, `bun link` registrations and a monorepo install there.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Server changes deploy with `bun run deploy --server`.

## Outcome

When the primary is the dev server (`bun dev`, running from source), "Update server" on a remote
machine builds a server bundle from this working tree (uncommitted changes included) and installs
it there through Plan 151. The remote needs nothing beyond what Plan 151 needs: `bun` and SSH.

## What exists today

- The dev server runs `apps/server/src/index.ts` under `--watch` (`apps/server/package.json:19`).
  It has no release directory, so Plan 151's action has nothing to ship, and Plan 151 D1 makes the
  button say so.
- `apps/server` `build` (`apps/server/package.json:22`) produces the same self-contained bundle a
  deploy ships. It inlines `@singapore-editor/lsp` and `@singapore-editor/typescript-lsp`, which are
  the only Editor packages the server uses (`apps/server/package.json:34-35`). That leaves nothing
  for the remote to link or build.
- Dev and prod state separation is [Plan 146](146-isolated-state-and-verification.md). The same
  split applies to a remote that runs both a production and a development build.

## Decisions

- **D1 — Where the build comes from.** Recommended: `releaseSource()` in Plan 151's `update.ts`. A
  bundled (production) server returns its own release directory. A source (dev) server runs
  `apps/server` `build` into `~/.platform-dev/outgoing/<stamp>/server` and returns that. Deploy and the
  dev build write the runtime manifest and `remote-support.js` through one shared module
  (Plan 151 Phase 1), so the two cannot drift.
- **D2 — Channel on the remote.** Recommended: development builds install beside production, not
  over it:
  - `~/.platform/server/dev/` with its own `releases/`, `current` and `runtime/`;
  - its own launcher, `~/.local/bin/platform-server-dev`, and its own managed process.

  A production primary probes `platform-server`, and a development primary probes
  `platform-server-dev`. The mesh and `bun dev` can then both connect the Mac without overwriting
  each other's server.

- **D3 — State.** The dev channel's launcher points the server at the dev state directory that
  Plan 146 introduces, never at the remote user's `~/.platform`.
- **D4 — Release name.** `dev-<stamp>-<commit>[-dirty]`, so `/release` through the machine's proxy
  says which working tree it runs.

## Phases

### Phase 1: Dev builds, Plan 151 ships

1. `releaseSource()` (D1). The build runs under the update's wide event
   (`machines.server.update`, `source: 'dev-build'`, build duration, bundle bytes). A failed build is
   a catalog error whose `internal` holds the build log tail.
2. Plan 151's remote steps take a channel (`prod` | `dev`) that selects the directory and launcher
   (D2). Everything else is unchanged: transfer is skipped when the release exists, runtime install
   is skipped when the manifest is unchanged, the `current` swap is atomic, restart, then connect.
3. The button text and behaviour are unchanged. Its tooltip says "Builds this working tree and
   installs it on <machine>".

## Verification

- A unit test that `releaseSource()` builds for a source server and returns the release for a
  bundled one.
- The remote scripts against a temp home: a dev install and a prod install coexist, and each
  launcher runs its own `current`.
- A launcher test through the injectable seams in which a dev-mode server builds, ships and connects.
- Live, by the owner: from `bun dev`, Update server on `shaul-mac` → it goes live, and its
  `/release` names the `dev-…` build. The mesh's connection to the Mac keeps running its production
  release throughout.

## Out of scope

- A source mirror, remote `--watch` and editing on the remote (dropped; see Status).
- Production primaries (Plan 151).
