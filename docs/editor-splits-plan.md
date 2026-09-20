# Editor split views implementation plan

Status: implemented and deployed on 2026-09-19. See [verification and browser evidence](verification/2026-09-19-editor-splits.md). The user agreed to the interaction below on 2026-09-19.

Grounding: checkout `04af161c`, including the working tree inspected that day. Several editor, theme, and browser-scenario files already contain unrelated changes. Preserve that work during implementation.

## Agreed interaction

An editor group contains its own tab bar and displays its selected tab. An explicit address without a document can leave a group showing the existing no-selection state. One group owns the active editor commands.

| Gesture                                        | Result                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Drag within a tab bar                          | Reorder the tab.                                                  |
| Drop on another group's tab bar                | Move the tab to the indicated insertion point.                    |
| Drop in another group's center                 | Move the tab into that group.                                     |
| Drop near the left, right, top, or bottom edge | Split that group and move the tab into the new group.             |
| Hold Ctrl during a drag on Linux or Windows    | Create another view instead of moving the source.                 |
| Hold Option during a drag on macOS             | Create another view instead of moving the source.                 |
| Invoke Split Right or Split Down               | Open another view in a new group.                                 |
| Drag a divider                                 | Resize the neighboring groups.                                    |
| Move or close the last tab in a group          | Remove the empty group. Keep one empty group when all tabs close. |

Show the destination rectangle during the drag. Keep the durable layout unchanged until drop. Escape, window blur, an outside drop, or a workspace change cancels the drag. The destination receives focus after a successful drop.

Support nested splits from the first implementation. Sidebar and terminal placement remain outside the editor layout.

## Resolve the remaining rules

Use these defaults when implementing the agreed interaction:

- A normal edge drop of a group's only tab onto that same group is invalid. Show no split preview. The copy modifier makes this a valid split.
- A center drop within the source group does not change layout or tab order.
- Allow the same content in different groups, once per group. If the destination already contains it, select the destination's existing tab. A move removes the source occurrence; a copy leaves it. Preserve the destination's view state. A strip drop repositions that resident tab to the requested anchor; a center drop preserves its existing position.
- A same-group copy into the tab bar behaves as a reorder. It does not create a duplicate tab in that group.
- Place center drops at the end of the destination's tabs. Use a specific tab anchor for tab-bar insertion.
- Select the neighboring tab when the source's selected tab leaves, following the current close behavior. Split and move always activate the destination.
- Open files from the tree or palette in the active group. Reuse a matching tab in that group. Explicitly selecting a tab always selects its exact view.
- Tab-menu Close Others, Close to the Right, Close Saved, and Close All act on that menu's group. Workspace-wide close commands retain their explicit scope.
- Move every existing editor-tab kind. Enable copy and split-copy for file-based document views, including references, diffs, saved comparisons, history, and conflicts. Settings and Search remain single-instance tools per workspace in this pass; move them between groups and disable their copy commands. Ctrl-drag must not silently turn a disabled copy into a move.
- Start new splits at equal sizes within the target's existing space. Use initial group minimums of 240px width and 160px height, centralized with layout geometry. A target that cannot fit both resulting groups offers no split preview. Resizing never closes a group.

Apply the same size eligibility to menu and keyboard split commands. Compute a split subtree's minimum by summing children along its axis, including divider space, and taking the largest child minimum across the other axis. When a restored layout cannot fit a smaller viewport, retain every group and allow the editor layout container to scroll at its minimum dimensions. Do not discard tabs or change topology to fit.

Settings and Search copies would require independent presentation state and focus identities. That is a separate extension from opening a second view of a file.

## Preserve the existing document engine

The document service already owns one shared buffer per document and separate view sessions per `TabId`. The linked editor subscribes each mounted view to buffer changes. Existing tests cover shared edits and independent view state.

Reuse this ownership. An ordinary move preserves `TabId`; a copy allocates a new `TabId` over the same document. Destination deduplication is the explicit exception: the resident destination tab survives. Never implement a move by calling close, then open. Those commands dispose views and update recently closed history.

