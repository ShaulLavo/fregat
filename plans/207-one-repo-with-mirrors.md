# Plan 207: One repo, with mirrors for the flagship packages

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner.
- Owner decision: all code we write for Fregat lives in the Fregat monorepo. Flagship packages
  that others should use standalone (the Editor, ghostty-webgpu, and `@fregat/hotkeys` from
  [203](203-fregat-hotkeys.md)) each keep a public repo that CI fills with an exact copy of their
  folder on every push to Fregat's main, and publish to npm from Fregat. Laravel and Symfony use
  this pattern (read-only split repos per component).
- Out of scope: tree-sitter-md, tree-sitter-x, mesh and the file tree are not mirrored or moved
  by this plan. The owner's revised [202](202-tui-ui.md) keeps terminal UI in `apps/tui/src/ui/`
  on upstream OpenTUI; it creates no toolkit package or mirror. The former bubli fork is not a
  pending relocation or release workstream.
- Needs the owner: freezing the Editor and ghostty-webgpu checkouts for the cutover (other
  sessions work in them), npm trusted-publishing setup
  for the three families, and approval before any force-push to `singapore` or `ghostty-webgpu`.

## Cutover window and release conditions

The rehearsal is complete; the live import has not happened. This plan requires a scoped
write hold, not a repository-wide freeze. Land or park open Editor/ghostty PRs, obtain the
owner's session freeze, record final source heads and dirty-state ownership, and refresh
the split/fast-forward proof against those heads. Keep sibling writes paused from that
final-head capture through the first verified mirror push. Release the hold with Fregat
as canonical source. Documentation, read-only baselines and independent Platform work
can continue during the hold. Do not discard another session's changes or delete old checkouts.

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
  history is part of Fregat. Verify on a scratch clone that the split of `editor/` reproduces
  singapore's existing commit ids so the first mirror push fast-forwards. If it cannot, stop and
  ask the owner before force-pushing a mirror.
- Mirror repos keep their URLs, stars, issues and releases.

- Built in `.github/workflows/mirror.yml`: one matrix entry per family, full-depth checkout,
  `git subtree split --prefix=<folder> HEAD`, then a regular push to the mirror's `main`.
  Missing folders skip individually; an absent `MIRROR_TOKEN` skips every entry. The job uses
  no split cache, serializes main runs, and fails with an error annotation on any rejected push.
- Owner setup:
  - [ ] Create the empty public `ShaulLavo/hotkeys` repository. Keep its initial history empty
        so the first hotkeys split can create `main` with a regular push.
  - [ ] Add Fregat's Actions secret `MIRROR_TOKEN`, a fine-grained GitHub token restricted to
        `ShaulLavo/singapore`, `ShaulLavo/ghostty-webgpu` and `ShaulLavo/hotkeys`, with
        **Contents: Read and write**. Also grant **Workflows: Read and write** for copying the
        families' `.github/workflows` files. This token authenticates only mirror pushes.
  - [ ] Freeze direct writes to the mirror mains at the final source-head capture and inspect
        the first successful split pushes before releasing the cutover hold.
- Local verification used the workflow's exact shell against three temporary bare repos:
  first pushes, repeated unchanged splits and later fast-forwards passed. A divergent mirror
  rejected the push, returned exit 1 and retained its outside commit. Missing-folder and
  absent-token paths passed. No remote mirror was pushed during verification.

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

- Changesets at Fregat's root. Fixed version groups: all `@singapore-editor/*` packages release
  together (they are on independent `0.1.x`/`0.2.0` versions today; the first grouped release
  aligns them), `@fregat/hotkeys` with `@fregat/react-hotkeys`, and `ghostty-webgpu` alone.
- Built at the root: `@changesets/cli` 3.0.3, `.changeset/config.json` and the `changeset`
  and `release` scripts. Private workspaces have versioning and tags disabled. Editor and
  ghostty fixed groups warn while their workspace folders are absent, then activate after the move.
- npm packs `workspace:*` verbatim even after `changeset version`. The release script first
  builds public packages, then `scripts/release/prepare.mjs` resolves workspace references
  against package versions and catalog references against the root catalogs. It validates all
  public manifests before writing them in the disposable CI checkout; private manifests stay
  unchanged. Committed source and version PRs keep their workspace references.
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
  and refresh the Bun lockfile. Publishing stays disabled until the Fregat repository variable
  `NPM_TRUSTED_PUBLISHING` equals `true`; version PRs work before that switch is enabled.
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
        repo `ShaulLavo/fregat`, workflow `release.yml`.
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
- [ ] Owner freeze: land or park open work in the Editor and ghostty-webgpu (including open PRs
      such as singapore #62), then stop sessions from writing to those checkouts.
- [ ] Subtree-add `editor/` and `ghostty-webgpu/` into Fregat main; update root workspaces.
- [ ] Remove the `packages/editor-*` symlinks, the `link:ghostty-webgpu` override, and the
      `editor-ref`/`ghostty-ref` checkout steps and dist caches from
      `.github/actions/setup/action.yml`; Vite and TypeScript resolve the workspace packages
      directly.
- [ ] Move the Editor's and ghostty-webgpu's repo-level CI (architecture health, textbuffer
      benches, tree-sitter-x, config-resolver, pages/site) into Fregat's `.github/workflows` with
      path filters; keep each family's standalone workflows inside its folder.
- [ ] One set of tooling: a single formatter version, one vitest patch, one lockfile; delete the
      duplicates. Keep `bun run gates` and the Editor's health checks green.
- [x] Mirror workflow with local fast-forward/rejection proofs and missing-folder/token skips.
- [ ] First authorized pushes to the three mirrors; update their READMEs.
- [x] Root Changesets, fixed groups and a scratch hotkeys npm pack dry run with resolved ranges.
- [x] Release workflow opening version PRs, with tokenless npm publishing behind the owner switch.
- [ ] First real publish after the owner sets up npm; mirror GitHub release projection.
- [ ] Retire the old checkouts: `/work/projects/Editor` and `/work/projects/ghostty-webgpu`
      become read-only references (the owner decides when to delete them); update AGENTS.md
      (Editor symlink, `ghostty-webgpu` link, `editor-ref` rules), memory notes and scripts that
      assume `../Editor`.
- [ ] Deploy with `bun run deploy --server --restart` and confirm the live check.

## Acceptance

- One checkout builds, tests and deploys Fregat, the Editor and ghostty-webgpu; no symlinks to
  sibling repos and no `*-ref` pins remain.
- `singapore` and `ghostty-webgpu` update automatically from Fregat main and pass their
  standalone CI from the copied folder.
- A published `@singapore-editor/core` installs and runs in an empty project without Fregat.
- `bun run gates`, the Editor health checks and the deploy live check pass.
