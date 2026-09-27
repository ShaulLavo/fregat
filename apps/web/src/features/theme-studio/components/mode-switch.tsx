import { MoonIcon, SunIcon } from '@phosphor-icons/react'
import type { ColorMode } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { IconTooltip } from '@/components/icon-tooltip'

/**
 * Which half the app shows while the studio is open; it writes nothing. One icon button that
 * flips the half, so it reads as a view control beside the tabs.
 */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ColorMode
  onChange: (mode: ColorMode) => void
}) {
  const next: ColorMode = mode === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Preview the dark half' : 'Preview the light half'

  return (
    <IconTooltip label={label} shortcut='\'>
      <Button aria-label={label} size='icon-sm' variant='ghost' onClick={() => onChange(next)}>
        {mode === 'dark' ? (
          <MoonIcon className='size-(--icon-size)' />
        ) : (
          <SunIcon className='size-(--icon-size)' />
        )}
      </Button>
    </IconTooltip>
  )
}