The work is in app layout, navigation, focus, and restoration. No editor-engine synchronization rewrite or new server route is expected.

## Model groups as one tree

Choose the recursive model with tabs owned by group leaves. A split owns its axis and child sizes. Keep the globally active group ID; derive its active tab rather than maintaining a second global tab selection.

```ts
type EditorGroups = {
  readonly root: GroupNode
  readonly activeGroupId: GroupId
}

type GroupNode =
  | {
      readonly kind: 'group'
      readonly id: GroupId
      readonly tabs: readonly EditorTabRecord[]
      readonly selectedTabId: TabId | null
    }
  | {
      readonly kind: 'split'
      readonly id: SplitId
      readonly axis: 'horizontal' | 'vertical'
      readonly children: readonly [SplitChild, SplitChild, ...SplitChild[]]
    }

type SplitChild = {
  readonly node: GroupNode
  readonly size: number
}

type TabPlacement = {
  readonly tabId: TabId
  readonly mode: 'move' | 'copy'
  readonly target:
    | { readonly kind: 'group'; readonly groupId: GroupId }
    | {
        readonly kind: 'strip'
        readonly groupId: GroupId
        readonly beforeTabId: TabId | null
      }
    | {
        readonly kind: 'edge'
        readonly groupId: GroupId
        readonly edge: 'left' | 'right' | 'top' | 'bottom'
      }
}
```

These are contract sketches, not compiled declarations. Add branded `GroupId` and `SplitId` beside the existing identity types. Horizontal means children run left to right; vertical means children run top to bottom. A null strip anchor means append.

Keep pure group operations in `apps/web/src/lib/documents/utils/groups.ts`. Editor, workbench, workspace persistence, and navigation all consume them, so the shared document layer is the appropriate owner. Embed `EditorGroups` in `WorkbenchPanels`; delete the old global `editorTabs` and `activeEditorTabId` fields when their callers move.

Enforce these invariants in the transition and persistence boundaries:

- Group, split, and tab IDs are unique. Each tab belongs to one group.
- A selected tab, when present, belongs to its group. Open, select, and placement actions choose a tab. Explicit navigation without a document can clear the active group's selection while retaining its tabs.
- The active group exists. Every split has at least two children.
- Child shares are finite and positive, and normalize to 100.
- Neighboring split levels have different axes. Flatten equal-axis branches and promote a branch's sole remaining child.
- Flattening preserves geometry with `parentShare * childShare / 100`. Removing a child redistributes its space proportionally among surviving siblings.
- Splitting an existing child divides only that child's share. Unrelated siblings keep their sizes.

Use small tree traversals for tab lookup, all-tab enumeration, content counts, and active selection. Do not add a second mutable tab-to-group index.

The alternative with separate tab and group maps adds reference and membership invariants without a demonstrated need. The chosen model adopts that alternative's useful distinction between document identity and view identity without adding those maps. A fixed two-column model cannot represent the agreed nested interaction.

## Expose complete actions

Callers express the user's intent:

```ts
await editor.placeTab({
  tabId,
  mode: 'move',
  target: { kind: 'edge', groupId, edge: 'right' },
})

await editor.placeTab({
  tabId,
  mode: 'copy',
  target: { kind: 'strip', groupId, beforeTabId },
})

await editor.selectTab({ groupId, tabId })
```

One placement action resolves the current source and destination, changes membership, removes empty groups, normalizes sizes, selects the destination, settles navigation, and requests focus. Allocate identities inside the command owner; supply deterministic identities to pure transition tests.

Resolve placement against the latest workspace state when execution begins. A disappeared source, destination, or strip anchor produces a superseded result. Never guess a replacement target. An insertion before the dragged tab itself is a no-op.

Recheck workspace ownership and the transition at the actual commit boundary. The navigation coordinator can await the router before applying state; other operations can close or rename a tab during that gap. Recompute against current state or reject a changed revision, and settle the address from the applied result. Focus only a successfully applied destination. Add a test that intervenes with a close or rename before commit.

