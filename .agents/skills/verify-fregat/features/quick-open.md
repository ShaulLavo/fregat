# Quick open

File name search in the command palette.

## Sub-features

Fuzzy name search over the server's workspace index, tree entries for an empty query, open on Enter.

## How to get to it (user POV)

Cmd/Ctrl+P, or the command palette with no `>` prefix.

## Driving it with agent:browser

`quick-open-new-file` searches a missing name, creates that file on disk, and searches again one and eight seconds later. The step labels carry the found count; both later steps must read `found-1`.

`quick-open-linked-file` searches `tokenStore.ts`, which sits behind the `packages/editor-core` symlink by file name. The step must read `found-2` or more. The dev server only shows server changes after the user restarts it; pass `--url` for the mesh build.

## Gotchas

The index never scans a symlinked directory and the watcher cannot see into one, so links that leave the workspace are walked with `fd` on every query and ranked together with the index entries. Results are never cached on the client. The server answers from an in-memory index in about 10ms, and a remembered miss hides a file created since. The list empties between keystrokes on purpose: Enter on the previous query's rows would open the wrong file.
