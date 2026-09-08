import { BrainIcon, CaretUpDownIcon } from '@phosphor-icons/react'
import type { ModelSelection } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
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
  type ModelOptionDescriptor,
} from '@workspace/client-core/chat/providers/effort'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

/** Radio value that clears the key, leaving the provider's own default in charge. */
const PROVIDER_DEFAULT_VALUE = ''

/**
 * The selected model's option descriptors, as one composer control. Every knob
 * the model advertises renders from the same descriptor shape, so a provider
 * that starts advertising a second one costs a descriptor rather than a second
 * menu — extended thinking arrived this way, already advertised and previously
 * unreachable.
 *
 * Writes land on the draft's model selection, the same override the picker and
 * the send path already read, so the pick is live for the next turn without a
 * round trip through the session projection.
 */
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
  const { modelSelection, display } = useModelPicker()
  const setModelSelection = useChatInputDraftStore((state) => state.setModelSelection)
  const model = display?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const descriptors = model ? modelOptionDescriptors(model) : []
  if (!modelSelection || descriptors.length === 0) return null

  const selection = modelSelection
  const summary = descriptorSummary(descriptors, selection)

  function selectOption(descriptor: ModelOptionDescriptor, value: string) {
    const next = value === PROVIDER_DEFAULT_VALUE ? null : value
    setModelSelection(draftTarget, withModelOption(selection, descriptor, next))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Model options'
            className='text-muted-foreground hover:text-foreground compact:h-6 compact:px-1.5 h-7 min-w-0 gap-1 rounded-md px-2 text-xs font-normal'
            disabled={disabled}
            size='sm'
            title={`Model options: ${summary}`}
            type='button'
            variant='ghost'
          >
            <BrainIcon className='size-3.5 shrink-0 opacity-70' />
            {compact ? null : <span className='truncate'>{summary}</span>}
            <CaretUpDownIcon className='size-3 shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-64 rounded-md p-1' side='top'>
        {descriptors.map((descriptor, index) => (
          <DropdownMenuRadioGroup
            key={descriptor.id}
            value={modelSelectionOptionValue(selection, descriptor) ?? PROVIDER_DEFAULT_VALUE}
          >
            {index === 0 ? null : <DropdownMenuSeparator />}
            {/* Inside the group: base-ui resolves the label against its group context. */}
            <DropdownMenuLabel>{descriptor.label}</DropdownMenuLabel>
            <DropdownMenuRadioItem
              value={PROVIDER_DEFAULT_VALUE}
              onClick={() => selectOption(descriptor, PROVIDER_DEFAULT_VALUE)}
            >
              {defaultChoiceLabel(descriptor)}
            </DropdownMenuRadioItem>
            {descriptor.choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.value}
                value={choice.value}
                onClick={() => selectOption(descriptor, choice.value)}
              >
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What the trigger says: chosen values first, the model's own defaults after. */
function descriptorSummary(
  descriptors: readonly ModelOptionDescriptor[],
  selection: ModelSelection,
) {
  const labels = descriptors
    .map((descriptor) => activeChoiceLabel(descriptor, selection))
    .filter((label): label is string => label !== null)
  if (labels.length === 0) return 'Options'

  return labels.join(' · ')
}

function activeChoiceLabel(descriptor: ModelOptionDescriptor, selection: ModelSelection) {
  const value = modelSelectionOptionValue(selection, descriptor) ?? descriptor.defaultValue
  if (value === null) return null

  return descriptor.choices.find((choice) => choice.value === value)?.label ?? null
}

function defaultChoiceLabel(descriptor: ModelOptionDescriptor) {
  const fallback = descriptor.choices.find((choice) => choice.value === descriptor.defaultValue)
  if (!fallback) return 'Provider default'

  return `Provider default (${fallback.label})`
}
