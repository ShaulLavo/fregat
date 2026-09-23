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
button treatment and tooltips. Each mode supplies its tab order and active tab,
or null when its panel is closed. The selection callback receives the clicked tab
and whether its panel should open. Clicking the active tab closes the panel in
either mode. Both rails remain mounted so the same icon can reopen it.

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
from the same icon in both modes, checking panel visibility and pressed state.
