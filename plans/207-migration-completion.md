# Monorepo migration completion

Status: Approved by the owner on 2026-09-30. npm authentication, initial publication and
trusted-publisher setup wait until this migration is complete.

## Completion checks

All tracked package families install, build, typecheck, lint and test from the canonical
workspace. Each public mirror installs and builds from its exact folder without sibling
checkouts. Shared tool versions and configuration are checked against drift. Root CI and
library CI pass. Every mirror updates through ordinary pushes. Platform serves the final
commit and passes its live check. Existing standalone checkouts remain untouched.

## Execution

- [x] Read the workflow principles and capture the clean main baseline (`f4c8833e6`).
- [x] Separate source migration from npm publication. Keep plans 204–206 as subsequent
      feature work; their cross-family dependencies require the deferred hotkeys publication.
- [x] Audit package manifests, toolchain configuration, verification coverage and mirrors.
- [x] Align shared tooling and add checks for the concrete gaps found by the audit.
- [x] Make the hotkeys mirror independently installable and verifiable.
- [x] Configure repository-scoped mirror authentication and create the hotkeys repository.
- [ ] Verify ordinary mirror pushes, exact trees and standalone checks.
- [ ] Independently review the changes, pass local checks and remote CI, then merge.
- [ ] Update the shared checkout, deploy and inspect the served release.
- [ ] Record completed source migration and the separately deferred npm steps in Plan 207.

## Verification and decisions

Baseline main CI and the workspace-library workflow passed on `f4c8833e6`. Its mirror
workflow skipped authentication because `MIRROR_TOKEN` is absent. The hotkeys folder has
two packages and no standalone root manifest, so its exact mirror currently cannot resolve
its catalog dependencies.

The canonical catalog pins the shared tools. `workspace:sync` updates literal versions in
standalone family manifests; `workspace:check` rejects compiler, formatter, runner, Bun and
catalog drift. TypeScript 7 owns CLI compilation. The separately named TypeScript 6 API is
used by Editor's language service, its textbuffer build and Astro's checker.

Root formatting covers repository configuration and workflows. Editor root scripts and the
site app now participate in lint and format checks. Family lint policies and generated-file
exclusions remain local to their standalone packages. The app's duplicate gates keep their
existing app/shared-module scope; independently distributable libraries keep their own
architecture and public API checks.

CI's final verdict now waits for the library tests, Editor architecture health and isolated
install/build/typecheck/lint/format checks for all three exact mirror folders. The site job
builds both family sites. The standalone Editor mirror has no dependency updater that can
write back to the mirror; the canonical updater runs in Fregat.

Local checks pass: 23 workspace builds, all workspace typechecks, lint and format checks,
generated artifacts, whole-tree gates and 302 root-script tests. Hotkeys' exact standalone
folder passes its full verification. Editor's exact standalone folder passes builds,
typechecks and language-service tests. Independent review found no remaining blockers.

The local checklist and decision log are in `/work/tmp/monorepo-completion/`. Verification
logs and standalone checkouts use that directory. Architecture exploration is skipped
because this work preserves the imported package APIs and existing subtree mirror layout.
