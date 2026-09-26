import { CaretUpDownIcon } from '@phosphor-icons/react'
import type { ProviderOptionDescriptor } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import {
  modelOptionDescriptors,
  withModelOption,
} from '@workspace/client-core/chat/providers/options'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

import {
  descriptorSummary,
  effectiveOptionValue,
  promptEffortState,
  withUltrathinkPrefix,
  withoutUltrathinkPrefix,
} from '../utils/model-options'
import { composerEffortTier } from '@/features/chat/utils/effort-tier'
import { ModelOptionsGroup } from './model-options-group'
import { ModelOptionsSummary } from './model-options-summary'
import { ModelOptionsTriggerIcon } from './model-options-trigger-icon'

export function ModelOptionsMenu({
  compact,
  narrow = false,
  disabled,
  draftTarget,
}: {
  /** Narrow composer: the icon carries the control and the summary is dropped. */
  readonly compact: boolean
  /** Narrowest composer: the icon alone; the tooltip still names the options. */
  readonly narrow?: boolean
  readonly disabled: boolean
  readonly draftTarget: ChatInputDraftTarget
}) {
  const { modelSelection, provider } = useModelPicker()
  const setModelSelection = useChatInputDraftStore((state) => state.setModelSelection)
  const prompt = useChatInputDraftStore((state) => state.getDraft(draftTarget).prompt)
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const descriptors = model ? modelOptionDescriptors(model) : []
  if (!modelSelection || descriptors.length === 0) return null

  const selection = modelSelection
  const summary = descriptorSummary(descriptors, selection, prompt)
  const effort = promptEffortState(descriptors, prompt)
  const ultra = composerEffortTier(descriptors, selection, prompt) === 'ultra'
  const selects = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: 'select' }> =>
      descriptor.type === 'select',
  )
  const switches = descriptors.filter((descriptor) => descriptor.type === 'boolean')
  const tooltip = summary.fast ? `${summary.label}, fast mode on` : summary.label

  function selectOption(descriptor: ProviderOptionDescriptor, value: string | boolean) {
    const drafts = useChatInputDraftStore.getState()
    const currentPrompt = drafts.getDraft(draftTarget).prompt
    if (descriptor.type === 'select' && descriptor.promptInjectedValues?.includes(String(value))) {
      drafts.setPrompt(draftTarget, withUltrathinkPrefix(currentPrompt))
      return
    }
    const currentEffort = promptEffortState(descriptors, currentPrompt)
    if (descriptor.id === currentEffort.descriptorId && currentEffort.inBody) return
    if (descriptor.id === currentEffort.descriptorId && currentEffort.controlled)
      drafts.setPrompt(draftTarget, withoutUltrathinkPrefix(currentPrompt))
    setModelSelection(draftTarget, withModelOption(selection, descriptor, value))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label='Model options'
                  className='group/options text-muted-foreground min-w-0 gap-1 text-xs font-normal'
                  disabled={disabled}
                  focusableWhenDisabled
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <ModelOptionsTriggerIcon compact={compact} fast={summary.fast} ultra={ultra} />
                  {compact ? null : (
                    <ModelOptionsSummary
                      parts={summary.parts}
                      ultraPartId={ultra ? effort.descriptorId : undefined}
                    />
                  )}
                  {narrow ? null : (
                    <CaretUpDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent>Model options: {tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start' className='w-52 p-1' side='top'>
        {selects.map((descriptor, index) => (
          <ModelOptionsGroup
            key={descriptor.id}
            descriptor={descriptor}
            first={index === 0}
            locked={effort.inBody && descriptor.id === effort.descriptorId}
            value={
              effort.controlled && descriptor.id === effort.descriptorId
                ? 'ultrathink'
                : String(effectiveOptionValue(descriptor, selection) ?? '')
            }
            onSelect={(value) => selectOption(descriptor, value)}
          />
        ))}
        {switches.length > 0 && selects.length > 0 ? (
          <DropdownMenuSeparator className='my-1' />
        ) : null}
        {switches.map((descriptor) => (
          <DropdownMenuSwitchItem
            key={descriptor.id}
            checked={effectiveOptionValue(descriptor, selection) === true}
            data-tooltip={descriptor.description}
            onCheckedChange={(checked) => selectOption(descriptor, checked)}
          >
            {descriptor.label}
          </DropdownMenuSwitchItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
