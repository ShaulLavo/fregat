# Remote machines run the primary's server release

## Status

- Done 2026-09-25 (completion wave, lane L5): Phases 1–4 implemented. This file was Plan 151 and is
  kept as the design record Plan 152 builds on.
- Owner check pending: the live update of `shaul-mac` (open Connect machine on the mesh, press
  Update server on the out-of-date Mac, and confirm it goes live and `GET /release` through its
  proxy names the primary's release). Agent sandboxes cannot reach the Mac.

## Shared with lane L4 (Plan 148 staged restarts)

- A release is `releases/<name>/` with `server/` inside; `<name>` is
  `<UTC stamp>-<commit>-<slug>`, which matches the release-name pattern `update.ts` accepts.
- `current` and L4's `pending` are symlinks to a release directory. A bundled server's
  `import.meta.dirname` resolves to `<release>/server` whichever link started it, so a staged but
  unpromoted primary ships its own staged release.
- Every release built by `deploy --server` carries `server/runtime/package.json`, `server/runtime/bun.lock`, and
  `server/remote-support.js`; the update refuses a release without them (`SSH_UPDATE_NOT_A_RELEASE`).
- Locally `server/node_modules` links to the checkout's installed dependencies; the transfer
  excludes it and the remote links `runtime/<manifest-and-lock sha256>/node_modules` in its place.

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
    (`apps/server/src/lsp/installers.ts:84`). Reconciled 2026-09-25: these do not resolve beside the
    bundle. `resolvePackageBinary` looks in the LSP download root (`~/.platform/lsp/node`), then
    `PATH`, then downloads on demand, so a release does not carry them. `pyright` is not in
    `bun.lock` at all, and `vscode-langservers-extracted` is a dev dependency.
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
    `establish` runs probe → launch → forward → readiness → protocol → identity
    (`apps/server/src/machines/launcher.ts:175-244`).
- Nothing copies anything to a remote. Routes are connect, disconnect, auth and events
  (`apps/server/src/machines/routes.ts`).
- The Mac today runs a hand-built source rig at `/Users/shaul/projects/platform-verification`
  that is not a git checkout (Plan 150's findings, 2026-09-25): `node_modules` links to a curated
  darwin install, `.verification-editor/` holds copied editor packages, and `.env` points settings,
  secrets and the workspace root at isolated paths. The Mac's global `bun link` registry maps
  `@singapore-editor/*` to a stale Editor copy. Its `bun` is `~/.bun/bin/bun` 1.4.0, the same
  version as `packageManager` here (`package.json:120`).
- The launch script checks the protocol (Plan 150). A stale managed server is relaunched when the
  checkout's own `ORCHESTRATION_WS_PROTOCOL_VERSION` matches and no other lease holds it; anything
  else fails with `machines.SSH_PROTOCOL`, whose `internal` names the expected, running and
  checkout protocols and the other-lease count. A missing installation is
  `machines.SSH_NOT_INSTALLED` (`apps/server/src/machines/structured-errors.ts`).
- Defect found while planning: `readCheckout` (`scripts/deploy/release.ts:60-64`) takes
  `git status --porcelain` through `output()`, which trims (`scripts/deploy/run.ts:39-42`). The first
  line loses its leading space and `line.slice(3)` cuts the path's first letter. Every
  `build-config.json` records it (`pps/server/...`).

## Decisions

- **D1 — What travels.** Decided 2026-09-25: recommendation (completion wave). Recommended: the running server's own release directory, `server/` only.
  The web build stays on the primary (the remote serves the API; the browser loads the web from the
  primary). A production server finds its release from its own bundle path
  (`import.meta.dirname` is `<release>/server`). A development primary has no release. Its button
  says so and points to Plan 152.
- **D2 — Runtime packages (owner).** Decided 2026-09-25: recommendation (completion wave).
  Recommended: deploy writes `server/runtime/package.json` into
  each release. It lists the runtime packages above at the exact versions in `bun.lock`; `sharp` and the Claude
  SDK bring their natives as optional per-platform packages. The remote runs `bun install --production` against it.
  The alternative is to ship a platform tarball per target from this machine. That needs a
  cross-platform `bun install --os/--cpu` here, and it breaks on packages that build natives
  during install.
- **D3 — Remote layout.** Decided 2026-09-25: recommendation (completion wave). Recommended:
  `~/.platform/server/releases/<release>/` holds the release, and `current` is a symlink swapped
  atomically. `runtime/<manifest-and-lock sha256>/node_modules` is shared by every release with the same
  manifest, so a web-only redeploy never reinstalls. Keep the running release and the one before
  it; delete older ones after a successful swap.
- **D4 — Which launcher (owner).** Decided 2026-09-25: recommendation (completion wave).
  Recommended: `~/.local/bin/platform-server` becomes the
  release launcher (`kind: 'release'`). Development builds get their own channel and
  `~/.local/bin/platform-server-dev` (Plan 152 D2). A production primary probes `platform-server`.
  Replacing the Mac's current launcher leaves the old rig on disk untouched;
  `bun run server:install` from it restores it.
- **D5 — State on the remote.** Decided 2026-09-25: recommendation (completion wave). Recommended: no `.env` for a release. The server uses its defaults
  under the remote user's `~/.platform`, the same way the mesh unit runs here. Plan 146's
  separation of dev and prod state applies to the remote as it does locally: the dev server of
  Plan 152 channel gets its own state directory.

## Phases

### Phase 1: A release carries its runtime manifest

Done 2026-09-25 (completion wave). As built:

- `readCheckout` reads `git status --porcelain -z` untrimmed through `porcelainPaths`
  (`scripts/deploy/release.ts`, test `scripts/deploy/release.test.ts`, in `test:scripts`).
- The shared module is `apps/server/src/installation/release-files.ts` (Plan 152 D1):
  `RUNTIME_PACKAGES`, `runtimeManifest(lock)`, `writeRuntimeManifest(serverDirectory, lockfile)` and
  `missingReleaseFiles(serverDirectory)`. Deploy imports it. The list is the bundle's two
  `--external`s plus the two `import.meta.resolve` targets; `pyright` and
  `vscode-langservers-extracted` are out (see What exists today). A workspace resolution
  (`server/<package>`) in `bun.lock` wins over the hoisted one. A missing package throws
  `installation.RUNTIME_PACKAGE_MISSING`. Tests in `installation/tests/release-files.test.ts`
  check the `--external`s, the `import.meta.resolve` targets and the real `bun.lock`.
- `buildServer` writes the manifest. `copyServer` keeps the manifest of the release that built the
  bundle, because the current `bun.lock` may have moved on. A server copied from a release built
  before this change has neither file, and `verifyCandidateFiles` says to deploy with `--server`.
- `remote-support.js` is built by `apps/server` `build` from `src/installation/remote-support.ts`:
  `createError`, `healthDescriptorSchema` and `ORCHESTRATION_WS_PROTOCOL_VERSION`, about 100 KB,
  self-contained.
- A release server takes two steps: `apps/server` `build` (which also emits `remote-support.js`),
  then `writeRuntimeManifest(serverDirectory, bun.lock)`; `missingReleaseFiles` must return `[]`
  afterwards. Plan 152's dev build repeats this sequence, so its D1 "one shared module" is
  `release-files.ts` plus the `build` script.

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

Done 2026-09-25 (completion wave). As built:

- `installationSchema` is a `kind` variant. A release's `directory` must end in `current`, so its
  parent is always the server root.
- `install.ts` writes either launcher. The release launcher `cd`s to the server root and execs
  `<executable> <directory>/server/index.js` with `NODE_ENV=production`. It still writes
  `~/.local/bin/platform-server`; moving the source launcher to `platform-server-dev` is Plan 152.
- `remoteLayout(installation)` in `remote-scripts.ts` returns
  `{ workingDirectory, imports, entry, env, protocolSource }`. A release runs its launch and stop scripts in the server root
  (`~/.platform/server`), so `.platform-ssh-launch/` and `logs/` survive every `current` swap. It
  imports `current/server/remote-support.js` by absolute path and starts `current/server/index.js`.
  `installedProtocol()` returns the release's own constant; a source checkout still reads
  `orchestration-ws.ts`. `remote-scripts-release.test.ts` runs launch, reuse across a `current`
  swap, stop, and a stale server replaced by the release `current` names.
- The protocol report's `checkout` field is now `installed`, beside `installation` (the kind). A
  release that cannot relaunch reads "Install this server’s release on that machine, then Retry."
- `machines.ssh.connect` records `installationKind` and `serverVersion`.
- `releaseEntry` and `RELEASE_ENV` in `installation/descriptor.ts` are how every release starts;
  the release launcher and `remoteLayout` both read them.
- A failed launch's fix names `<workingDirectory>/logs/ssh-launch.log` (`launchFailureFix`), so a
  release points at the server root. An external server on a release machine is told to restart
  it from this server's release.
- Carry into Phase 3: `tar` must leave out the local `server/node_modules` link; Bun resolves the
  `current` symlink for the running entry, so `import.meta.dirname` names the real release; the
  Claude SDK's peers (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`) come from Bun's peer
  auto-install unless the manifest lists them.

1. `installationSchema` becomes a variant: `source` (unchanged) and
   `release { directory, executable }`, where `directory` is the `current` link.
2. `launcherSource` writes the release launcher: it execs `<executable> <directory>/server/index.js`
   and answers `--describe`. The source launcher is unchanged (and moves to `platform-server-dev`
   under D4).
3. `remote-scripts.ts`: the prelude imports `./server/remote-support.js` for a release and the
   checkout paths for source. `launch()` spawns `server/index.js` for a release (no `--env-file`).
   One helper chooses `{ importBase, entry }` by kind, so the two scripts do not fork.
4. The launcher's `protocol` step (`confirmProtocol` in `launcher.ts`) already compares the remote
   descriptor with this server's `ORCHESTRATION_WS_PROTOCOL_VERSION`. A release also reports
   `serverVersion`. The launcher records both in the connect wide event. The launch script reads a
   release's protocol from the release itself, where it reads `orchestration-ws.ts` for a source
   checkout.

### Phase 3: Install and update over SSH

1. `apps/server/src/machines/update.ts`, run through the launcher's SSH control connection
   (the `command` helper, `launcher.ts:257`):
   1. **probe**: `uname -sm`, the `bun` path (`command -v bun`, then `~/.bun/bin/bun`) and its
      version, the installed release name if any. Missing `bun` is a catalog error whose `fix` is the
      install one-liner. A `bun` older than `packageManager` is a catalog error whose `fix` is
      `bun upgrade`.
   2. Acquire the remote installation's SQLite transaction lock through activation and pruning.
      **transfer** verifies each release file against the outgoing content hashes; a damaged cache
      is retransmitted through a unique staging directory.
   3. **runtime** verifies the manifest and lock hash, then installs with
      `bun install --production --frozen-lockfile` and links the release to that runtime.
   4. **validate** boots the candidate with a temporary data home. **swap** records the prior link
      and launcher, then promotes the candidate atomically.
   5. **restart** and **connect** must reach the requested release identity. Another client holding
      the old process produces `SSH_UPDATE_IN_USE`. Activation failure restores the saved link and
      launcher and reconnects the previous release. Pruning starts after successful activation.
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
2. It shows when the machine's structured error is `machines.SSH_PROTOCOL` ("Update server") or
   `machines.SSH_NOT_INSTALLED` ("Install server"), in:
   - the Connect machine picker,
   - the machine notice (`features/chat-mode/components/machine-connection-notice.tsx`),
   - Settings › Machines (`features/settings/components/machine-row.tsx`).
3. A failure keeps Fix with AI beside it, as every machine error now does.

## Security constraints (from Plan 150)

Plan 150 closed 2026-09-25 with D1 (check at both ends of the launch), D3 (relaunch a stale server
only when no other lease holds it) and D4 (never restart an external server) decided as recommended
(completion wave). Its update phase was never built; these constraints carry over to Phase 3 here
and to Plan 152.

- The remote command is fixed text. Only the probed installation paths and this server's own
  release directory reach execution, as validated absolute paths passed through `shellQuote`. No
  setting value or client-supplied string becomes a flag, a path or a command.
- The route takes a machine name and resolves it from the `application`-scope machine record, the
  same way connect does.
- An update never runs on its own. Each refusal is a `machines.*` catalog entry with a `fix` the
  user acts on.
- The update touches only the Platform installation the probe named. It never touches `mesh`
  (which has its own update path on the Mac) or any other directory.
- One wide event per update: machine, directory, from and to release, install duration, outcome.

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

## Development builds (was Plan 152, done 2026-09-25)

A primary running from source (`bun dev`) has no release, so Update server builds one:
`buildWorkingTree()` (`apps/server/src/machines/dev-build.ts`) runs the `apps/server` build, copies
`dist` to a uniquely named outgoing directory, then writes the runtime manifest and lockfile.
All machine suppliers share one build coordinator. The artifact stays alive until every consuming
update finishes, then it is removed. Decisions D1–D4 as recommended (completion wave):

- **Channel.** A development build installs beside production: `~/.platform/server/dev` with its own
  `releases/`, `current`, `runtime/` and lease state, and `~/.local/bin/platform-server-dev`. A
  development primary probes `platform-server-dev`, so the mesh and `bun dev` never overwrite each
  other's server; a machine with only production installed reads "not installed" to a dev primary.
- **State.** The dev launcher and launch script set `PLATFORM_HOME=~/.platform-dev`.
- **Name.** `dev-<stamp>-<commit>[-dirty]-<uuid>`, so `/release` through the machine's proxy names the tree.
- The fix copy and the button's tooltip say the working tree is built. The wide event carries
  `channel`, `source: 'dev-build'`, `buildMs` and `bundleBytes`; a failed build is
  `machines.SSH_UPDATE_BUILD` with the build log tail in `internal`.

Owner check pending: from `bun dev`, Update server on `shaul-mac` goes live and its `/release`
names the `dev-…` build while the mesh's connection keeps its production release.
