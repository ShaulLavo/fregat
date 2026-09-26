# Workspace rails

`WorkspaceRail` in `apps/web/src/components/workspace-rail.tsx` owns the rail and its
application actions. Settings is unconditional. Add future actions shared by every
workspace mode there. Modes supply their tab content; they cannot configure or replace
the application actions.

```tsx
// Workbench's rail, outside its collapsible sidebar.
<WorkspaceRail label='Sidebar tabs' side='left'>
  {/* Files, Git, Search, Logs, Chat */}
</WorkspaceRail>

// Chat's rail, outside its collapsible tool pane.
<WorkspaceRail label='Tool tabs' side='right'>
  {/* Git, Files, Editor, Search, Terminal, Problems, Logs */}
</WorkspaceRail>
```

The contract accepts `children: ReactNode`, `label: string`, and
`side: 'left' | 'right'`. There is no optional footer or Settings visibility flag.
`RailTabs` owns the tabs and their toggle behavior, using `ToggleIconButton` for
button treatment and tooltips. It reads its tabs from the enclosing pane host.

## Pane hosts

`PaneHostProvider` (`providers/pane-host-provider.tsx`) names the container its
children render in: `workbench-sidebar`, `workbench-bottom` or `chat-tools`. A
layout mounts one around its rail or tab strip and one around the pane body, so
the rail and the pane header ask the same host. `usePaneHost()` returns it, or
null outside every host (a settings page, the chat stage).

A host lists its views, the last selected one, whether the pane is visible, and
`hide`. Each view carries `select` and `toggle` already bound to that host, built
from the host's own tab list, so a bottom-panel tab cannot reach the sidebar.

- **Select** shows a view and reveals a hidden pane. The pane header menu's view
  group and the bottom panel's tab strip use it.
- **Toggle** is the rail gesture: the view already showing hides the pane, any
  other view is selected. The rail stays. Toggle sidebar (`Mod+B` or the titlebar
  button) and a repeated panel number hide the workbench rail too (`sidebarRailOpen`).
- **Hide** closes that host only. The last selected view is kept, so the rail
  icon reopens the pane on it. Both rails stay mounted for that reason.

The header's view group and Hide item come from `paneHeaderMenu` in
`keymap/menus/utils/pane-header-menu.ts`, the one menu model for every host.
Ownership comes from the provider, never from the global UI mode: the chat tool
pane and the workbench sidebar can show the same panel component, and each header
acts on the host it sits in.

The rail lives in app composition because it dispatches `workspace.showSettings`.
The existing command handles the destination: a workbench editor tab or chat's
Editor tool. The shared UI package has no knowledge of this application command.

## Design decision

Each mode places its rail beside its resizable panels. Collapsing a panel leaves
its icons and application actions available. The shared components own the
toggle behavior and application actions; the modes own their layout and state.

A separately exported Settings footer would still require every mode to remember
it. Typed tab descriptors would not strengthen the Settings invariant; existing
tab JSX and the shared button already express the local differences.

New rails must compose `WorkspaceRail`. Deliberately bypassing it remains possible,
as with any component boundary. The `sidebar-settings-button` browser scenario
checks both existing mode entry points, their different tab sets, one Settings
action pinned to each rail's bottom, opening Settings without changing mode, and
opening it again after collapsing chat tools. It also closes and reopens Search
from the same icon in both modes, checking panel visibility and pressed state,
then hides each host from its header menu (sidebar, chat tools, bottom panel) and
reopens it from its rail or command.
