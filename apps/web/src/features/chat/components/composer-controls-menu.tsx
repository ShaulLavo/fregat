import { CaretUpDownIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import type { InteractionMode, RuntimeMode } from '@workspace/contracts'
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

import { useComposerModes } from '@/features/chat/hooks/use-composer-modes'
import {
  selectChatInputDraftInteractionMode,
  selectChatInputDraftRuntimeMode,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

type ComposerControlOption<TValue extends string> = {
  readonly description: string
  readonly label: string
  readonly value: TValue
}

/**
 * Product language, in escalating order of what the agent may do unattended.
 * The descriptions say what actually happens rather than naming the provider
 * flag, because the flag is what nobody could tell apart from the composer.
 */
const RUNTIME_MODE_OPTIONS: readonly ComposerControlOption<RuntimeMode>[] = [
  {
    description: 'Asks before running commands or changing files.',
    label: 'Ask first',
    value: 'approval-required',
  },
  {
    description: 'Applies file edits on its own, still asks before running commands.',
    label: 'Auto-accept edits',
    value: 'auto-accept-edits',
  },
  {
    description: 'Runs commands and changes files without asking.',
    label: 'Full access',
    value: 'full-access',
  },
]

const INTERACTION_MODE_OPTIONS: readonly ComposerControlOption<InteractionMode>[] = [
  {
    description: 'Makes the change straight away.',
    label: 'Build',
    value: 'default',
  },
  {
    description: 'Researches and proposes a plan, changes nothing until you approve it.',
    label: 'Plan',
    value: 'plan',
  },
]

/**
 * Access and plan/build controls for one composer. The draft's override wins
 * over the session's committed values, exactly like the model picker, so the
 * trigger reflects the pick before the session projection catches up.
 */
export function ComposerControlsMenu({
  disabled,
  draftTarget,
  interactionMode,
  runtimeMode,
}: {
  readonly disabled: boolean
  readonly draftTarget: ChatInputDraftTarget
  /** The session's committed mode — the fallback when the draft has no override. */
  readonly interactionMode: InteractionMode
  readonly runtimeMode: RuntimeMode
}) {
  const draftInteractionMode = useChatInputDraftStore((state) =>
    selectChatInputDraftInteractionMode(state, draftTarget),
  )
  const draftRuntimeMode = useChatInputDraftStore((state) =>
    selectChatInputDraftRuntimeMode(state, draftTarget),
  )
  const { selectInteractionMode, selectRuntimeMode } = useComposerModes()
  const activeInteractionMode = draftInteractionMode ?? interactionMode
  const activeRuntimeMode = draftRuntimeMode ?? runtimeMode
  const planActive = activeInteractionMode === 'plan'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Agent access and mode'
            className='text-muted-foreground hover:text-foreground min-w-0 text-xs font-normal'
            disabled={disabled}
            size='sm'
            title={triggerTitle(activeRuntimeMode, activeInteractionMode)}
            type='button'
            variant='ghost'
          >
            <SlidersHorizontalIcon className='size-(--icon-size-sm) shrink-0 opacity-70' />
            <span className='truncate'>{optionLabel(RUNTIME_MODE_OPTIONS, activeRuntimeMode)}</span>
            {/* Plan mode changes what a send does, so it is called out on the
                composer itself rather than only inside the menu. */}
            {planActive ? (
              <span className='border-info/40 text-info text-3xs shrink-0 rounded-md border px-1 leading-4 font-medium'>
                Plan
              </span>
            ) : null}
            <CaretUpDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-72 p-1' side='top'>
        <DropdownMenuRadioGroup value={activeRuntimeMode}>
          {/* Inside the group: base-ui resolves the label against its group context. */}
          <DropdownMenuLabel>Access</DropdownMenuLabel>
          {RUNTIME_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              className='items-start'
              key={option.value}
              value={option.value}
              onClick={() => void selectRuntimeMode(option.value)}
            >
              <OptionText description={option.description} label={option.label} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={activeInteractionMode}>
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          {INTERACTION_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              className='items-start'
              key={option.value}
              value={option.value}
              onClick={() => void selectInteractionMode(option.value)}
            >
              <OptionText description={option.description} label={option.label} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionText({
  description,
  label,
}: {
  readonly description: string
  readonly label: string
}) {
  return (
    <span className='flex min-w-0 flex-col gap-0.5'>
      <span className='font-medium'>{label}</span>
      <span className='text-muted-foreground text-2xs leading-snug'>{description}</span>
    </span>
  )
}

function optionLabel<TValue extends string>(
  options: readonly ComposerControlOption<TValue>[],
  value: TValue,
) {
  return options.find((option) => option.value === value)?.label ?? value
}

function triggerTitle(runtimeMode: RuntimeMode, interactionMode: InteractionMode) {
  const access = optionLabel(RUNTIME_MODE_OPTIONS, runtimeMode)
  const mode = optionLabel(INTERACTION_MODE_OPTIONS, interactionMode)

  return `Access: ${access} - Mode: ${mode}`
}
