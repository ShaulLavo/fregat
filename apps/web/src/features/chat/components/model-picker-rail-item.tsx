import type { ProviderInstanceId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'

import { ProviderGlyph } from '@/features/chat/components/provider-glyph'
import type { ProviderModelOptionGroup } from '@workspace/client-core/chat/providers/models'

/**
 * One provider button in the rail, with the active marker riding its right edge.
 * Hover is a `foreground` tint rather than a surface token: the rail is already
 * `bg-muted`, and `bg-accent` resolves to the same colour, so a surface hover
 * would be invisible here.
 */
export function ModelPickerRailItem({
  active,
  group,
  onSelect,
}: {
  readonly active: boolean
  readonly group: ProviderModelOptionGroup
  readonly onSelect: (providerInstanceId: ProviderInstanceId) => void
}) {
  // Every option in a group shares its provider's reason, so the first says it all.
  const disabledReason = group.options[0]?.disabledReason ?? null
  // A signed-out provider stays reachable: its panel is where sign-in lives.
  const blocked = disabledReason !== null && disabledReason.kind !== 'sign-in'

  return (
    <div className='relative w-full'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-disabled={blocked}
              aria-label={group.displayLabel}
              className={cn(
                'hover:bg-foreground/10 focus-visible:bg-foreground/10 aspect-square h-auto w-full p-0',
                blocked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={blocked ? undefined : () => onSelect(group.providerInstanceId)}
            >
              <ProviderGlyph
                className='text-3xs size-5'
                displayLabel={group.displayLabel}
                driverKind={group.driverKind}
              />
            </Button>
          }
        />
        <TooltipContent align='center' className='max-w-64 leading-snug text-balance' side='left'>
          {disabledReason?.message ?? group.displayLabel}
        </TooltipContent>
      </Tooltip>
      {active ? (
        <span
          aria-hidden='true'
          className='bg-primary pointer-events-none absolute top-1/2 -right-1 h-5 w-0.75 -translate-y-1/2 rounded-l-full'
        />
      ) : null}
    </div>
  )
}
