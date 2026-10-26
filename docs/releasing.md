# Adopt package releases

Fregat consumes Singapore, Ghostty, and hotkeys from immutable GitHub Release tarballs.
Each standalone repository owns its source, package versions, release notes, sites, and package qualification.

## Publish a package change

1. Open the change in the owning repository:
   [Singapore](https://github.com/ShaulLavo/singapore),
   [Ghostty](https://github.com/ShaulLavo/ghostty-webgpu), or
   [hotkeys](https://github.com/ShaulLavo/hotkeys).
2. Follow that repository's contribution and release instructions.
3. Merge the reviewed change after its checks pass.
4. Cut a patch release using the repository's release workflow.
5. Inspect the package identities, manifest, checksums, and packed-consumer qualification before publishing the draft.

Keep versions unchanged in feature PRs. Cut a new release to fix a published artifact.
Preserve existing assets so pinned consumers can reproduce earlier builds.

## Update Fregat's pins

1. Update the root `package.json` catalog URLs to the inspected release assets.
2. Update matching root overrides for transitive packages that have no direct catalog entry.
3. Run `bun install` to refresh `bun.lock`.
4. Run `bun install --frozen-lockfile` and `bun run standalone:consumer:check -- --producer-free`.
5. Run the affected consumer typechecks and tests, then `bun run build-release`.
6. Exercise editor syntax, shortcuts, terminal input, and browser WASM loading against the installed packages.
7. Merge the reviewed consumer PR after CI passes.

The graph check rejects producer-source fallback and multiple physical hotkeys runtimes.
The portable release build checks browser bundling and asset loading paths.
Use [local checkout development](local-package-checkouts.md) for deliberate source edits across repositories.

## Build a Fregat release

Run `bun run build-release` to produce the portable application release.
Fregat workspaces are private. Their builds and application delivery stay in this repository.
The PTY package remains a local workspace.
