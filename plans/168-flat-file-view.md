# Plan 168: Offer a flat file view under a chosen root

## Status and authorization

- Status: PARKED — not in the 2026-09-25 completion wave. Quick open (Ctrl+P) covers most of the need.
- Priority: P2. Effort: M.
- Origin: Editor backlog E030, moved here 2026-09-25 because all of its work is in Platform.
- Inspected baseline: Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`, Platform `c8e05123d8f89f74bdca0e73cd43bb060c6f4e67`.
  Re-check every path below before starting.

## Outcome

Let a user anchor the file explorer at a directory and switch to a flat, fuzzy-filterable list
of files beneath it. Show relative paths so files with the same name remain distinguishable.
Opening a result uses the same tab, dirty-file, and file-access behavior as the existing tree.

For example, anchor at `apps/web/src`, type `cmdp`, and open the matching command-palette file
without expanding its ancestors. Switching back to the tree restores its prior expansion
and selection. An empty filter can browse the anchored file set, with explicit partial results
when enumeration has not finished or the displayed result budget is reached.

## Current code

Editor has a demo explorer in [tree.ts](../../Editor/examples/app/src/tree.ts) and
[sidebar.ts](../../Editor/examples/app/src/components/sidebar.ts). It builds a tree from a known source
file list and remembers expansion. There is no standalone Editor explorer package to extend.

Platform's [TreePane](../apps/web/src/features/workspace/components/tree-pane.tsx)
uses `@workspace/tree`, with search and `flattenEmptyDirectories` enabled. Collapsing empty
directory chains is different from presenting all descendant files as a flat list.
[TreeModel](../apps/web/src/lib/tree-model.ts) tracks loaded and loading directories,
so the current client paths must not be assumed to include every file under the anchor.

[Quick-open file search](../apps/web/src/features/command-palette/hooks/use-files.ts)
already calls [fetchQuickOpenFiles](../apps/web/src/lib/file-server.ts), which uses
the server's fuzzy filename search. [WorkspaceIndex](../apps/server/src/fs/workspace-index.ts)
already owns indexed entries and watch updates. Reuse those policies before adding a scanner.

## Scope

Implement the anchored flat mode in Platform's workspace feature, including keyboard access,
query cancellation, file opening, event updates, and pending, empty, error, and partial states.
Keep filesystem enumeration, ignored-path rules, symlink behavior, and workspace confinement
on the existing Platform server path.

An Editor demo mode may project its existing file list to demonstrate the interaction.
That demo does not complete Platform integration. Do not create an Editor filesystem package
or extract a reusable widget unless two real consumers need the same behavior.

## Design

Model the explorer view as tree or flat. Flat mode owns an anchor path, query, request
generation, and selected file identity. Preserve tree expansion independently so a display
toggle does not rewrite workspace state or change the open document.

Identify files by canonical workspace path plus environment and workspace identity, not their
basename or row index. Display paths relative to the anchor while preserving the absolute
selection target used by existing open commands. Anchor containment must use path segments.

Reuse fuzzy filename matching and the workspace index for complete results. First establish
how the current search route handles an empty query, limits, index readiness, and cancellation.
If full enumeration needs a new query shape, add a bounded paged or streamed projection over
the existing index. Never expand every directory just to populate a flat client list.

The flat row shows the filename, relative directory, current selection, and existing git
status. Use shared UI primitives, theme tokens, and list virtualization where the result count
requires it. Keep moving counts in `tabular-nums` and use existing loading primitives.

Reuse workspace open actions for pointer and keyboard invocation. Define focus restoration
for Escape and tree-mode return. Initially support opening and revealing a file in its parent
tree. Defer drag operations unless their destination is explicit in a flat list.

Store transient query and selection with the feature owner. If mode or anchor is persisted as
a user preference, register and consume it in the settings registry in the same pass. Existing
quick-open limits are not automatically the right contract for browsing the entire anchor.

## Steps

1. Audit tree loading and quick-open search semantics against a real temporary workspace.
   Establish ignored paths, empty queries, index readiness, result limits, and root changes.
2. Design the mode toggle, anchor breadcrumb, relative-path rows, and partial-result message.
   Show duplicate basenames and keyboard focus behavior before selecting the final layout.
3. Implement the file-list query using the existing index and server path policy. Add an
   explicit completion or truncation signal if the current response cannot express it.
4. Add feature-owned mode state and rows. Connect existing open and reveal actions, stable
   selection, query cancellation, and root-generation rejection of stale responses.
5. Apply watcher changes and renames to the anchored list. Preserve selected file identity when
   possible and choose a predictable adjacent row if the selected file is removed.
6. Verify tree-mode restoration and complete file coverage. Add the optional Editor demo only
   if it helps document the interaction without inventing another filesystem implementation.

## Verification

Follow Platform's real-server test fixtures and current package scripts. From Platform's
`apps/web`, run `bun run test src/features/workspace/tests/tree-pane.test.ts` when shared tree
behavior changes. Add focused app tests through `test/fixtures.ts` for flat mode behavior.

Reuse the server's [fuzzy search tests](../apps/server/src/fs/tests/search.test.ts)
and [workspace index tests](../apps/server/src/fs/tests/workspace-index.test.ts).
Extend only the cases affected by the query contract. Real files must cover unexpanded
directories, ignored entries, duplicate names, anchor segment boundaries, and rename events.

Run browser verification for keyboard selection, virtualized scrolling, focus restoration,
mode changes, and opening a result. Use Platform's `test:browser` script for an added focused
browser file. Reuse the running dev server for interactive inspection.

Measure query response and mounted row count on a generated large file tree before and after.
Acceptance requires that every permitted descendant is discoverable, partial results are
visible, stale root queries cannot open a file, and switching modes preserves tree state.
If settings change, regenerate Platform's reference with `bun run settings:reference`.

## Risks and decisions

The current loaded tree is an incomplete file inventory. Deriving the flat list from it alone
would silently omit unopened directories. A fuzzy result limit must also not masquerade as
complete enumeration when the filter is empty.
Keep anchor selection separate from the workspace root. Changing a display root must not
expand filesystem authority or change the process working directory of other features.
