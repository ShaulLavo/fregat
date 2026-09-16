import { Button } from '@workspace/ui/components/button'

import { selectSettingsScope, useSettingsScope, type SettingsScope } from '../state/scope-store'
import { selectSettingsView } from '../state/view-store'

const TAB_CLASS =
  'text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'

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
    <div className='flex min-w-0 items-center gap-1 @max-3xl/settings:order-1' role='tablist'>
      <ScopeTab active={scope === 'user'} label='User' scope='user' />
      <ScopeTab
        active={scope === 'workspace'}
        // Gated on a folder being open rather than hidden: the tab is real, it
        // just has no file to write to until there is a workspace.
        disabledReason={hasWorkspace ? null : 'Open a folder to use workspace settings'}
        label='Workspace'
        scope='workspace'
      />
      <ScopeTab
        active={scope === 'default'}
        disabledReason={hasDefaults ? null : 'Open Settings in a tab to read the defaults'}
        label='Defaults'
        scope='default'
      />
    </div>
  )
}

function ScopeTab({
  active,
  disabledReason = null,
  label,
  scope,
}: {
  active: boolean
  disabledReason?: string | null
  label: string
  scope: SettingsScope
}) {
  return (
    <Button
      aria-selected={active}
      className={TAB_CLASS}
      disabled={disabledReason !== null}
      onClick={() => {
        selectSettingsScope(scope)
        if (scope === 'default') selectSettingsView('json')
      }}
      role='tab'
      size='sm'
      title={disabledReason ?? undefined}
      variant='ghost'
    >
      {label}
    </Button>
  )
}
