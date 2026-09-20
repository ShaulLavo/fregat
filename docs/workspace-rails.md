# Workspace rails

`WorkspaceRail` in `apps/web/src/components/workspace-rail.tsx` owns the rail and its
application actions. Settings is unconditional. Add future actions shared by every
workspace mode there. Modes supply their tab content; they cannot configure or replace
the application actions.

```tsx
// Workbench's existing resizable sidebar.
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
`ToggleIconButton` owns the tabs' button treatment and tooltips. Each mode owns its
tab order, active state and selection callback. Chat still collapses its tool pane
when the selected tab is clicked; workbench still selects a sidebar panel.

The rail lives in app composition because it dispatches `workspace.showSettings`.
The existing command handles the destination: a workbench editor tab or chat's
Editor tool. The shared UI package has no knowledge of this application command.

## Design decision

The shared rail with tab children was selected over moving the entire rail above
the mode switch. Lifting it would move the workbench rail outside its resizable
sidebar and change sizing and visibility. Keeping both mount locations preserves
those differences while giving application actions one owner.

A separately exported Settings footer would still require every mode to remember
it. Typed tab descriptors would not strengthen the Settings invariant; existing
tab JSX and the shared button already express the local differences.

New rails must compose `WorkspaceRail`. Deliberately bypassing it remains possible,
as with any component boundary. The `sidebar-settings-button` browser scenario
checks both existing mode entry points, their different tab sets, one Settings
action pinned to each rail's bottom, opening Settings without changing mode, and
opening it again after collapsing chat tools.
