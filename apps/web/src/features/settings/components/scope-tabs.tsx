import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

import { selectSettingsScope, useSettingsScope, type SettingsScope } from '../state/scope-store'
import { selectSettingsView } from '../state/view-store'

/**
 * User, Workspace and Defaults. There is no Folder tab: this app holds exactly
 * one root at a time, so a folder layer could never disagree with the workspace
 * layer — it would be a tab that always shows identical values.
 *
 * Defaults is the registry rendered as a read-only document, so selecting it
 * also switches to the JSON view: a form for values nobody set has nothing to do.
 */
export function ScopeTabs({
  hasDefaults,
  hasWorkspace,
}: {
  hasDefaults: boolean
  hasWorkspace: boolean
}) {
  const scope = useSettingsScope()

  return (
    <Tabs value={scope} onValueChange={(next: SettingsScope) => selectScope(next)}>
      <TabsList aria-label='Settings scope'>
        <ScopeTab label='User' scope='user' />
        <ScopeTab
          // Gated on a folder being open rather than hidden: the tab is real, it
          // just has no file to write to until there is a workspace.
          disabledReason={hasWorkspace ? null : 'Open a folder to use workspace settings'}
          label='Workspace'
          scope='workspace'
        />
        <ScopeTab
          disabledReason={hasDefaults ? null : 'Open Settings in a tab to read the defaults'}
          label='Defaults'
          scope='default'
        />
      </TabsList>
    </Tabs>
  )
}

function selectScope(scope: SettingsScope) {
  selectSettingsScope(scope)
  if (scope === 'default') selectSettingsView('json')
}

function ScopeTab({
  disabledReason = null,
  label,
  scope,
}: {
  disabledReason?: string | null
  label: string
  scope: SettingsScope
}) {
  return (
    <TabsTab disabled={disabledReason !== null} title={disabledReason ?? undefined} value={scope}>
      {label}
    </TabsTab>
  )
}
