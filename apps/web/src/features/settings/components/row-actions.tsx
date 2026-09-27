import { DotsThreeIcon } from '@phosphor-icons/react'
import type { SettingId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@workspace/ui/components/dropdown-menu'
import { useState } from 'react'

import { copyTextToClipboard } from '@/lib/clipboard'

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
  // The menu mounts on the first press: a menu and a tooltip root in each of a hundred rows were
  // a large share of opening the page.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup='menu'
        aria-label={`Actions for ${id}`}
        data-tooltip={`Actions for ${id}`}
        onClick={(event) => {
          setAnchor(event.currentTarget)
          setOpen(!open)
        }}
        size='icon-sm'
        variant='ghost'
      >
        <DotsThreeIcon />
      </Button>
      {anchor ? (
        <DropdownMenu
          onOpenChange={(next, details) => {
            // The button sits outside the popup: its press would close the menu for its click to reopen.
            const target = details.event.target
            if (
              details.reason === 'outside-press' &&
              target instanceof Node &&
              anchor.contains(target)
            )
              return details.cancel()

            setOpen(next)
          }}
          open={open}
        >
          <DropdownMenuContent align='end' anchor={anchor} className='w-56'>
            <DropdownMenuItem disabled={!isModified} onClick={() => resetSetting(id, scope)}>
              Reset setting
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void copyTextToClipboard(id, 'setting ID')}>
              Copy setting ID
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void copyTextToClipboard(
                  JSON.stringify({ [id]: value }, null, 2),
                  'setting as JSON',
                )
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
      ) : null}
    </>
  )
}
