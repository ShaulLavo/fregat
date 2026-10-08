# Public package releases

Run `bun run changeset` for a public package change and commit the resulting Markdown file.
The Editor packages listed in `.changeset/config.json` share one version; the two hotkeys packages share another.
`ghostty-webgpu` releases independently. Private workspaces are excluded from versioning and tags.
Use patch bumps until launch, including breaking API changes.
Write summaries for package users. Follow the [changeset writing rules](../AGENTS.md#changesets)
and [Releasing packages](../docs/releasing.md) for the current cycle and local checks.

On main, `release.yml` opens or updates the version PR, including the Bun lockfile.
After the owner configures every npm trusted publisher and sets the Fregat repository variable
`NPM_TRUSTED_PUBLISHING=true`, merging the version PR also publishes the new versions.
See [Plan 207](../plans/207-one-repo-with-mirrors.md#publishing) for setup and first-publication steps.

`bun run release` builds the public packages, prepares their manifests, and runs Changesets
under Node. Changesets uses `npm publish` with npm OIDC authentication. Manifest preparation
resolves `workspace:*`, `workspace:^`, `workspace:~` and catalog references for npm consumers.
Run this command only in a disposable CI checkout: preparation changes public manifests.
Keep `workspace:` references in committed source and in the version PR.
Changesets tracks dependency updates through `workspace:` references with
`bumpVersionsWithWorkspaceProtocolOnly`. Bun catalog references keep their configured pins;
the Editor and ghostty mirrors use their own catalogs to install hotkeys independently.
