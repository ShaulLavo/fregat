# One server and a one-command mesh deployment

Status: proposed, implementation not started. Requested 2026-09-12.

Every change ships to the mesh so a production build is always viewable from the owner's own devices ([AGENTS.md § Deployment](../AGENTS.md#deployment-the-mesh)). Today that deploy is a hand-run procedure that was reconstructed from old release directories and systemd unit files, and it takes two processes, two ports, two mesh routes, and a build-time API URL to serve one application. This plan makes the deploy one command and the served application one server.

It promotes the "One server owns the application" section of the [deployment design](../docs/deployment-design.md) into executable work and leaves that document's npm and desktop packaging story where it is. [Root PLAN.md](../PLAN.md) owns scheduling. The mesh is a Tailscale-only local deployment and may remain the deployment indefinitely, so nothing here assumes a later public host.

## What deploys today

| Piece            | Current state                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web              | `platform-web-prod.service` runs `vite preview --outDir /work/platform-production/current-web --base /` on 127.0.0.1:3300. `current-web` is a symlink into `/work/platform-production/releases/<UTC stamp>-<commit>-<slug>/web`.                             |
| Server           | `platform-prod.service` runs `apps/server/dist/index.js` from this checkout on 127.0.0.1:3301. A build in the checkout becomes production on the next restart with no release boundary.                                                                      |
| Mesh routes      | `mesh serve` proxies `/platform` → 3300 and `/platform-api` → 3301 on `omarchy.mesh.shaulavo.dev`, both with cross-origin isolation.                                                                                                                         |
| API address      | Baked at build time. [`client.ts`](../apps/web/src/lib/client.ts) reads `VITE_SERVER_URL`; [`index.html`](../apps/web/index.html) inlines the same value for the wallpaper preload. The web is built with `--base /platform/`.                               |
| Origin allowlist | `SERVER_ALLOWED_ORIGINS` in the unit file. [`app.ts`](../apps/server/src/app.ts) snapshots the first allowed origin as the machine service's web origin.                                                                                                     |
| Procedure        | Not in the repository. Build config, build logs, and a headless live check (`verify-web.mjs`) live only inside earlier release directories and are copied forward by hand. `scripts/prod.ts` starts Vite preview and the server together and is unused here. |

## Decisions

| Decision                                  | Proposed behavior                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — the server serves the web            | The Elysia server serves the built `web/` directory. Production runs no Vite preview. One port, one systemd unit, one mesh route.                                                                                                                                                                                                                                                         |
| D2 — the API address comes from the page  | The frontend derives its primary backend from `location.origin` plus `import.meta.env.BASE_URL`. `VITE_SERVER_URL` stays as a development-only override. The wallpaper preload in `index.html` uses the same derivation. One build works on any port or route.                                                                                                                            |
| D3 — a narrow static contract             | Serve only the release's `web/` files. Answer document navigations for `/`, `/~…`, and `/@…` with `index.html`. Everything else that misses a file is an ordinary 404, including missing scripts, workers, and wasm. No unrestricted catch-all. Fingerprinted `assets/` get immutable caching; `index.html` and unversioned files revalidate. Content types are preserved, wasm included. |
| D4 — every release is a directory         | `/work/platform-production/releases/<stamp>-<commit>-<slug>/` holds `web/`, `server/`, `build-config.json`, and the build logs. One `current` symlink covers both halves. Rollback is one symlink move. The unit points at `current/server/index.js`, never at the checkout.                                                                                                              |
| D5 — one command                          | `bun run deploy` runs the whole procedure: build, release directory, candidate verification, symlink swap, restart, live check, and the resulting URL. It refuses to swap when the candidate fails verification and prints the rollback command when the live check fails.                                                                                                                |
| D6 — the procedure lives in git           | The deploy script, the live check, and the systemd unit template live under `scripts/deploy/`. The script installs the unit. Nothing about the deploy is knowable only from the production machine.                                                                                                                                                                                       |
| D7 — the release identifies itself        | The server exposes its release name, commit, and dirty-file count on a small unauthenticated read-only endpoint. "Did it land" is one request, not a grep through minified JavaScript.                                                                                                                                                                                                    |
| D8 — the route prefix stays for now       | The app keeps being served under `/platform` on the per-host mesh name, so the build keeps `--base /platform/` and D2 must include the base path in the derived address. Removing the prefix depends on a mesh feature (Phase 4).                                                                                                                                                         |
| D9 — mesh gets no deploy verb             | Mesh decision [D22](../../mesh/docs/plan/01-decisions.md) says serving is exposure, not deployment: no build, version, or promote step and never a `mesh deploy`. Release directories, the `current` swap, and health checks belong to this repository's deploy script. A mesh-side release primitive is rejected.                                                                        |
| D10 — cross-origin isolation is preserved | The mesh route keeps `--isolate`. The proxy sets the isolation headers on the way back, so the server does not need to. A later direct-port or static path must send them itself.                                                                                                                                                                                                         |

## Phase 1 — the deploy command

No product change. This phase turns today's manual procedure into `scripts/deploy/mesh.ts`, exposed as `bun run deploy`, and ships the same two processes it ships today.

