# Plan 146: Separate state and isolated verification

## Status and authorization

- Status: PROPOSED — Phase 1 ready; the Phase 4 cleanup needs the owner's OK before it runs.
- Priority: P1. It is the root cause of most production log noise and of scenario data in the
  owner's real session list.
- Effort: M.
- Risk: MED. Phase 1 changes where every server reads its state; a wrong default points prod at an
  empty home.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

Verification never touches the owner's state. Prod keeps `~/.platform` as the real state. The dev
server has its own home. Every `agent:browser` run drives a throwaway API server whose state is
deleted when the run ends. Scenarios cannot write to the mesh.

## What exists today

- Every state path comes from `platformHomePath()` (`apps/server/src/home.ts:16-18`), which joins
  `homedir()` and `.platform`. There is no override for the whole home.
- Per-file overrides exist for some files only: `FS_METADATA_DB` (`apps/server/src/db/client.ts:28`),
  `PLATFORM_SETTINGS_FILE` and `PLATFORM_SECRETS_FILE` (`apps/server/src/index.ts:51-52`),
  `PLATFORM_APP_SAVE_MARKER_FILE` (`apps/server/src/fs/app-save-marker.ts:20`). Attachments,
  provider status, workspace-edit journals, fonts and LSP installs have none.
- Wallpapers, palettes and themes skip the helper: `path.join(options.homeDirectory ?? homedir(),
'.platform', …)` (`apps/server/src/app.ts:167-175`). `homeDirectory` is also the user's home for
  file browsing (`apps/server/src/index.ts:24`), so it cannot double as the state root.
- The prod unit sets no state variable (`scripts/deploy/systemd/platform-prod.service`). The dev
  server sets none either. Both processes hold `~/.platform/fs-metadata.sqlite` open. They share
  the database, settings, secrets and every file listed above.
- The dev page talks to `http://localhost:3001` whenever `import.meta.env.DEV`
  (`apps/web/src/lib/client.ts:24-28`), unless `VITE_SERVER_URL` or an application host sets
  `apiOrigin` (`apps/web/src/lib/application-host.ts`).
- `agent:browser` defaults to Vite on 5173 (`scripts/agent/browser.ts:27`). Its API helpers use
  `localhost:${PORT ?? 3001}`, or `<origin>/platform` when the page path starts with `/platform/`
  (`scripts/agent/server-api.ts:8-14`, `scripts/agent/preserve-settings.ts:5-11`,
  `scripts/agent/fixture-workspace.ts:92-98`). So `--url` on the mesh drives prod.
- The skill advises that: `.agents/skills/verify-fregat/SKILL.md:18` (any verb on the mesh URL) and
  `:62` (mesh log capture). Per-feature notes repeat it.
- Settings scenarios write the real user layer and restore it afterwards: `writeUserSetting` and
  `preserveAppearance` (`scripts/agent/preserve-settings.ts:29-59`), used by at least ten
  scenarios. `native-provider-verification.ts:143` adds a `verify-<uuid>` provider instance to
  `providers.instances`. A deleted instance of that kind is what the session reaper warns about
  every five minutes.
- A fixture is a `/work/tmp/fregat-<slug>-*` repository (`fixture-workspace.ts:44-56`).
  `openFixtureWorkspace` registers a workspace address (`:100-119`), and the workspace view then
  creates a project and records a recent. `releaseFixture` (`:126-129`) kills processes and deletes
  the directory, but no database rows.
- Measured read-only on 2026-09-25 in `~/.platform/fs-metadata.sqlite`:
  - 370 of 372 live projects have only `/work/tmp` worktrees, with 371 live worktrees there.
  - 480 of 483 recents are under `/work/tmp`.
  - 488 of 491 workspace addresses are under `/work/tmp`.
  - No live session sits in a `/work/tmp` worktree.