Use editor `mutationOptions` with a mutation key and a scope tied to the workspace owner. React calls the options through `useMutation`; command handlers use `runMutation`. Await the existing navigation coordinator before resolving. Consecutive placements consume the previous result. There is no file-write request or invented query invalidation for a layout change.

Apply the same ownership to committed resize changes. Include the split ID and ordered child IDs in a resize request so an old callback cannot overwrite a new topology. Keep pointer movement and size previews transient; persist on resize completion.

Replace the inert move/split APIs and their adapters in one pass. Split menu commands call placement in copy mode. Do not keep the ignored pane arguments or hardcoded `main` group as compatibility APIs.

Enrich the operation's existing wide log with source and destination group IDs, tab ID, mode, target kind, edge, result, and group counts. Include a rejection reason when a placement cannot apply. Log the committed operation, not every pointer movement.

## Build in this order

### 1. Add and verify the group operations

Implement creation, selection, placement, close, resize, traversal, and normalization in the shared document model. Reuse existing content identity and tab-record helpers.

Test the invariants before connecting the UI. Cover nested axes, equal-axis flattening, size preservation, duplicate destinations, same-group reorder in both directions, stale anchors, and single-tab self-move rejection. Verify that ordinary moves retain view IDs and copies into new groups allocate them. Destination reuse and same-group reorder allocate no new view.

Completion: deterministic transitions produce the agreed layouts and preserve identity. Do not add a second live state store during this step.

### 2. Migrate state, navigation, rendering, and restoration together

Replace the flat model throughout the existing owners:

| Existing area                                                         | Required change                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `features/workbench/utils/panels.ts`                                  | Embed groups and derive active tab, all tabs, and content counts.                          |
| `state/navigation.ts`, `navigation-coordinator.ts`                    | Commit exact group and tab selections, including selections whose URL stays identical.     |
| `features/address/state/apply-view-editors.ts`                        | Remove content-keyed reconstruction that deletes duplicate views.                          |
| `state/navigation-capture.ts`, `navigation-workspace.ts`              | Project grouped state into addresses without flattening live view ownership.               |
| `features/editor/state/apply-actions.ts`, `workspace-state.tsx`       | Replace inert actions and update active and parked workspaces.                             |
| `features/editor/utils/workspace-document.ts`                         | Apply rename and resource changes to every matching view.                                  |
| `features/editor/providers/tab-actions-provider.tsx`                  | Bind tab actions to the rendered group instead of `main`.                                  |
| `features/workbench/components/code-panel.tsx`                        | Host the recursive editor layout and render a group's bar, breadcrumbs, and selected body. |
| `features/workspace/state/cache.ts`, `lib/workspace-cache-storage.ts` | Parse and store the group tree and view identities.                                        |
| `features/workspace/hooks/use-cache-persistence.ts`                   | Persist open-view positions by `TabId`.                                                    |
| `keymap/providers/command-provider.tsx`, `keymap/state/runtime.ts`    | Capture commands from the exact active view.                                               |

Keep the address a document-level projection. Local selection and layout changes must bypass destructive tab-list reconciliation. Incoming addresses retain the placement of surviving tabs and open missing content in the active group. Preserve existing rules for explicit tab collections, dirty tabs, and unavailable resources, but apply them across groups. Browser history selects content without restoring an old tab collection. Never deduplicate view records globally to match a URL.

Preserve explicit no-document navigation: clear only the active group's selected tab and its global status and definition target. Retain its remaining tabs and the other groups' selections. Boot preserves restored selection. Extend the existing `apply-view.test.tsx` case where `?tabs=-` retains dirty or outside-root tabs while leaving no selected content.

Persist the layout, ratios, selected tabs, active group, and each open text view's scroll position per workspace. Restore the exact view position before using a content-keyed reopen default. Capture positions before a close or workspace switch as well as during debounced persistence. Keep existing outer sidebar and terminal geometry global.

Bump the workspace-cache version and discard the obsolete cache through its existing version boundary. Do not add migration or healing code. This resets saved workspace UI state; it must not delete files or dirty-document recovery data. Inspect the cache boundary before choosing the reset.