1. **Build.** `bunx tsgo --build` and the web build with the current base and API URL into `<release>/web`; the server build into `<release>/server` (D4). Both logs are written next to the outputs, and `build-config.json` records commit, dirty-file count, source path, API URL, base, and the previous release.
2. **Verify the candidate.** `index.html` carries the expected server URL and `/platform/assets/` paths and no `/assets/` root references; the ghostty wasm asset exists; the server bundle starts with `--describe`-style dry run or an equivalent import check.
3. **Swap.** `ln -sfn` into a temporary link and `mv -T` over `current`. Restart the web unit. Restart the server unit only with `--server`, because a server restart drops every live terminal and agent session.
4. **Live check.** Move the earlier release's `verify-web.mjs` into `scripts/deploy/live-check.mjs`, drop its release-specific inputs, and run it against the mesh URL. It records page errors, console errors, failed requests, and the orchestration WebSocket handshake. A failure prints the previous release path and the exact rollback command.
5. **Units in git.** `scripts/deploy/systemd/` holds the unit templates; the script renders and installs them with `systemctl --user daemon-reload`. The `platform-prod` unit changes from the checkout path to `current/server/index.js` in this phase.

Completion: a fresh clone can deploy with one command, `git status` in the checkout shows nothing about the deploy that is not committed, and a deliberate rollback restores the previous release with one symlink move.

## Phase 2 — the server serves the web

1. **Static serving module.** A `apps/server/src/web/` module owns the contract in D3. Prefer Elysia's static plugin for asset serving if it can be constrained to the release directory and does not answer unknown routes with `index.html`; otherwise serve the files directly. The document fallback matches only the frontend's own route shapes, which today are `/`, `/~`, and `/@` prefixes, and lives in this module, not in a catch-all. Verify the editor and terminal workers and the wasm artifact through the built bundle, not through the dev server.
2. **Release-relative paths.** The web directory is resolved relative to the release, from an explicit `WEB_ROOT` environment value in the unit, with no default that points into the checkout. A missing directory fails startup with a structured error that names the release.
3. **Origin-derived API.** `client.ts` computes the primary origin from the page. `index.html` computes the wallpaper preload from the same rule. Search every `VITE_SERVER_URL` and `3001` reader in `apps/web`, `packages/client-core`, and `scripts/` and leave only the development override. Requests without an `Origin` header for public files must work; the API and WebSocket origin guard stays inside the API boundary and its fetch-metadata and referrer handling is verified against the packaged page.
4. **One address.** The machine service's web origin and the allowed-origins list are derived from the bound address and the configured mesh origin instead of `auth.allowedOrigins[0]`. Additional trusted origins remain explicit.
5. **Release endpoint (D7).** `GET /release` returns the release name, commit, and dirty count read from `build-config.json` beside the server bundle.
6. **Retire the second process.** Remove the Vite preview from `scripts/prod.ts` and the web unit from `scripts/deploy/systemd/`. `mesh unserve /platform-api`, point `/platform` at the server port, and delete the web unit on the machine. Update the AGENTS.md deployment section to the single-route shape.

Completion: one unit, one port, one mesh route; a deploy with only web changes is a symlink move with no restart; the live check passes with no loopback requests and no baked URL in `index.html`.

## Phase 3 — deploy on every change, cheaply

1. The deploy script gains `--web-only` as the default fast path: build the web, verify, swap, live-check, no restart.
2. The build-config records whether the checkout was dirty; the live check asserts the release endpoint matches the candidate's name so a stale bundle cannot pass.
3. The check compares its own findings against the previous release's `live-check.json` and reports only new failures, so a pre-existing aborted log-ingest request does not fail a deploy.

Completion: an agent can finish a task, run one command, and report the release name and URL without reading any production file by hand.

## Phase 4 — drop the route prefix (mesh side, optional)

The private wildcard certificate covers one label under `mesh.shaulavo.dev`, so `platform.omarchy.mesh.shaulavo.dev` is not certifiable today, but a service-level name such as `platform.mesh.shaulavo.dev` with an A record to omarchy's tailnet address is. That is a mesh feature in the mesh repository, tracked with its private-names work: a named origin that resolves to one host and mounts one service at `/`. Mesh's D22 does not object; the name is still exposure of something that already runs.

When it exists, the web build drops `--base /platform/`, D2's derivation reduces to `location.origin`, and the deploy script's candidate check changes accordingly. Until then D8 holds and this phase does not block the others.

## Verification boundaries

- Phase 1 is verified on the production machine by a real deploy and a real rollback, recorded in the release directories it creates.
- Phase 2 needs a browser test that loads the packaged `index.html` through the server with no dev server, navigates a `/~` deep link by refresh, opens a terminal, and fetches the wasm artifact with the right content type. It runs in `apps/web`'s browser project against the real in-process server per the testing rules in AGENTS.md.
- Origin handling is proven with requests that carry no `Origin`, a same-origin `Origin`, and a foreign `Origin`, for a public file, an API route, and the orchestration WebSocket.
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No npm launcher, desktop runtime bundle, or packaged Bun. Those sections of the deployment design stay proposed.
- No public exposure. The mesh route stays tailnet-only under mesh D15.
- No multi-machine deploy. Federated servers on other machines remain source installations per [federated environments](../docs/federated-environments.md).
- No `mesh deploy`, release cache, or artifact lifecycle inside mesh (D9).
