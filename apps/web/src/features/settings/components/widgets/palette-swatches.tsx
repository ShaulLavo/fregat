import { TERMINAL_ANSI_ROLES, toCss, type PaletteColors } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

const APP_CHIPS = ['background', 'card', 'primary', 'accent', 'foreground'] as const

/** One variant at a glance: five surface chips over a strip of the ANSI table. */
export function PaletteSwatches({
  className,
  colors,
  label,
}: {
  readonly className?: string
  readonly colors: PaletteColors
  readonly label: string
}) {
  return (
    <div
      aria-label={label}
      className={cn('flex flex-col gap-1 rounded-md p-1.5', className)}
      role='img'
      // The palette's own background is the only honest ground for its chips.
      style={{ backgroundColor: toCss(colors.app.background) }}
    >
      <div className='flex gap-1'>
        {APP_CHIPS.map((role) => (
          <span
            className='h-4 flex-1 rounded-md'
            key={role}
            style={{ backgroundColor: toCss(colors.app[role]) }}
          />
        ))}
      </div>
      <div className='flex gap-0.5'>
        {TERMINAL_ANSI_ROLES.slice(0, 8).map((role) => (
          <span
            className='h-1.5 flex-1 rounded-full'
            key={role}
            style={{ backgroundColor: toCss(colors.terminal[role]) }}
          />
        ))}
      </div>
    </div>
  )
}
