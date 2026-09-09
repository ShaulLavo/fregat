import { CaretDownIcon } from '@phosphor-icons/react'
import type { ProviderSnapshot } from '@workspace/contracts'
import { PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'

import { ProviderGlyph } from '@/features/chat/components/provider-glyph'
import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { providerModelDisplayLabel, providerStatusLabel } from '@/features/chat/utils/formatters'
import { providerRequiresSignIn } from '@workspace/client-core/chat/providers/auth'

/**
 * Composer control that opens the model picker. Stays interactive while the
 * provider list is still loading — the panel owns the loading and empty states,
 * so a slow query must never paint a dead grey button.
 */
export function ModelPickerTrigger({
  busy,
  disabled,
}: {
  readonly busy: boolean
  readonly disabled: boolean
}) {
  const { modelSelection, provider, display } = useModelPicker()
  // No ready provider offers a model yet. Stay openable — the rows carry the
  // sign-in and not-installed affordances the user needs to fix it.
  const modelLabel = modelSelection
    ? providerModelDisplayLabel(display, modelSelection)
    : 'Select model'
  const statusLabel = triggerStatusLabel(provider)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            render={
              <button
                aria-label='Provider and model'
                className='text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 compact:h-6 compact:px-1.5 flex h-7 max-w-44 items-center gap-1 truncate rounded-md px-2 text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'
                disabled={disabled}
                type='button'
              />
            }
          >
            {display ? (
              <ProviderGlyph
                className='size-3.5 text-[7px]'
                displayLabel={display.displayLabel}
                driverKind={display.driverKind}
              />
            ) : null}
            <span className='min-w-0 truncate'>{modelLabel}</span>
            <CaretDownIcon className='size-3 shrink-0' />
            <span
              aria-label={statusLabel}
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                triggerStatusDotClass(provider, busy),
              )}
            />
          </PopoverTrigger>
        }
      />
      <TooltipContent>{`${modelLabel} - ${statusLabel}`}</TooltipContent>
    </Tooltip>
  )
}

// Signed out is the one blocker the user can clear from the panel this trigger
// opens, so it outranks whatever generic status the snapshot carries.
function triggerStatusLabel(provider: ProviderSnapshot | undefined) {
  if (provider && providerRequiresSignIn(provider)) {
    return `${provider.displayLabel} sign-in required`
  }

  return providerStatusLabel(provider)
}

function triggerStatusDotClass(provider: ProviderSnapshot | undefined, busy: boolean) {
  if (busy) return 'bg-info'
  if (!provider) return 'bg-muted-foreground/35'
  if (providerRequiresSignIn(provider)) return 'bg-destructive'
  if (provider.status === 'ready') return 'bg-success'
  if (provider.status === 'warning') return 'bg-warning'

  return 'bg-destructive'
}