Render branches with the existing `@workspace/ui` resizable components. Use one group component and a narrow group action context. Pure helpers remain outside components. Add one component per file and import exact files.

Separate three facts: a tab is selected within its group, a group is the active editor group, and a DOM target currently has keyboard focus. Every visible selected editor keeps focus registration and language features. Only the active group owns global editor status and command selection. Tab activation must publish that selection before Save or another command runs.

Update `features/editor/components/editor.tsx`, `features/workbench/components/editor-surface-tab-body.tsx`, `file-editor-body.tsx`, and `features/settings/components/json-view.tsx` accordingly. Give definition and references results an originating tab in `features/editor/state/ui-state.tsx`; late results cannot move the cursor in another group.

React keys do not preserve a component when its parent changes. Retain text sessions through layout-driven unmounts. For diff, saved-comparison, and history tabs, move state needed to survive reparenting into tab-owned state, using the feature's existing state owner. Audit `diff-pane.tsx`, `use-diff-panes.ts`, and `use-history-viewer.ts`. Preserve selection, scroll, fold state, diff expansion, and the selected history entry where applicable. Do not introduce a new rendering engine to avoid this ownership work.

Retain one document synchronization lifetime per shared document. Closing one view must not discard dirty text, detach the other view's language support, or add the moved tab to recently closed history.

Document retention must visit every group in active and parked workspaces. Count a shared buffer once against the memory budget, retain dirty documents while any view owns them, and update every matching view on file rename or deletion.

Wire Split Right and Split Down in the tab menu and command registry to exercise this layer before pointer dragging. Make existing first, second, and third editor-group focus commands target groups in visual tree order. A missing numbered group is disabled or declined; it does not create a group. New keyboard bindings go through the existing registry.

Expose a Move Tab to Group command with a destination chooser so cross-group movement also has a keyboard path. It calls the same placement action, followed by the existing keyboard reorder interaction when a precise insertion position is needed.

Completion: menu-created splits work, exact views remain independently selectable, and reload preserves the layout. Remove the obsolete test that asserts splitting is inert. Migrate all direct flat-field callers, including benchmark controls, in this same integration step.

### 3. Add drag previews and placement

Move `DndContext` from `editor-tab-bar.tsx` to the editor-layout host. Keep a horizontal `SortableContext` for each tab bar and reuse the current pointer activation threshold. Preserve keyboard tab reordering; split commands provide a keyboard path to the new layout actions.

Branch by drag sensor. Keyboard dragging uses the sortable keyboard coordinates and remains within the source strip. It does not run the pointer-only group and edge resolver. Cross-group keyboard movement and splitting use the command actions.

Remove the editor-wide horizontal movement restriction. Add a floating tab preview that can leave the source strip without being clipped. Give source and destination metadata typed tab and group IDs.

Resolve the pointer target in this order:

1. Find the editor group under the pointer. Outside the editor means no target.
2. If the pointer is over its tab bar, resolve an insertion anchor, including an empty strip or the space after its final tab.
3. Otherwise, resolve a valid edge or the center from the group's content bounds.
4. Apply copy capability, minimum-size, and self-drop rules before displaying a preview.

Do not use global `closestCenter`, which can select a distant tab after the pointer leaves a group. Keep tab-strip autoscroll local to the hovered strip. Recalculate geometry when a pane resizes or the viewport changes. Track modifier changes during the drag, not only at drag start.

Start edge activation with a band equal to 20% of the shorter content dimension. Choose the nearest edge in corners, with a fixed tie order to prevent flicker. The preview occupies the proposed half-pane, not just that activation band. Keep the geometry function pure and calibrate the band in the real browser. This is an internal interaction rule, not a new settings control.

Place split previews above editor content, including diff and empty states. Use theme tokens and existing motion defaults. The floating tab uses an opaque floating-surface token. Keep the highlighted destination and copy indication understandable without color alone, and announce the destination through the drag accessibility support.

Submit one placement mutation on drop. Hover, cancellation, and the drag preview never write the workspace cache.

