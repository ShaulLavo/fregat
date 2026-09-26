# Shared UI patterns

`packages/ui/src/patterns` owns rows, list interaction, virtualization and pane shells. Patterns
compose theme tokens and UI primitives. They have no application or feature imports.

## Components and hooks

| API                | Responsibility                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListRow`          | Density height, spacing, hover, press, selection and marked-state paint. The caller supplies the semantic role and full-value title.                          |
| `listRowClassName` | The same paint for primitives such as cmdk items that must own their element.                                                                                 |
| `useListbox`       | Controlled cursor, one focus container, active descendant, arrows, boundaries, paging, tree traversal and optional typeahead. Enter commits; Space selects.   |
| `VirtualList`      | TanStack windowing, density measurement, stable keys, active-row pinning and scroll anchoring. Measured flow layouts support expanded logs and chat messages. |
| `useRowHeight`     | Measures the effective density token, including rem scaling and live density changes.                                                                         |
| `ToolPane`         | Header, optional subheader and content states in pending, error, empty, content order.                                                                        |
| `ToolPaneHeader`   | Shared bar tokens, title, leading icon and actions.                                                                                                           |

Use `rowProps` for ordinary rows. Deeply nested lists can distribute stable `rowBindings` through
context and pass each row's selected boolean separately. This keeps cursor updates from rerendering
every row. Forward consumed keyboard events carefully: portalled breadcrumb trees must not trigger
the parent breadcrumb bar's arrow handler.

Rows use `aria-selected`; marked rows use an inset ring. Rows do not own a focus ring or a Tab stop.
The list owns both. Terminal and session drags temporarily focus the active draggable row, mark it
with `data-dragging`, and restore container focus when a keyboard drag ends or is cancelled.
Search replacement actions use F2 to enter the active row's action and Escape to return to its tree.

## App-level shared pieces

These live in `apps/web/src` because they know about files, sessions or the clipboard, which the
pattern layer must not.

| API                                  | Responsibility                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/clipboard.ts`                   | The one copy boundary: `writeText`, then `write` with a `ClipboardItem`, then `execCommand('copy')`. `copyTextToClipboard` toasts; failures log once. |
| `components/copy-button.tsx`         | Inline copy: the icon turns into a check for a moment instead of a toast.                                                                             |
| `components/file-label.tsx`          | Icon, basename, muted directory, so a right cut eats the directory. `FileStatusCell` draws the change letter beside it.                               |
| `PaneHostProvider` / `usePaneHost`   | The container a rail or pane header sits in, with views bound to select/toggle and one Hide. See `docs/workspace-rails.md`.                           |
| `keymap/menus/utils/open-file-item`  | "Open File", the same item in Files, Git and Search menus, beside `copyPathSection`.                                                                  |
| `MenuSurface` `takesFocus` item flag | The item puts focus somewhere itself (a rename field, the editor); it runs a frame after the menu closes and focus is not restored over it.           |
| `MenuSurface` `returnFocusTo`        | The list that opened the menu. Closing without handing focus elsewhere returns there, not to the pane's own focus target.                             |

## Ownership and enforcement

Features are leaves. `platform-boundaries/feature-imports` checks exact importer/module pairs in
`scripts/lint/web-feature-allow.json`, rejects new edges and rejects stale or unexplained entries.
The initial freeze contained 246 entries across 62 directed feature edges. The first migration
removed eight entries and three edges. Run `bun run --cwd apps/web lint` to check the live graph.

Feature query and mutation keys live in `utils/query-keys.ts` and `utils/mutation-keys.ts`.
Shared groups remain in `lib` only when multiple outside consumers use them. Streaming workspace
search has no artificial query-key module. File picker and command palette files follow the same
components, hooks, providers, state, utils and tests layout as the other features.

The design census enforces the two icon sizes, two text levels, row hover paint and Tooltip hints
for icon-only controls. It recognizes nested icon spans and Base UI render-prop composition.
Run `bun run design:census`; exceptions require a reason in `scripts/lint/web-design-allow.json`.

## Deliberate boundaries

- The file tree keeps its shadow-root keyboard controller and single roving row. Its hover and
  row height now use the shared tokens.
- Search's editor preview keeps its editor-specific virtualizer and interactive editor actions.
  Its compact sidebar results use `VirtualList` and `useListbox`.
- Terminal initialization needs its host mounted. Its pane keeps the loading and error overlay
  over that host rather than replacing the host with a pending branch.
- The app titlebar keeps a semantic `header` and native window controls. It uses the shared bar
  dimensions. Domain-specific pane actions compose the shared header through the app adapter.
- Path helpers retain distinct empty-path and workspace-root behavior. Their shared operations
  have focused tests; similarly named behavior was not silently merged.

## Verification

The [pattern feature map](../.agents/skills/verify-fregat/features/patterns.md) names browser drives
for every migrated surface. `workbench-list-focus` enters and exits files, git changes, logs,
terminal tabs and sessions with one Tab stop each. Other drives cover picker positions, search
replacement focus, breadcrumb nesting, references, machine discovery, chat checkpoints and timeline
scrolling. The shared package tests selection paint, density changes, active-descendant mounting,
keyboard behavior and virtualization.

Implementation evidence is indexed at `/work/tmp/fregat-evidence/plan126-pattern-layer/summary.md`.
It records the exact checks, screenshots, render comparisons, trace comparison and mesh release.
The repository's completed-plan cleanup policy replaces the executable plan with this reference.

Two existing server limitations were observed during verification:

- The running development process predates git-history search. In-process current-source history
  tests pass, and the graph keyboard drive exercises the live graph without that missing filter.
- Identical chat stream events can receive the same log ID because the reader hashes their full
  payload. Different subscribers can emit identical payloads in one millisecond, and repeated close
  can emit duplicate unsubscribe records. The previous renderer also keyed by that ID. The final
  logs drive filters filesystem events; no client-side data repair was added.

The deployment is web-only and preserves the running server and its terminal and agent sessions.
