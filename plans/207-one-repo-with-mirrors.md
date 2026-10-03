# Plan 207: One repo, with mirrors for the flagship packages

## Status and authorization

- Status: SOURCE MIGRATION DELIVERED 2026-09-30. npm publication remains deferred.
- The owner authorized final fixes and merging PR #199 on 2026-09-30. Mirror pushes must
  fast-forward without force; integration edits may change the split commit ids.
- Owner decision: all code we write for Fregat lives in the Fregat monorepo. Flagship packages
  that others should use standalone (the Editor, ghostty-webgpu, and `@fregat/hotkeys` from
  [203](203-fregat-hotkeys.md)) each keep a public repo that CI fills with an exact copy of their
  folder on every push to Fregat's main, and publish to npm from Fregat. Laravel and Symfony use
  this pattern (read-only split repos per component).
- Out of scope: tree-sitter-md, tree-sitter-x, mesh and the file tree are not mirrored or moved
  by this plan. The owner's revised [202](202-tui-ui.md) keeps terminal UI in `apps/tui/src/ui/`
  on upstream OpenTUI; it creates no toolkit package or mirror. The former bubli fork is not a
  pending relocation or release workstream.
- Source migration needs no owner action. npm authentication, initial publication and
  trusted-publisher configuration are a separate, deferred delivery unit. Old standalone
  checkouts remain available; deleting them or changing their permissions is outside this run.

## Cutover window and release conditions

PR #199 delivered the source import; PR #201 completed package alignment and CI coverage.
The captured import heads were Editor `17a020ad4b98830aeebdb106af95de8f06694973` and ghostty
`fd5c74283f83f780fcf60aab970d4c1fa6cc06cd`, with clean sibling checkouts on 2026-09-30.
Both heads remain ancestors of the delivered mirror splits. All three mirrors accepted
ordinary pushes and their trees match the canonical folders. This verifies the cutover
against the actual remote heads without discarding external commits or rewriting history.
Future development belongs in Fregat; sibling checkouts remain untouched references.

The owner requested complete source migration, tooling alignment and CI verification on
2026-09-30, with all npm setup and publication deferred until that work is finished. The
execution checklist is [migration completion](207-migration-completion.md).

Source import and npm publication are separate delivery units. Before 204/205 add a
cross-family hotkeys dependency, prove that the exact mirrored Editor/ghostty folder
installs and builds without sibling workspaces. `workspace:*` rewriting during npm publish
does not prove standalone mirror installation. Select and test a dependency arrangement
that supports both root workspaces and exact mirrors; publish the required hotkeys version
before mirroring a consumer commit that needs it. Record the first-publication and trusted
publisher gates without blocking unrelated source-import work on every package release.

## Why

Fregat is already a monorepo held together by hand: 13 tracked symlinks
(`packages/editor-* -> ../../Editor/packages/*`), `link:ghostty-webgpu`, CI checking out pinned
`editor-ref` and `ghostty-ref` siblings (`.github/actions/setup/action.yml`), Editor dist rebuilds
before Platform sees a change, Vite restarts after relinking, three copies of tooling (formatter
versions differ, the vitest patch lives in all three repos), and sessions pushing to three mains.
The keymap plans (203–206) would add a fourth cross-repo piece. The only thing separate repos
buy is a public home for packages we want others to use, and mirrors keep that.

## Layout after the move

```
fregat/
  apps/, packages/, scripts/      unchanged
  editor/                         mirrored to ShaulLavo/singapore (becomes its root)
    README.md, LICENSE, AGENTS.md, ARCHITECTURE.md, docs/, plans/, examples/, patches/
    package.json, turbo.json, tsconfig.json, .github/   (standalone root; used by the mirror)
    packages/editor, diff, find, lsp, markdown, textbuffer, react, solid, …   (20 packages)
  ghostty-webgpu/                 mirrored to ShaulLavo/ghostty-webgpu (one package)
  hotkeys/                        mirrored to ShaulLavo/hotkeys once 203 creates it
    packages/hotkeys, packages/react-hotkeys
```

- Fregat's root `workspaces` adds `editor/packages/*`, `editor/examples/*`, `ghostty-webgpu`
  and `hotkeys/packages/*`. The nested `editor/package.json` and `turbo.json` are the standalone
  roots the mirror uses; confirm Bun and Turbo treat them correctly inside Fregat in the first
  step.
- Everything a standalone user needs lives inside the family folder, including its `.github/`
  workflows: inert inside Fregat, active in the mirror, where they prove the copy builds and
  tests on its own.
- Editor plans (`E0xx`) and docs move with it and stay public through the mirror.

## Mirrors