Completion: the pointer path supports reorder, center move, all four edge splits, copy, cancellation, and invalid targets without losing editor state.

### 4. Verify the complete interaction and ship

Add scenarios under `scripts/agent/scenarios/`, register them, and update `.agents/skills/verify-fregat/features/editor.md`. Put selectors in `scripts/agent/selectors.ts`. Scope selectors by group and tab ID: file paths and the first editor textbox are ambiguous once a file has two views.

Use disposable files in a verification-owned workspace. Drive real commands and pointer events. Do not set internal layout state from the browser scenario.

| Proposed scenario      | Required evidence                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor-split-drag`    | Reorder, every edge, center move, nested split, tab-bar insertion, copy modifier changes, Escape, outside drop, lone-tab self-drop, and duplicate destination. Capture the hover preview and final placement.              |
| `editor-split-state`   | Two views of one file share edits and undo while retaining independent selection, folds, and scroll. Move and collapse groups without resetting those states. Close one dirty copy, then verify the last-view save prompt. |
| `editor-split-focus`   | Alternate pane focus. Exercise Save, Find, completion, definition, references, close, numbered group focus, and palette return. Check the actual saved file and status owner.                                              |
| `editor-split-restore` | Resize a nested layout, switch workspaces, and reload. Verify tab order, active group, selected tabs, and independent scroll positions. Include same-document selections with an unchanged URL.                            |
| `editor-split-content` | Move file, reference, diff, saved comparison, history, conflict, Settings, and Search tabs. Verify copied file-based views and disabled copy actions for singleton tools.                                                  |

Implementation note: the final scenarios consolidate focus and restore checks into `editor-split-actions`, `editor-split-state`, and `editor-split-drag`. Separate `editor-split-folds` and `editor-split-blur` scenarios cover remounts and sensor cancellation. The verification record lists the assertions actually driven.

Extend focused tests for address navigation and resource reconciliation, workspace-cache parsing and persistence, document views, dirty close, and tab menus. Each test should cover a plausible loss of identity, content, focus, or placement. Use the real app fixtures and server where those tests need server state.

Run app node and DOM tests with `bun --bun vitest` from `apps/web`, selecting only the relevant files and projects. Run layout or paint browser tests with plain `vitest --config vitest.browser.config.ts`. Run web typecheck, relevant lint and formatting checks, and the design census. Include command-registry checks when metadata changes. Do not run a repository-wide test suite by default.

Read logs before the browser drives and inspect their operation windows afterward. Reuse the running dev server. Run each new scenario and read its screenshots back. Inspect query and mutation caches if a placement fails to settle. If making a performance claim, capture the same trace before and after and use `--compare`; functional evidence alone does not justify that claim.

Completion requires evidence for the changed editor UI, not only passing tests. Record the evidence directories and any known limitation in the implementation report.

Deploy the completed feature with `bun run deploy --slug=editor-splits --reason='Add editor split views'`. The expected change is web-only, so omit `--server`. Check the deploy's live-browser result and `/platform/release`. Report any unexpected server dependency before using a deployment that would restart live sessions.

## Research behind the interaction

The comparison used official documentation and current source, not live tests of every editor:

- [VS Code editor drop targets](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorDropTarget.ts) define edge previews, center placement, platform copy modifiers, and invalid self-moves.
- [VS Code layout documentation](https://code.visualstudio.com/docs/configure/custom-layout#_editor-groups) describes independent groups and split commands.
- [VS Code destination reuse](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/editor/editorGroupModel.ts#L376-L403) supports one occurrence per group.
- [Zed pane source](https://github.com/zed-industries/zed/blob/main/crates/workspace/src/pane.rs#L3586-L3700) provides a nearest-edge interaction and platform copy modifiers.
- [JetBrains tab documentation](https://www.jetbrains.com/help/rider/Managing_Editor_Tabs.html#split_editor_window) distinguishes Split from Split and Move.
- [Sublime tab multi-select](https://www.sublimetext.com/docs/tab_multi-select.html) offers side-by-side selection within a group. That interaction is outside this plan.
