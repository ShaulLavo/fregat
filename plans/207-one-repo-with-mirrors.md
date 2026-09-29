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
- `workspace:*` dependencies become real version ranges at publish, so a published
  `@singapore-editor/core` depends on a published `@fregat/hotkeys`.
- Publishing runs from Fregat CI with npm trusted publishing; release notes land on the mirrors'
  GitHub releases.
- Owner checklist for trusted publishing (no token, no 2FA prompt in CI):
  - [x] `@fregat` npm organisation created (2026-09-29).
  - [ ] Publish `@fregat/hotkeys` and `@fregat/react-hotkeys` once by hand (npm needs the package
        to exist before a trusted publisher can be set).
  - [ ] For each of the 20 `@singapore-editor/*` packages, `ghostty-webgpu` and the two
        `@fregat/*` packages: npmjs.com → package → Settings → Trusted Publisher → GitHub Actions,
        repo `ShaulLavo/fregat`, workflow `release.yml`.
  - The workflow job needs `permissions: id-token: write` and npm CLI ≥ 11.5; changesets calls
    `npm publish`. Do not rely on `bun publish` for this.

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
- [ ] Mirror workflow; first push to `singapore` and `ghostty-webgpu`; update both READMEs.
- [ ] Changesets with the fixed groups; a dry-run publish, then the first real publish after the
      owner sets up npm.
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