- A Fregat workflow on every push to main splits each family folder with its history
  (`git subtree split` on a full-depth checkout; splitsh-lite drops the subtree-add merge
  history and would force a rewrite of the mirrors) and pushes it to the mirror's main. Mirrors are read-only: their
  README says development happens in Fregat; outside PRs are ported into Fregat by hand and
  closed with a link.
- The Editor and ghostty-webgpu are brought in with `git subtree add` (not squashed), so their
  history is part of Fregat. Verify that each existing mirror head is an ancestor of its new
  split so the first mirror push fast-forwards. Integration edits may change the split head. If it cannot, stop and
  ask the owner before force-pushing a mirror.
- Mirror repos keep their URLs, stars, issues and releases.

- Built in `.github/workflows/mirror.yml`: one matrix entry per family, full-depth checkout,
  `git subtree split --prefix=<folder> HEAD`, then a regular push to the mirror's `main`.
  Missing folders skip individually; missing repository deploy keys fail visibly. The job uses
  no split cache, serializes main runs, and fails with an error annotation on any rejected push.
- Mirror setup:
  - [x] Create the empty public `ShaulLavo/hotkeys` repository. Keep its initial history empty
        so the first hotkeys split can create `main` with a regular push.
  - [x] Configure a separate writable deploy key for each mirror. Fregat Actions secrets
        `MIRROR_EDITOR_SSH_KEY`, `MIRROR_GHOSTTY_SSH_KEY` and `MIRROR_HOTKEYS_SSH_KEY`
        authenticate only their respective repository. SSH verifies GitHub's published host
        keys. The workflow removes its temporary private key after each job.
  - [x] Capture the source heads, prove ancestry against the actual mirror heads and inspect
        the first successful ordinary pushes. Canonical development now happens in Fregat.
- Local verification used the workflow's exact shell against three temporary bare repos:
  first pushes, repeated unchanged splits and later fast-forwards passed. A divergent mirror
  rejected the push, returned exit 1 and retained its outside commit. Missing-folder and
  missing-credential paths passed. First remote pushes and exact tree equality passed after PR #201 merged.

## Rehearsal findings (2026-09-29)

Scratch rehearsal: `/work/reports/keymap-wave/207-rehearsal.md` (`/work/tmp/plan207-rehearsal-LV9V1Y`).

- `git subtree split --prefix=editor` reproduces singapore main exactly (`54e1e648`, 736
  commits); ghostty-webgpu likewise (`fd5c7428`, 73). Old heads stay ancestors after new Fregat
  commits, so mirror pushes fast-forward, provided nothing pushes to the mirrors between the
  freeze and the subtree add.
- Bun ignores the nested `editor/package.json`; the old `bun.lock` must be regenerated.
  Root Turbo ignores `editor/turbo.json`: move its per-task overrides into the root
  `turbo.json`, and set `"agentGuidance": false` in `editor/turbo.json`.
- Typecheck (38 packages, editor built first) and the `apps/web` build pass; the root needs
  `vite` as a devDependency.
- Knip goes red (~87 files, ~340 exports in `editor/` and `ghostty-webgpu/`): add those
  workspaces to `knip.json`.
- Root `typecheck`/`test`/`lint` now cover all Editor packages, examples and ghostty's browser
  tests; typecheck needs the Editor packages built first.
- Layout-dependent scripts to update: `bundle-report.ts`, `bundle-owners.test.ts`,
  `editor-open-benchmark.mjs`, `terminal-reload-proof.mjs`, the `quick-open-linked-file`
  scenario; delete `check-linked-sources.ts`. The setup action loses six sibling clone/build/link
  steps.
- oxfmt/oxlint versions already match; `.oxfmtrc.json` configs differ. The vitest patch is
  identical in all three repos. Editor packages are on TypeScript 6.0 against Fregat's 7.0.
- Lockfiles (owner, 2026-09-29): one root `bun.lock`, as Turbo expects. Delete
  `editor/bun.lock` and `ghostty-webgpu/bun.lock`; the mirrors' standalone CI runs a plain
  `bun install`, which also surfaces breakage from new dependency releases.

## Publishing

- Changesets at Fregat's root. Fixed version groups: the 20 public `@singapore-editor/*` packages release
  together (they are on independent `0.1.x`/`0.2.0` versions today; the first grouped release
  aligns them), `@fregat/hotkeys` with `@fregat/react-hotkeys`, and `ghostty-webgpu` alone.
- Built at the root: `@changesets/cli` 3.0.3, `.changeset/config.json` and the `changeset`
  and `release` scripts. Private workspaces have versioning and tags disabled. Editor and
  ghostty fixed groups warn while their workspace folders are absent, then activate after the move.
