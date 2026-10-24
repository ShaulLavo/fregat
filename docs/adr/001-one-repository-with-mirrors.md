# 001. Keep all code in one repository and mirror three folders

Status: accepted
Date: 2026-09-30 (the owner's decision when the source migration landed)

## Context

The app, the Singapore editor, the ghostty-webgpu terminal and the hotkeys library change together. A shortcut change touches `packages/hotkeys/`, the editor and the app in one pass. The editor, the terminal and the keymap library also have users outside Fregat, and those users expect a repository of their own to find, star and file issues against.

Before the migration each library lived in its own repository and was linked into the app through sibling checkouts. A change that crossed two repositories needed two pull requests and a way to tell the app which checkout to use.

## Decision

Everything Fregat needs lives in this repository. `packages/singapore/`, `packages/ghostty-webgpu/` and `packages/hotkeys/` are copied on every push to `main` to read-only repositories (`ShaulLavo/singapore`, `ShaulLavo/ghostty-webgpu`, `ShaulLavo/hotkeys`). The workflow `.github/workflows/mirror.yml` runs `git subtree split` on the folder and pushes the result to the mirror's `main` without force. Changes go here, never to a mirror.

## Alternatives considered

- **Separate repositories joined by sibling checkouts.** Each library keeps its own history and pull requests. It lost because every cross-library change became two pull requests that had to land in the right order.
- **One repository with no standalone copies.** It is the simplest option. It lost because the three libraries are meant to be used on their own, and a folder inside an app repository is a poor front door for them.
- **Published packages only.** Consumers would install released versions. It lost for now because npm publishing is not set up: `@singapore-editor/core` and `ghostty-webgpu` on npm are version 0.1.2 and `@fregat/hotkeys` is not published.

## Consequences

- One pull request can change the app and a library together, and CI builds the libraries from this checkout.
- A mirror workflow run skips itself when a newer `main` exists, and fails when the mirror rejects the push, so a hand edit in a mirror blocks later updates until someone reconciles it.
- Each mirrored folder installs on its own. Its `package.json` sets the `@fregat/hotkeys` catalog entry to a pinned release tarball on this repository's GitHub releases, while the root catalog uses the workspace copy. Update the tarball when `packages/hotkeys/` changes in a way the mirrors need.
- `tree-sitter-md`, `tree-sitter-x`, Mesh and the file tree package are not mirrored. The file tree lives in `packages/tree` as a product-owned fork.
