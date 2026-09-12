import type { ProviderInstanceId } from '@workspace/contracts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'

import { ProviderGlyph } from '@/features/chat/components/provider-glyph'
import type { ProviderModelOptionGroup } from '@workspace/client-core/chat/providers/models'

/**
 * One provider button in the rail, with the active marker riding its right edge.
 * Raw button rather than a ghost Button: the rail is already `bg-muted`, so the
 * ghost hover fill is invisible here and outranks anything the call site sets.
 * The row tints are mixed from `foreground`, so they read on any surface.
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
            <button
              aria-disabled={blocked}
              aria-label={group.displayLabel}
              className={cn(
                'focus-ring flex aspect-square w-full items-center justify-center rounded-md border border-transparent bg-clip-padding outline-none select-none',
                !blocked && 'hover:bg-row-hover active:bg-row-active',
                blocked && 'cursor-not-allowed opacity-50',
              )}
              type='button'
              onClick={blocked ? undefined : () => onSelect(group.providerInstanceId)}
            >
              <ProviderGlyph
                className='text-3xs size-5'
                displayLabel={group.displayLabel}
                driverKind={group.driverKind}
              />
            </button>
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
