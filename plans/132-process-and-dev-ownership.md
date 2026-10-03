# Processes, leases and dev plumbing each get an owner

Status: Approved, development closeout delivered 2026-09-30; native checks transferred to 114.

Plan numbers record creation order. The process-ownership work predates 207;
207 supplies canonical package locations for its final development checks.

## Development closeout

- [x] Replace the custom source reload plugin with standard Vite resolution and watching.
- [x] Unify browser, Node and source typechecks; repair the canvas/WebGPU spy overload.
- [x] Replace retained Editor adapter controllers and selector subscriptions during Fast Refresh.
- [x] Give terminal WASM owners Vite's native page reload boundary through React-plugin exclusions.
- [x] Record current Vite memory and cold dependency loading evidence.
- [x] Replace capture WebSocket rewriting with explicit terminal IDs across reloads and actions.
- [x] Pass focused tests and gates, and update the roadmap.
- [x] Commit, push and deploy the verified closeout.

Vite's module graph owns browser updates. The Editor React adapter refreshes in place;
Editor core and terminal resource owners use native page reloads. The terminal panel and
saved viewport hold cached modules and WASM resources, so Fast Refresh would retain old
implementations. Their explicit React-plugin exclusions let ordinary Vite propagation
reach the page boundary. No source plugin or reload callback is needed.
Main `3ca862a4b` (2026-09-30, outside the foundations wave) removed the last dev-server
interception: the app-save hot-update skip plugin, `GET /fs/app-write` and server `AppWrites`.
Vite now hot-updates every changed source file, including saves made from the app.

All web typecheck entry points run the browser/Node project build and the generated source
configuration. The source configuration shares Vite's alias map. Producer packages own
source unused checks. The canvas fixture preserves the DOM/WebGPU overloaded signature.

Capture ownership is selected before navigation and stored per browser tab. Factories,
cache admission, chat terminals and commands use the same namespace; transport remains
the native WebSocket. The real terminal-history scenario proves two-viewer replay, clear,
reload, restart and owned cleanup.

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

## Transferred native work

Plan 114 Gate 3 replaced the old window-title vibrancy workaround with direct native host
ownership. The owner accepted the Mac desktop paths on 2026-10-03 and approved Gate 4 removal.
The launcher connects to shared servers; quitting it flushes observability and leaves their
processes and terminals running.

## Verification record

The normal Vite watcher tests cover loaded source, unloaded source and generated output.
The live `dev-package-updates` scenario mounts the editor and terminal, invalidates both
packages, verifies replacement and shell replay, and verifies generated output leaves the
page running. This proof uses standard Vite aliases and no source reload hook.

The historical 2026-09-25 memory tuning experiment is superseded by current measurements.
No thread-count or allocator environment tuning is introduced. Existing explicit dependency
prebundling remains; change it only if cold-start evidence identifies a missing dependency.

The mesh-managed sequence passed with no console errors, failed requests or application
warn/error logs. Screenshot and frames were read back from
`/work/tmp/fregat-evidence/20260930T111254Z-scenario-dev-package-updates/`.
A second sequence against an empty-cache Vite instance passed in
`/work/tmp/fregat-evidence/20260930T111338Z-scenario-dev-package-updates/`.
The cold log initially exposed late discovery of `evlog/client`, the two Markdown micromark
utilities and `tree-sitter-md`; adding those four inputs to prebundling removes that late
optimizer reload. The final log contains one initial optimization and no later reoptimization.

On Vite 8.3.1 / Bun 1.4.2, the isolated Vite process measured 2,140,311,552 bytes peak RSS
and 1,819,598,848 bytes at the end of the editor/terminal update sequence; server readiness
was 204 ms. These are process measurements for this workload, not a before/after speed claim.
The program, configuration, log and samples remain in
`/work/tmp/fregat-evidence/plan132-cold-vite/`. No allocator/thread tuning was needed to
close this evidence item.

Earlier incomplete-optimizer runs also produced Chromium compositor crash dumps and failed
module requests. Resource checks found no OOM or descriptor exhaustion; the dumps lack
Chromium symbols. Both final update runs passed after completing prebundling. The exact
compositor failure mechanism remains unconfirmed; no browser flags or host settings changed.
A later Chromium `chat-queue` run hit the same failure. Its Firefox run passed the full
queued text/file/terminal payload proof in
`/work/tmp/fregat-evidence/20260930T111954Z-scenario-chat-queue/`. This broader Chromium
verification remains unconfirmed; the required package-update sequence passed on Chromium.

Terminal history and owned cleanup passed in
`/work/tmp/fregat-evidence/20260930T110313Z-scenario-terminal-history/`: clear and kill each
returned 200 for the capture-owned terminal. Native Mac checks remain with 114 Gate 3.

The product-capture workbench/chat retention proof passed in
`/work/tmp/fregat-evidence/20260930T111732Z-scenario-bottom-panel-persistence/`;
its workbench and chat terminals were both killed successfully with no unowned connections.
Terminal-tab navigation passed in
`/work/tmp/fregat-evidence/20260930T112105Z-scenario-terminal-tabs/` after waiting for the
new terminal's initial focus before testing list navigation. Its capture cleanup passed too.

Commit `459ec5732` passed all 108 focused tests, whole-tree gates and the full repository
typecheck, then shipped as `20260930T112423Z-459ec573-main`; the mesh live check passed.
A final configuration follow-up scopes the terminal Fast Refresh exclusions to source
serving, retaining production React Compiler optimization. Native server code is unchanged.
