import { DotsThreeIcon } from '@phosphor-icons/react'
import type { SettingsWriteTarget } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { useSettingsActions } from '../hooks/use-settings-actions'
import { selectSettingsView } from '../state/view-store'

/**
 * The page-level actions.
 *
 * "Reset all" is not a convenience — it is the recovery path. A malformed
 * settings file refuses every write by design, so without a way to clear it from
 * inside the app the only fix would be a terminal. It resets by removing every
 * key rather than writing defaults in, which is the same rule per-row reset
 * follows and what keeps defaults coming from the running build.
 */
export function PageActions({ scope }: { scope: SettingsWriteTarget }) {
  const { resetAll } = useSettingsActions()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label='Settings actions' size='icon-sm' variant='ghost'>
            <DotsThreeIcon />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='w-60'>
        <DropdownMenuItem onClick={() => selectSettingsView('json')}>
          Open settings.json
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => resetAll(scope)}>
          Reset all {scope} settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