- Projects are projections over `orchestration_events`. Deleting `projection_projects` rows by
  hand would split the projection from its event log. `project.delete` is the command for it.
  Recents (`fs_metadata`) and addresses (`workspace_addresses`) are plain tables with no delete
  route (`apps/server/src/fs/routes.ts:84-88`).
- The browser test world already runs an isolated server: `apps/web/test/env/browser-file-server.ts:57-80`
  spawns `bun src/index.ts` with an in-memory database, temp settings and secrets, and its own
  port and origins.
- AGENTS.md "Dev Server" says: "Never spin up your own server to test or verify changes — reuse the
  running one." The skill says the same (`SKILL.md:12`).

## Scope

- A `PLATFORM_HOME` override for all state, including wallpapers, palettes and themes.
- Prod keeps the default home; the dev server gets its own.
- `agent:browser` runs its own API server per run against the shared Vite, with temp state.
- Scenarios refuse the mesh; read-only verbs still work there.
- One-off cleanup of the fixture rows in `~/.platform`, gated on the owner.

## Decisions

- **D1 — Which process keeps `~/.platform`.** Recommended: prod. It holds the owner's real
  sessions, settings and secrets; the unit needs no change and nothing moves. The alternative,
  moving prod to `/work/platform-production/state`, is a migration for no gain. Dev is the one that
  leaves.
- **D2 — What the dev home starts with.** Recommended: `/work/platform-dev/home`, seeded once when
  absent by `scripts/dev.ts`. It copies `settings.json` and `secrets.json` and links `wallpapers`
  to `/work/platform-data/wallpapers`. It gets an empty database. Dev then looks like the owner's
  setup without writing to it.
- **D3 — Caches.** Recommended: `lsp` and `fonts` are download caches, not state. They resolve
  through a second helper, `platformCachePath()`, that ignores `PLATFORM_HOME`. A per-run server
  then does not re-download language servers each time. Everything else follows `PLATFORM_HOME`.
- **D4 — How a per-run server reaches the page.** Recommended: keep the one shared Vite. In DEV
  only, `defaultServerUrl()` reads an origin that the CLI injects with Playwright's
  `addInitScript`. The CLI also sets its own `PORT` so the helpers above follow. A Vite per run
  costs seconds per run and a second HMR graph. `VITE_SERVER_URL` is fixed at Vite start, so it
  cannot vary per run.
- **D5 — Which verbs may use the mesh.** Recommended: `look`, `trace`, `renders` and `caches`
  keep `--url` on the mesh, because they only load the page. `scenario` refuses a `/platform/` URL
  unless the scenario declares `readOnly: true` on its `Scenario` type
  (`scripts/agent/scenarios/index.ts:147-153`). None qualifies today.
- **D6 — Fixture row cleanup.** Recommended: none per fixture. With per-run homes the whole
  database goes when the run ends, so `releaseFixture` stays as it is. Only the existing rows in
  `~/.platform` need cleaning, once (Phase 4).

## Phases

### Phase 1: One home override

1. `home.ts`: `platformHomePath()` resolves `Bun.env.PLATFORM_HOME` when set, otherwise
   `~/.platform`. Resolve per call, like `resolveDefaultDatabasePath`, so tests can set it.
2. Add `platformCachePath()` for `lsp` and `fonts` (D3), and switch
   `apps/server/src/lsp/installers.ts:49` and `apps/server/src/fonts/service.ts:41` to it.
3. `app.ts:167-175`: wallpapers, palettes and themes use `platformHomePath()`. Do not route them
   through `options.homeDirectory`, which stays the user's home for the file system.
4. Delete the per-file variables that `PLATFORM_HOME` covers, where no test needs them on their
   own. `FS_METADATA_DB=:memory:` stays, because tests use an in-memory database.
5. A server test sets `PLATFORM_HOME` to a temp directory and asserts that settings, database,
   attachments, wallpapers and themes land there, and that `lsp` does not.

### Phase 2: Dev gets its own home

