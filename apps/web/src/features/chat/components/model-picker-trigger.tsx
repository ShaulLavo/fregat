import { CaretDownIcon } from '@phosphor-icons/react'
import type { ProviderSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { ProviderGlyph } from '@/features/chat/components/provider-glyph'
import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { providerModelDisplayLabel, providerStatusLabel } from '@/features/chat/utils/formatters'
import { providerTriggerTone } from '@/features/chat/utils/provider-status-tone'
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
  const { additionalModels, modelSelection, provider } = useModelPicker()
  // No ready provider offers a model yet. Stay openable — the rows carry the
  // sign-in and not-installed affordances the user needs to fix it.
  const modelLabel = modelSelection
    ? providerModelDisplayLabel(provider, modelSelection)
    : 'Select model'
  const statusLabel = triggerStatusLabel(provider)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            render={
              <Button
                aria-label='Provider and model'
                // The one control that gives way in a narrow composer: Button is
                // shrink-0 by default, so only the model name truncates.
                className='text-muted-foreground max-w-44 min-w-0 shrink truncate'
                disabled={disabled}
                focusableWhenDisabled
                size='sm'
                type='button'
                variant='ghost'
              />
            }
          >
            {provider ? (
              <ProviderGlyph
                className='text-3xs size-3.5'
                displayLabel={provider.displayLabel}
                driverKind={provider.driverKind}
              />
            ) : null}
            <span className='min-w-0 truncate'>{modelLabel}</span>
            {additionalModels.length > 0 ? (
              <span className='text-muted-foreground text-2xs shrink-0 font-mono tabular-nums'>
                +{additionalModels.length}
              </span>
            ) : null}
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0' />
            <StatusDot aria-label={statusLabel} tone={providerTriggerTone(provider, busy)} />
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