- npm packs `workspace:*` verbatim even after `changeset version`. The release script first
  builds public packages, then `scripts/release/prepare.mjs` resolves workspace references
  against package versions and catalog references against the root catalogs. It validates all
  public manifests before writing them in the disposable CI checkout; private manifests stay
  unchanged. Preparation sets each public manifest's repository to `ShaulLavo/fregat` and its
  package directory for npm provenance, and verifies the publishing repository before writing.
  Committed source and version PRs keep their workspace references.
- Dry run in a scratch copy: a patch changeset for `@fregat/react-hotkeys` versioned both
  hotkeys packages from `0.0.0` to `0.0.1`. After building and preparation,
  `npm pack --dry-run --json ./hotkeys/packages/react-hotkeys` listed 18 files, including
  `dist/index.js` and `dist/index.d.ts`, with 36,864 unpacked bytes. Reading an actual local
  tarball's `package/package.json` confirmed `@fregat/hotkeys: "0.0.1"` and no workspace or
  catalog references. A second scratch run with the 20 Editor manifests and ghostty's manifest
  exercised all three fixed groups: Editor aligned at `0.2.1`, the hotkeys pair at `0.0.1`,
  ghostty at `0.1.3`; all 23 public manifests prepared and the private app stayed unchanged.
  No package was published. Regression tests cover workspace shorthand,
  explicit ranges, both catalog forms, private consumers and invalid public-to-private dependencies.