1. `scripts/dev.ts` sets `PLATFORM_HOME=/work/platform-dev/home` when unset, and seeds it once
   (D2).
2. The desktop shell keeps the default. It is the owner's app, not a dev server.
3. Restart the dev server once. Confirm that its `/proc/<pid>/fd` holds the dev database and not
   `~/.platform/fs-metadata.sqlite`.

### Phase 3: Isolated `agent:browser` runs

1. New `scripts/agent/isolated-server.ts`, built on the `browser-file-server.ts` recipe:
   - spawns `bun src/index.ts` in `apps/server` on a free port
   - `PLATFORM_HOME` and `OBSERVABILITY_DIR` under `/work/tmp/fregat-agent-<run>/`
   - `SERVER_ALLOWED_ORIGINS` includes the Vite origin
   - waits for `/health`, then stops the server and removes the directory on exit and on signals
2. `scripts/agent/browser.ts` starts it for `scenario`, `look`, `trace`, `renders` and `caches`
   against Vite. It injects the origin (D4) and sets `PORT` and `OBSERVABILITY_DIR` for the
   helpers and for `scripts/agent/logs.ts:22`. `--shared-dev` keeps today's behavior for
   debugging the running dev server.
3. The `/platform/` guard (D5) goes in `browser.ts`, before any page opens.
4. Evidence `summary.md` names the run's server port and state directory.
5. Docs, in the same pass:
   - AGENTS.md "Dev Server" becomes: "A dev server is always running; never start another by
     hand. `agent:browser` starts its own throwaway API server per run against the shared Vite and
     removes it afterwards."
   - `SKILL.md:12` gets the same change. `:18` and `:62` drop the mesh advice for scenarios.
   - Per-feature notes under `.agents/skills/verify-fregat/features/` drop their mesh lines.

### Phase 4: One-off cleanup of `~/.platform` — owner's OK required

Do not run this without the owner's explicit approval in the session. It deletes rows from the
owner's real database.

1. Print the counts first (the queries above) and the three non-fixture recents that stay.
2. Projects: send `project.delete` through `POST /orchestration/commands` on prod for each live
   project whose worktrees are all under `/work/tmp`. Do it in batches, logging each result.
3. Recents and addresses: with prod stopped, delete the `fs_metadata.last_picked_at` rows and the
   `workspace_addresses` rows under `/work/tmp` in one transaction. Take a `.backup` copy first,
   into `/work/tmp/plan146-backup-<stamp>.sqlite`.
4. Restart prod and confirm that the project menu lists only real folders. Confirm that the prod
   log's `fs` `NOT_FOUND` rate drops.

## Verification

- Phase 1: the server test above, plus a `bun --bun vitest` run of the existing settings and
  database-path tests.
- Phase 2: the `/proc` check above, and `bun run agent:browser look` against dev showing the
  owner's theme and wallpaper (the seeded settings).
- Phase 3:
  - Run one fixture scenario (`chat-draft-context-strip`) and one settings scenario
    (`wallpaper-mode-toggle`).
  - Before and after, compare the sha256 of `~/.platform/settings.json` and the row counts in
    `~/.platform/fs-metadata.sqlite` and the dev home. Neither may change.
  - The run directory under `/work/tmp` must be gone.
  - `scenario <name> --url https://omarchy.mesh.shaulavo.dev/platform/` must refuse.
- Phase 4: the before and after counts, and a `look` on the mesh.
- Deploy with `bun run deploy --server` after Phase 1, since the server reads the new variable.

## Out of scope and not copied

- Automatic pruning of recents whose folder is gone, and log levels for expected 404s. The log
  noise plan owns those.
- Isolating the Claude and Codex homes (`~/.claude`, `~/.codex`). Scenarios that drive a real
  provider still use the owner's CLI login.
- Parallel `agent:browser` runs sharing one Vite beyond what D4 gives. Each run already has its own
  API server.
