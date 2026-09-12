import { cn } from '@workspace/ui/lib/utils'

import { providerMonogram } from '@/features/chat/utils/provider-brand-marks'

/**
 * Stand-in for a provider we ship no brand mark for. Set as a deliberate tile
 * rather than bare initials so it reads as a glyph next to the real marks.
 */
export function ProviderMonogram({
  className,
  displayLabel,
}: {
  readonly className?: string
  readonly displayLabel: string
}) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'bg-muted-foreground/15 text-muted-foreground inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-tight',
        className,
      )}
    >
      {providerMonogram(displayLabel)}
    </span>
  )
}
