# Plan 151: Remote machines run the primary's server release

## Status and authorization

- Status: PROPOSED — D1–D5 have recommended answers; D2 and D4 want the owner's confirmation.
- Priority: P1 while the Mac is a daily machine. `shaul-mac` cannot connect today.
- Effort: M (roughly 500–700 lines: deploy, the remote scripts, one route, one web action).
- Risk: MED. It writes to another machine's home directory and replaces its `platform-server`
  launcher.
- Planned at: Platform `e1d61502`, 2026-09-25. Origin: the owner, while connecting `shaul-mac`
  from the UI: "the production builds … should probably be different and a lot easier. There's no
  code, there is just whatever's built."
- Depends on [Plan 150](150-remote-server-version.md) Phase 1 (server-side protocol check and a
  structured error on the machine state). This plan replaces Plan 150 Phase 2 for production
  primaries. [Plan 152](152-remote-dev-builds.md) is the development counterpart.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy --server`.

## Outcome

A production primary (the mesh server) puts **its own server release** on a remote machine: no
source, no Editor checkout, no `bun link`. "Update server" on a machine whose server is out of date
copies the release over SSH, installs its handful of platform-specific runtime packages there,
restarts the remote server and reconnects. The same action installs the server on a machine that
has none, so the only thing a remote needs is `bun` and SSH.

## What exists today

- A server release is already self-contained JavaScript. `apps/server` `build`
  (`apps/server/package.json:22`) is `bun build src/index.ts --target bun` with only `sharp` and
  `@anthropic-ai/claude-agent-sdk` external, plus the Claude discovery worker. The current release's
  `server/` is `index.js` (4.2 MB, the editor LSP packages and `@workspace/pty` inlined), the worker
  and `assets/` (16 MB of bundled wallpapers).
- What the bundle still resolves at runtime, relative to its own path:
  - `sharp` (`apps/server/src/themes/wallpapers/decode.ts:1`) and the Claude Agent SDK. Both ship
    per-platform native packages.
  - `typescript` and `typescript-language-server/lib/cli.mjs` via `import.meta.resolve`
    (`apps/server/src/lsp/typescript/runtime.ts:22-23`).
  - `pyright` and `vscode-langservers-extracted` through `resolvePackageBinary`
    (`apps/server/src/lsp/installers.ts:84`).
- Deploy satisfies those with a symlink: `linkServerDependencies`
  (`scripts/deploy/release.ts:124-130`) points `server/node_modules` at this checkout's linux-x64
  `apps/server/node_modules`. That is the only thing that ties a release to this machine.
- The remote side assumes a source checkout end to end:
  - `installationSchema` is `{ kind: 'source', directory, executable }`
    (`apps/server/src/installation/descriptor.ts:9-13`).
  - The launcher file execs `apps/server/src/index.ts` with `--env-file=.env`
    (`apps/server/src/installation/install.ts:40-58`).
  - The launch script imports `./packages/contracts/src/health.ts` and `evlog` from the checkout
    (`apps/server/src/machines/remote-scripts.ts:38-45`). It spawns
    `apps/server/src/index.ts` itself (`:187`).
  - `probeCommand` finds `platform-server` on PATH or in `~/.local/bin` (`remote-scripts.ts:12-21`).
    `establish` runs probe → launch → forward → readiness → identity
    (`apps/server/src/machines/launcher.ts:175-244`).
- Nothing copies anything to a remote. Routes are connect, disconnect, auth and events
  (`apps/server/src/machines/routes.ts`).
- The Mac today (`plans/150-remote-server-version.md`, Findings) runs a hand-built source rig that
  is not a git checkout, with a curated darwin dependency folder. Its `bun` is `~/.bun/bin/bun`
  1.4.0, the same version as `packageManager` here (`package.json:120`).
- Defect found while planning: `readCheckout` (`scripts/deploy/release.ts:60-64`) takes
  `git status --porcelain` through `output()`, which trims (`scripts/deploy/run.ts:39-42`). The first
  line loses its leading space and `line.slice(3)` cuts the path's first letter. Every
  `build-config.json` records it (`pps/server/...`).

## Decisions

- **D1 — What travels.** Recommended: the running server's own release directory, `server/` only.
  The web build stays on the primary (the remote serves the API; the browser loads the web from the
  primary). A production server finds its release from its own bundle path
  (`import.meta.dirname` is `<release>/server`). A development primary has no release. Its button
  says so and points to Plan 152.
- **D2 — Runtime packages (owner).** Recommended: deploy writes `server/runtime/package.json` into
  each release. It lists the runtime packages above at the exact versions in `bun.lock`; `sharp` and the Claude
  SDK bring their natives as optional per-platform packages. The remote runs `bun install --production` against it.
  The alternative is to ship a platform tarball per target from this machine. That needs a
  cross-platform `bun install --os/--cpu` here, and it breaks on packages that build natives
  during install.
- **D3 — Remote layout.** Recommended:
  `~/.platform/server/releases/<release>/` holds the release, and `current` is a symlink swapped
  atomically. `runtime/<manifest sha256>/node_modules` is shared by every release with the same
  manifest, so a web-only redeploy never reinstalls. Keep the running release and the one before
  it; delete older ones after a successful swap.
- **D4 — Which launcher (owner).** Recommended: `~/.local/bin/platform-server` becomes the
  release launcher (`kind: 'release'`). Development builds get their own channel and
  `~/.local/bin/platform-server-dev` (Plan 152 D2). A production primary probes `platform-server`.
  Replacing the Mac's current launcher leaves the old rig on disk untouched;
  `bun run server:install` from it restores it.
- **D5 — State on the remote.** Recommended: no `.env` for a release. The server uses its defaults
  under the remote user's `~/.platform`, the same way the mesh unit runs here. Plan 146's
  separation of dev and prod state applies to the remote as it does locally: the dev server of
  Plan 152 channel gets its own state directory.

## Phases

### Phase 1: A release carries its runtime manifest

1. Fix `readCheckout`'s porcelain parsing (use the untrimmed stdout, or `-z`).
2. `scripts/deploy/release.ts`: `writeRuntimeManifest(release)` after `buildServer`/`copyServer`.
   It takes the resolved versions from `bun.lock` for `sharp`, `@anthropic-ai/claude-agent-sdk`,
   `typescript`, `typescript-language-server`, `pyright` and `vscode-langservers-extracted`. It
   fails the deploy if one is missing. The list lives in one constant beside the server's
   `build` externals, and a test asserts that every `--external` in `apps/server/package.json` is in it.
3. Bundle the launch helpers as `server/remote-support.js` (the health schema and `createError`), so
   a release-based launch script imports that instead of `./packages/contracts/src/health.ts`
   and `evlog` from a checkout.
4. `verifyCandidateFiles` checks both files exist.

### Phase 2: A `release` installation kind

1. `installationSchema` becomes a variant: `source` (unchanged) and
   `release { directory, executable }`, where `directory` is the `current` link.
2. `launcherSource` writes the release launcher: it execs `<executable> <directory>/server/index.js`
   and answers `--describe`. The source launcher is unchanged (and moves to `platform-server-dev`
   under D4).
3. `remote-scripts.ts`: the prelude imports `./server/remote-support.js` for a release and the
   checkout paths for source. `launch()` spawns `server/index.js` for a release (no `--env-file`).
   One helper chooses `{ importBase, entry }` by kind, so the two scripts do not fork.
4. The Plan 150 protocol step compares the remote descriptor with this server's
   `ORCHESTRATION_WS_PROTOCOL_VERSION`. A release also reports `serverVersion`. The launcher
   records both in the connect wide event.

### Phase 3: Install and update over SSH

1. `apps/server/src/machines/update.ts`, run through the launcher's SSH control connection
   (the `command` helper, `launcher.ts:257`):
   1. **probe**: `uname -sm`, the `bun` path (`command -v bun`, then `~/.bun/bin/bun`) and its
      version, the installed release name if any. Missing `bun` is a catalog error whose `fix` is the
      install one-liner. A `bun` older than `packageManager` is a catalog error whose `fix` is
      `bun upgrade`.
   2. **transfer**: skip if `releases/<release>` already exists. Otherwise stream
      `tar -c server/` over SSH into `releases/<release>.partial`, then rename it. `tar` needs nothing
      on the remote that `rsync` would.
   3. **runtime**: if `runtime/<sha>/node_modules` is missing, copy the manifest there and run
      `bun install --production`. Link `releases/<release>/server/node_modules` to it.
   4. **swap**: point `current` at the new release (write a temporary link, then rename), and write
      the release launcher.
   5. **restart**: stop the managed server through the existing `stopScript` path. Other leases
      follow the replacement process, as they do today (`docs/federated-environments.md:110-115`).
      Then run a normal `connect`.
2. Refusals are `machines.*` catalog entries with a `fix` the user acts on: `SSH_UPDATE_NO_BUN`,
   `SSH_UPDATE_OLD_BUN`, `SSH_UPDATE_TRANSFER`, `SSH_UPDATE_INSTALL` (with the install log tail in
   `internal`), and `SSH_UPDATE_NOT_A_RELEASE` for a development primary.
3. `POST /machines/:name/update` (`routes.ts`). It takes only a machine name and resolves the
   machine from settings exactly as connect does. The only values that reach execution are the
   probed paths and this server's own release directory, all validated absolute paths and
   `shellQuote`d. No client-supplied string or setting value becomes a flag or a path.
4. One wide event `machines.server.update`: machine, fromRelease, toRelease, platform, bun version,
   bytes sent, whether runtime was reused, per-step durations, outcome.

### Phase 4: The button

1. `apps/web/src/features/environments/utils/mutation-keys.ts` (new) holds `updateServer(name)`.
   The mutation calls the route, has `scope: { id: 'machine-update:' + name }`, and invalidates
   the machine connection state on settle. Its pending state comes from `useIsMutating`, and the
   button shows `OrbitLoader`.
2. It shows when the machine's structured error (Plan 150 Phase 1) is the protocol mismatch
   ("Update server") or the probe's not-installed error ("Install server"), in:
   - the Connect machine picker,
   - the machine notice (`features/chat-mode/components/machine-connection-notice.tsx`),
   - Settings › Machines (`features/settings/components/machine-row.tsx`).
3. A failure keeps Fix with AI beside it, as every machine error now does.

## Verification

- Deploy: a unit test for the porcelain fix (first line keeps its first letter). A test that the
  runtime manifest covers every `--external`. A deploy dry run writes `server/runtime/package.json`
  and `server/remote-support.js`.
- Remote scripts under a real `bun -e` against a temp home. First install, then a second update
  that reuses runtime. A `current` swap interrupted halfway leaves the old release runnable. Release
  and source launch helpers select the right entry.
- Launcher tests through the injectable `spawn`/`forward`/`fetcher` seams: update → restart →
  connect reaches `live`; each refusal carries its catalog code.
- Web: a `dom` test that a protocol-mismatch machine shows "Update server", and the button's
  pending state comes from the mutation cache.
- Live, by the owner (the agent sandboxes cannot resolve the Mac): on the mesh, open Connect machine →
  `shaul-mac` shows the mismatch → Update server → the machine goes live. `GET /release` through the
  machine's proxy names the same release as the primary.

## Out of scope

- Development primaries (Plan 152).
- Shipping `bun` itself, Windows remotes, and automatic updates. Updating is always an explicit
  action.
- The web build on the remote.
