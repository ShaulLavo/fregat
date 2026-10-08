import type { Icon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Kbd } from '@workspace/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { useCommandShortcut } from '@/keymap/hooks/use-command-shortcut'
import type { PlatformCommandId } from '@/keymap/types'

/** An icon-only header control; its tooltip names the shortcut when a command backs it. */
export function HeaderButton({
  command,
  disabled = false,
  icon: Glyph,
  label,
  onClick,
}: {
  readonly command?: PlatformCommandId
  readonly disabled?: boolean
  readonly icon: Icon
  readonly label: string
  readonly onClick: () => void
}) {
  const shortcut = useCommandShortcut(command)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            focusableWhenDisabled
            size='icon-sm'
            type='button'
            variant='ghost'
            onClick={onClick}
          >
            <Glyph className='size-(--icon-size)' />
          </Button>
        }
      />
      <TooltipContent>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
