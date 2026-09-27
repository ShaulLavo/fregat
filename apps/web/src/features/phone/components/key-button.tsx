import type { Icon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

/**
 * A key in the terminal's key row. A press never takes focus from the terminal, so the touch
 * keyboard stays up. An icon key carries its name in a tooltip; a held key shows as pressed.
 */
export function KeyButton({
  icon: Glyph,
  label,
  onPress,
  pressed,
}: {
  readonly icon?: Icon
  readonly label: string
  readonly onPress: () => void
  /** Set for a key that holds, such as Ctrl. */
  readonly pressed?: boolean
}) {
  const button = (
    <Button
      aria-label={Glyph ? label : undefined}
      aria-pressed={pressed}
      className='aria-pressed:bg-accent font-mono'
      size={Glyph ? 'icon-sm' : 'sm'}
      type='button'
      variant='ghost'
      onClick={(event) => {
        if ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch') return
        onPress()
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'touch' || !event.isPrimary) return
        const box = event.currentTarget.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right) return
        if (event.clientY < box.top || event.clientY > box.bottom) return
        onPress()
      }}
      // WebKit suppresses click after a cancelled touch pointerdown; release sends the key.
      // A touch keeps focus when its pointerdown is cancelled, a mouse when its mousedown is.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
    >
      {Glyph ? <Glyph className='size-(--icon-size)' /> : label}
    </Button>
  )
  if (!Glyph) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
