# Releasing packages

Use this guide to include release notes in a package PR and review the generated version PR.
Fregat uses Changesets to collect notes, update package versions, and generate changelogs.

## Add a changeset to your PR

1. From the repository root, run `bun run changeset`.
2. Select the public packages whose behavior or APIs changed.
3. Select a patch bump for each package. Until launch, all changes use patch bumps, including breaking API changes.
4. Write a summary for someone upgrading the package. Follow the [changeset writing rules](../AGENTS.md#changesets).
5. Commit the generated `.changeset/*.md` file with your change.

Describe what the caller can do or what was wrong before the fix. Name the public API or option.
For a breaking change, start with `Breaking:` and explain how to update calling code.
Keep test results and implementation details in the PR description.
Docs, tests, benchmarks, CI, and internal refactors alone need no changeset.

Keep package versions and existing `CHANGELOG.md` entries unchanged in feature PRs.
Changesets applies the pending bumps in a separate version PR.

## Package groups

[`.changeset/config.json`](../.changeset/config.json) defines the release groups and is the source of truth for membership:

- The listed `@singapore-editor/*` packages share a fixed version group.
- `@fregat/hotkeys` and `@fregat/react-hotkeys` share a second fixed group.
- `ghostty-webgpu` has its own fixed group.

A changeset for one member bumps the entire fixed group to the same version.
Select the packages that changed. Changesets handles the other members and dependency updates.
A public package outside these lists, such as `@singapore-editor/collab`, versions independently.
Private workspaces are excluded from versioning and tags.

## Review the version PR

Every push to `main` runs [Package releases](../.github/workflows/release.yml).
The version job opens or updates **Version public packages** through `changesets/action`.
Its `bun run version-packages` command runs `changeset version`, then `bun install --lockfile-only`.
The PR updates manifests, adds changelog sections, refreshes `bun.lock`, and consumes the pending changesets.

Review the summaries, package bumps, dependency updates, and lockfile together.
Until launch, request patch bumps only. This setup introduces no new numbering policy or 1.0 release.

The changelog generator is `@changesets/changelog-github`, configured for `ShaulLavo/fregat`.
The version step passes `GITHUB_TOKEN` so the generator can look up the originating PR and link it in the entry.
A direct commit can have a commit link without a PR link. Contributor thank-you lines are disabled.
Existing changelog history stays as written.

## Publishing status

Automated npm publishing is not active yet. A version in git can be newer than the version available on npm.
[Plan 336 Track N](../plans/336-packages-as-products.md#track-n-npm-publishing-last-with-track-e) owns publication setup.

The publish job requires the repository variable `NPM_TRUSTED_PUBLISHING` to equal `true` and the version job to report no pending changesets.
Once configured, that job uses npm trusted publishing with GitHub OIDC.
`bun run release` builds the public packages, prepares their manifests for npm, and runs Changesets publishing under Node.
Manifest preparation resolves workspace and catalog dependency references and sets repository metadata for the publishing repository.
Run that command only in the disposable publishing checkout. Keep workspace references in committed manifests.

Preview packages, prerelease channels, and product-family GitHub Releases are outside the current cycle.
They wait for Track N.

## Mirrored repositories

Fregat is the source repository for development and release preparation.
The [mirror workflow](../.github/workflows/mirror.yml) splits these folders on pushes to `main`:

- `editor/` goes to [singapore](https://github.com/ShaulLavo/singapore).
- `ghostty-webgpu/` goes to [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu).
- `hotkeys/` goes to [hotkeys](https://github.com/ShaulLavo/hotkeys).

Submit changes and release notes to Fregat. Mirrors receive the folder contents, including package manifests and changelogs.
The current mirror workflow pushes `main` only. It does not copy tags or create GitHub Releases.
The root Changesets configuration and publishing workflow live in Fregat.

## Check version generation locally

Run version generation in a disposable copy. The command writes versions and changelogs and deletes consumed changesets.
Do not commit those outputs in a feature PR.

For an offline check, run the fixture tests from the repository root:

```sh
bun --bun vitest run --config vitest.scripts.config.mjs scripts/release/version.test.mjs scripts/release/changelog.test.mjs scripts/release/workflow.test.mjs
```

The version tests run the real `changeset version` command in temporary workspaces, including a copy of every current pending changeset and workspace manifest.
Their uncommitted changesets have no git commit metadata, so the GitHub generator produces summaries without a token or PR lookup.
The changelog tests supply fixture GitHub responses to check PR links and direct-commit links without network access.
The workflow tests check that the version step passes the token and keeps publishing behind its existing gate.

For a check of historical PR lookup, use a disposable worktree with full git history and an authorized `GITHUB_TOKEN`, then run `bun run version-packages`.
Without a token, committed changesets that need GitHub lookup cause the generator to fail.
Version preparation normally runs in CI, where the workflow supplies the token.
