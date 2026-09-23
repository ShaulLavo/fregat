import { BrainIcon, CaretUpDownIcon } from '@phosphor-icons/react'
import type { ProviderOptionDescriptor } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import {
  modelOptionDescriptors,
  modelSelectionOptionValue,
  withModelOption,
} from '@workspace/client-core/chat/providers/options'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

import {
  PROVIDER_DEFAULT_VALUE,
  descriptorSummary,
  defaultChoiceLabel,
  radioValue,
  descriptorChoices,
  promptEffortState,
  withUltrathinkPrefix,
  withoutUltrathinkPrefix,
} from '../utils/model-options'

export function ModelOptionsMenu({
  compact,
  disabled,
  draftTarget,
}: {
  /** Narrow composer: the icon carries the control and the summary is dropped. */
  readonly compact: boolean
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

  function selectOption(descriptor: ProviderOptionDescriptor, value: string) {
    const drafts = useChatInputDraftStore.getState()
    const currentPrompt = drafts.getDraft(draftTarget).prompt
    if (descriptor.type === 'select' && descriptor.promptInjectedValues?.includes(value)) {
      drafts.setPrompt(draftTarget, withUltrathinkPrefix(currentPrompt))
      return
    }
    const currentEffort = promptEffortState(descriptors, currentPrompt)
    if (descriptor.id === currentEffort.descriptorId && currentEffort.inBody) return
    if (descriptor.id === currentEffort.descriptorId && currentEffort.controlled)
      drafts.setPrompt(draftTarget, withoutUltrathinkPrefix(currentPrompt))
    let next: string | boolean | null = value
    if (value === PROVIDER_DEFAULT_VALUE) next = null
    else if (descriptor.type === 'boolean') next = value === 'on'
    setModelSelection(draftTarget, withModelOption(selection, descriptor, next))
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
                  className='text-muted-foreground min-w-0 gap-1 text-xs font-normal'
                  disabled={disabled}
                  focusableWhenDisabled
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <BrainIcon className='size-(--icon-size-sm) shrink-0 opacity-70' />
                  {compact ? null : <span className='truncate'>{summary}</span>}
                  <CaretUpDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Model options: {summary}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start' className='w-64 p-1' side='top'>
        {descriptors.map((descriptor, index) => (
          <DropdownMenuRadioGroup
            key={descriptor.id}
            aria-label={descriptor.label}
            value={
              effort.controlled && descriptor.id === effort.descriptorId
                ? 'ultrathink'
                : radioValue(modelSelectionOptionValue(selection, descriptor))
            }
          >
            {index === 0 ? null : <DropdownMenuSeparator />}
            {/* Inside the group: base-ui resolves the label against its group context. */}
            <DropdownMenuLabel>{descriptor.label}</DropdownMenuLabel>
            {effort.inBody && descriptor.id === effort.descriptorId ? (
              <p className='text-muted-foreground px-2 pb-1 text-xs'>
                Your prompt contains “ultrathink”. Remove it from the text to change this option.
              </p>
            ) : null}
            <DropdownMenuRadioItem
              closeOnClick
              disabled={effort.inBody && descriptor.id === effort.descriptorId}
              value={PROVIDER_DEFAULT_VALUE}
              onClick={() => selectOption(descriptor, PROVIDER_DEFAULT_VALUE)}
            >
              {defaultChoiceLabel(descriptor)}
            </DropdownMenuRadioItem>
            {descriptor.description ? (
              <p className='text-muted-foreground px-2 pb-1 text-xs'>{descriptor.description}</p>
            ) : null}
            {descriptorChoices(descriptor).map((choice) => (
              <DropdownMenuRadioItem
                key={choice.id}
                closeOnClick
                aria-label={choice.label}
                aria-description={choice.description}
                disabled={effort.inBody && descriptor.id === effort.descriptorId}
                value={choice.id}
                onClick={() => selectOption(descriptor, choice.id)}
              >
                <span className='flex min-w-0 flex-col gap-0.5'>
                  <span>{choice.label}</span>
                  {choice.description ? (
                    <span className='text-muted-foreground text-xs'>{choice.description}</span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
