import { DotsThreeIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { HoldButton } from '@workspace/ui/components/hold-button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useRef, useState } from 'react'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { useSettingsScope, writableSettingsScope } from '@/features/settings/state/scope-store'
import { copyTextToClipboard } from '@/lib/clipboard'

/** The list's own menu: the JSON file, the raw resolution report, and resetting every shortcut. */
export function ShortcutActions({ customized, report }: { customized: boolean; report: string }) {
  const { resetSetting } = useSettingsActions()
  const scope = writableSettingsScope(useSettingsScope())
  const [confirmAnchor, setConfirmAnchor] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <DropdownMenuTrigger
            render={
              <TooltipTrigger
                render={
                  <Button
                    aria-label='Shortcut actions'
                    ref={triggerRef}
                    size='icon'
                    variant='ghost'
                  >
                    <DotsThreeIcon />
                  </Button>
                }
              />
            }
          />
          <TooltipContent>Shortcut actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuItem onClick={() => selectSettingsView('json')}>
            Open settings JSON
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copyTextToClipboard(report, 'shortcut resolution report')}
          >
            Copy resolution report
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!customized}
            onClick={() => setConfirmAnchor(triggerRef.current)}
            variant='destructive'
          >
            Reset all shortcuts…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmAnchor ? (
        <Popover
          onOpenChange={(open) => {
            if (!open) setConfirmAnchor(null)
          }}
          open
        >
          <PopoverContent align='end' anchor={confirmAnchor}>
            <PopoverHeader>
              <PopoverTitle>Reset all shortcuts</PopoverTitle>
              <PopoverDescription>
                Every command goes back to the keyboard mode's defaults.
              </PopoverDescription>
            </PopoverHeader>
            <HoldButton
              onConfirm={() => {
                setConfirmAnchor(null)
                resetSetting('keybindings.overrides', scope)
              }}
            >
              Hold to reset all shortcuts
            </HoldButton>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  )
}