- `.github/workflows/release.yml` uses Changesets action v2.1.2 to open/update a version PR
  and refresh the Bun lockfile in a version job with no OIDC permission. A separate publish job
  requires no pending changesets and the Fregat repository variable
  `NPM_TRUSTED_PUBLISHING` equal to `true`; version PRs work before that switch is enabled.
  After the switch, merging the version PR runs `bun run release`. Changesets runs under Node
  and invokes `npm publish`, using npm 11.19.0 and `id-token: write` on a GitHub-hosted runner.
  The workflow needs no `NPM_TOKEN`. npm's supported minimum is 11.5.1 with Node 22.14.0 or
  higher, per [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
- Changesets creates package tags and GitHub release notes in Fregat. Package changelogs copy
  into the family mirrors with the next main split. Creating mirror GitHub releases remains a
  separate follow-up; this workflow does not project Fregat tags or releases into mirror repos.
- Owner checklist for trusted publishing (no token, no 2FA prompt in CI):
  - [x] `@fregat` npm organisation created (2026-09-29).
  - [ ] Publish `@fregat/hotkeys` and `@fregat/react-hotkeys` once by hand (npm needs the package
        to exist before a trusted publisher can be set).
  - [ ] Publish any other public package that has never existed on npm once by hand too.
        Confirm every package exists before enabling the CI publishing switch.
  - [ ] For each of the 20 `@singapore-editor/*` packages, `ghostty-webgpu` and the two
        `@fregat/*` packages: npmjs.com → package → Settings → Trusted Publisher → GitHub Actions,
        repo `ShaulLavo/fregat`, workflow `release.yml`. In **Allowed actions**, enable direct
        `npm publish`; this workflow publishes packages directly.
  - [ ] Enable Actions → General → "Allow GitHub Actions to create and approve pull requests"
        in `ShaulLavo/fregat`. The workflow uses its built-in GitHub token for version PRs.
        GitHub does not automatically run PR CI for that token's commits; run CI manually for
        each version PR, or configure a GitHub App token in a later CI change.
  - [ ] After first publication and trusted publisher configuration for every public package,
        set Fregat's Actions repository variable `NPM_TRUSTED_PUBLISHING=true`. Leave it
        unset until all packages are ready. No npm secret is needed.

## Steps

- [x] Scratch rehearsal in `/work/tmp/plan207-*`: subtree-add both repos into a Fregat clone,
      update workspaces, run install, build, typecheck and the test suites; split `editor/` and
      compare commit ids with singapore's main.
- [x] Capture clean source heads and verify the delivered splits fast-forward the actual
      remote mains. No external commit or uncommitted sibling work was removed.
- [x] Subtree-add `editor/` and `ghostty-webgpu/` into the integration branch; update root workspaces. PR #199 imports Editor `17a020ad4b98830aeebdb106af95de8f06694973` and ghostty `fd5c74283f83f780fcf60aab970d4c1fa6cc06cd`; both initial subtree splits reproduce the source heads exactly.
- [x] Remove the `packages/editor-*` symlinks, the `link:ghostty-webgpu` override, and the
      `editor-ref`/`ghostty-ref` checkout steps and dist caches from
      `.github/actions/setup/action.yml`; Vite and TypeScript resolve the workspace packages
      directly.
- [x] Move the Editor's and ghostty-webgpu's repo-level CI (architecture health, textbuffer
      benches, tree-sitter-x, config-resolver, pages/site) into Fregat's `.github/workflows` with
      path filters; keep each family's standalone workflows inside its folder.
- [x] One set of tooling: a single formatter version, one vitest patch, one lockfile; delete the
      duplicates. Keep `bun run gates` and the Editor's health checks green.
- [x] Mirror workflow with local fast-forward/rejection proofs, missing-folder skips and
      explicit failures for missing deploy keys.
- [x] First authorized ordinary pushes to the three mirrors; update their READMEs.
- [x] Root Changesets, fixed groups and a scratch hotkeys npm pack dry run with resolved ranges.
- [x] Release workflow opening version PRs, with tokenless npm publishing behind the owner switch.
- [ ] Deferred npm phase: first real publication and trusted publishing. Mirror GitHub
      release projection is separate follow-up work.
- [x] Update repository rules and current scripts to the canonical source folders. Retain
      `/work/projects/Editor` and `/work/projects/ghostty-webgpu` as references without changing
      permissions, deleting data or editing global memory outside this checkout.
- [x] Deploy PR #199 with `bun run install-release --server --restart` and confirm the live check.

## Source-integration validation

PR #199 uses one root workspace install, including ghostty's demo and site. Editor-specific Turbo tasks run from the root; root typecheck builds library exports first. Imported-family Knip entries preserve Fregat's existing checks. Protocol-only ABI enums remain available for the native contract.

Editor keeps its standalone lint policy in `editor/.oxlintrc.json`; Fregat's compiler lint policy covers Fregat workspaces. The bundle gate's Editor owner is now `editor`, carrying its existing byte budget.

Family formatter options match Fregat; generated-file exclusions remain with each family for standalone installs. Fregat applies the sole Vitest patch at the root. Standalone family CI runs plain `bun install` and uses upstream Vitest.

Editor and ghostty sites join Fregat's existing Pages artifact at `editor/` and `ghostty-webgpu/`, sharing one deployment. Native config-resolver workflows remain manual dispatches. The integration regenerates ghostty's bootstrap input closure after removing its family lockfile and uses repository-relative Git object paths for a nested checkout.

Local gates, typecheck, web build and Editor health pass. The updated quick-open scenario completed and its screenshots were read at `/work/tmp/fregat-evidence/20260929T201255Z-scenario-quick-open-editor-source/`. All workspace suites completed; targeted reruns pass for the migrated browser boundaries and the local OpenSSH username environment. Root lint, the first-load byte gate, both family site builds, ghostty package smoke and the tree-sitter browser worker pass. PR #199 CI and its deployment passed. PR #201 completed the remaining source-migration work; the delivery evidence follows.

## Acceptance

- One checkout builds, tests and deploys Fregat, the Editor and ghostty-webgpu; no symlinks to
  sibling repos and no `*-ref` pins remain.
- `singapore` and `ghostty-webgpu` update automatically from Fregat main and pass their
  standalone CI from the copied folder.
- Exact family folders install, build and verify independently of Fregat. Published-package
  installation belongs to the deferred npm phase.
- `bun run gates`, the Editor health checks and the deploy live check pass.

## Migration completion (2026-09-30)

PR [#201](https://github.com/ShaulLavo/fregat/pull/201) merged as `f1b47731d` with all 22 PR
checks passing. Shared tool pins are checked across 45 manifests. TypeScript 7 CLI and the
TypeScript 6 JavaScript API have explicit ownership. Root lint, formatting, cache inputs,
23 workspace builds and isolated mirror installations include the imported families and hotkeys.
Reusable library CI is part of the main verdict; each mirror also runs its standalone CI.

Separate writable SSH deploy keys authenticate the three mirrors. The delivered splits are
Editor `d306b1194448a1ebd02953a4a9c95535995ee748`, ghostty
`b512f097c7fc675ce738780881c5f84850495af2` and hotkeys
`3feaf86ec1597510c9a9085ca95c501f1fe79f69`; all trees match Fregat exactly.
The mirror workflow invokes Git's subtree script through Bash to avoid Ubuntu Dash's
recursion cap on imported history. No force push was used.

Release `20260930T072758Z-f1b47731-main` passed the live check. Editor, language-service and
terminal browser evidence was inspected in `/work/tmp/monorepo-completion/browser/`.
The [completion checklist](207-migration-completion.md) records the remaining automatic
mirror correction check. npm remains disabled and deferred; plans 204–206 remain subsequent
feature work, including cross-family consumers that need the first hotkeys publication.
