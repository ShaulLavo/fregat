import { DotsThreeIcon } from '@phosphor-icons/react'
import type { SettingId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { useSettingsActions } from '../hooks/use-settings-actions'
import { useSettingsScope, writableSettingsScope } from '../state/scope-store'
import { selectSettingsView } from '../state/view-store'

/**
 * The per-row menu VS Code puts behind the gear.
 *
 * Copy Setting ID is the one that earns its place: the ids are what a
 * hand-edited settings.json needs, and typing `workbench.surface.contentOpacity`
 * from memory is how a typo becomes an unknown key.
 */
export function RowActions({
  id,
  isModified,
  value,
}: {
  id: SettingId
  isModified: boolean
  value: unknown
}) {
  const scope = writableSettingsScope(useSettingsScope())
  const { resetSetting } = useSettingsActions()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={`Actions for ${id}`} size='icon-sm' variant='ghost'>
            <DotsThreeIcon />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuItem disabled={!isModified} onClick={() => resetSetting(id, scope)}>
          Reset setting
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(id)}>
          Copy setting ID
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void navigator.clipboard?.writeText(JSON.stringify({ [id]: value }, null, 2))
          }
        >
          Copy setting as JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => selectSettingsView('json')}>
          Edit in settings.json
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
