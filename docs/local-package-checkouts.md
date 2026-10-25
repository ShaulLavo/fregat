# Use local package checkouts

Develop Fregat alongside Singapore, ghostty-webgpu, or hotkeys in separate Git checkouts. Use the prerequisites in [Development](development.md#requirements). Keep local dependency edits in a dedicated Fregat worktree and leave release pins unchanged on your shared branch.

## Build the producers

1. Clone the repositories you need outside Fregat. Set shell variables to their absolute checkout paths. The names and locations are yours to choose:

   ```sh
   FREGAT="$(pwd)"
   SINGAPORE="$(cd ../singapore && pwd)"
   GHOSTTY="$(cd ../ghostty-webgpu && pwd)"
   HOTKEYS="$(cd ../hotkeys && pwd)"
   ```

2. In each selected producer, run `bun install --frozen-lockfile` and `bun run build`. Build hotkeys first when changing it alongside another producer. Each repository owns its build prerequisites, generated assets, and checks.

3. For Ghostty native changes, run its documented WASM or native artifact build as well. Source development needs `ghostty-vt.wasm`, `bridge.wasm`, and the producer's installed `@webgpu/types` declarations.

## Select local dependencies

1. Save the consumer manifests and lockfiles before editing them. Temporary dependency edits use `link:` followed by the absolute **package directory**. Bun installs a symlink to that directory. A `file:` directory dependency installs a snapshot in Bun's dependency store, so it is useful for built-package checks but does not select source watching.

   | Package                            | Directory                                                                    |
   | ---------------------------------- | ---------------------------------------------------------------------------- |
   | `@fregat/hotkeys`                  | `$HOTKEYS/packages/hotkeys`                                                  |
   | `@fregat/react-hotkeys`, when used | `$HOTKEYS/packages/react-hotkeys`                                            |
   | `@singapore-editor/*`              | The directory under `$SINGAPORE/packages` whose `package.json` has that name |
   | `ghostty-webgpu`                   | `$GHOSTTY`                                                                   |

   Singapore directory names can differ from package names. For example, `@singapore-editor/core` lives in `packages/editor`. Read the selected manifest before linking.

2. Change every selected direct dependency in Fregat to its local `link:` path. Inspect `apps/web`, `apps/tui`, `apps/server`, `packages/client-core`, `packages/contracts`, and `packages/markdown`. Keep `catalog:` callers when changing their root catalog entry. For example, the temporary root catalog value for hotkeys is `"@fregat/hotkeys": "link:/absolute/path/to/hotkeys/packages/hotkeys"`. Leave unrelated workspace dependencies in place.

3. Link all consumed Singapore packages to the same checkout when working on Singapore. Their internal `workspace:` dependencies need the producer's independent install. Leave Fregat's current family workspace globs in place while the folders remain here. Explicit `link:` dependencies select the external checkout even when an in-tree package has the same name.

4. When changing hotkeys, also point Singapore's hotkeys catalog and Ghostty's hotkeys dependency at that same local core directory. Reinstall and rebuild those producers. A root override alone does not establish a shared hotkeys copy across explicit tarball dependencies.

5. Run `bun install` in Fregat after editing the local pins. Run `bun run build:workspaces` to prepare the remaining in-tree consumers. This command builds Fregat's workspaces. Build external checkouts separately after edits because Turbo does not schedule their builds.

## Check the selected packages

From the Fregat worktree, inspect the real package paths and assert that the editor and terminal resolve the app's hotkeys core:

```sh
bun -e '
import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
const web = createRequire(resolve("apps/web/package.json"))
const core = realpathSync(web.resolve("@fregat/hotkeys"))
console.log("@fregat/hotkeys", core)
for (const name of ["@singapore-editor/core", "ghostty-webgpu"]) {
  const entry = realpathSync(web.resolve(name))
  const producer = createRequire(entry)
  console.log(name, entry)
  assert.equal(realpathSync(producer.resolve("@fregat/hotkeys")), core, name)
}
'
```

Run `bun run --cwd apps/web typecheck`, then `bun run dev:web`. Exercise the editor, app shortcuts, and terminal keyboard input. Check the other app consumers affected by your change. If you consume `@singapore-editor/panes`, check its hotkeys resolution from its own package directory too. Matching declaration types alone cannot prove that shortcut registries share one runtime instance.

The source mapper follows installed dependency links. A package inside a Git checkout, before any `node_modules` ancestor, selects source aliases, watched checkout roots, and development type paths. Both ordinary clones and Git worktrees qualify. Current in-tree workspace links keep this behavior. Installed release packages use their exported JavaScript and declarations, even when an archive includes source. They need no producer source tree or development dependencies.

Vite serves linked source during development. Builds and server consumers still use the producer's built exports. Rebuild the producer after changes that affect those consumers or generated assets. Restart development after relinking a package or changing its export map. Vite handles loaded source updates through its normal module graph.

## Return to release dependencies

Stop the development processes. Restore only your temporary manifest and lockfile edits, then run `bun install --frozen-lockfile --force` in each affected checkout to replace local links. Inspect resolved paths again and run the relevant consumer checks. Confirm that `git diff` contains no local paths or dependency-pin changes before committing your product change. Remove the dedicated worktree after preserving your work.
