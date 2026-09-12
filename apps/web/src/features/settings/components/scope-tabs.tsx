import { Button } from '@workspace/ui/components/button'

import { selectSettingsScope, useSettingsScope } from '../state/scope-store'

/**
 * User and Workspace. There is no Folder tab: this app holds exactly one root at
 * a time, so a folder layer could never disagree with the workspace layer — it
 * would be a tab that always shows identical values.
 */
export function ScopeTabs({ hasWorkspace }: { hasWorkspace: boolean }) {
  const scope = useSettingsScope()

  return (
    <div className='flex min-w-0 items-center gap-1 @max-3xl/settings:order-1' role='tablist'>
      <Button
        aria-selected={scope === 'user'}
        className='text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
        onClick={() => selectSettingsScope('user')}
        role='tab'
        size='sm'
        variant='ghost'
      >
        User
      </Button>
      <Button
        aria-selected={scope === 'workspace'}
        className='text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
        // Gated on a folder being open rather than hidden: the tab is real, it
        // just has no file to write to until there is a workspace.
        disabled={!hasWorkspace}
        onClick={() => selectSettingsScope('workspace')}
        role='tab'
        size='sm'
        title={hasWorkspace ? undefined : 'Open a folder to use workspace settings'}
        variant='ghost'
      >
        Workspace
      </Button>
    </div>
  )
}
