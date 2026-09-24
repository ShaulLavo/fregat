import { useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'

import { useSettingValue } from '@/hooks/use-setting-value'
import { Command, CommandEmpty, CommandInput, CommandList } from '@workspace/ui/components/command'
import { Popover, PopoverContent } from '@workspace/ui/components/popover'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { log } from '@/lib/client-logging'
import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { useProviderSignInDialog } from '@/features/chat/hooks/use-provider-sign-in-dialog'
import { rankModelPickerOptions } from '@/features/chat/utils/model-picker-search'
import type { ProviderSignInTarget } from '@workspace/client-core/chat/providers/auth'
import {
  providerModelOptionGroups,
  providerModelSelectionKey,
  type ProviderModelOption,
  type ProviderModelOptionGroup,
} from '@workspace/client-core/chat/providers/models'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { ModelPickerLegacyRow } from '@/features/chat/components/model-picker-legacy-row'
import { ModelPickerRail } from '@/features/chat/components/model-picker-rail'
import { ModelPickerRow } from '@/features/chat/components/model-picker-row'
import { ModelPickerSignInItem } from '@/features/chat/components/model-picker-sign-in-item'
import { ModelPickerTrigger } from '@/features/chat/components/model-picker-trigger'
import { ModelsLoading } from '@/features/chat/components/models-loading'

/** What the list shows right now, and whether a sign-in row belongs under it. */
type ModelPickerList = {
  /** Retired models, shown under a collapsible row after `options`. Empty while searching. */
  readonly legacyOptions: readonly ProviderModelOption[]
  readonly options: readonly ProviderModelOption[]
  /** Set when every option above is blocked on signing this provider in. */
  readonly signInTarget: ProviderSignInTarget | null
}

/**
 * The panel is a fixed 360x346 two-pane surface. It floats free of the chat
 * sidebar it is triggered from — the popup is portalled, so the rail plus the
 * list never has to fit the sidebar's width — but it is still clamped to the
 * viewport for the narrow-window case.
 */
const PANEL_CLASS =
  'h-86.5 max-h-[calc(100svh-4rem)] w-90 max-w-[calc(100vw-1.5rem)] flex-row gap-0 overflow-hidden p-0 [clip-path:inset(0_round_var(--radius))]'

/**
 * The shared `CommandInput` is a 48px search field. That is a seventh of this
 * panel, so it is re-proportioned to a single 26px line through the primitive's
 * data-slots — geometry only, no colours of its own. The addon rule is written
 * as a two-step descendant so it outranks the primitive's own `!important` left
 * padding no matter which stylesheet order Tailwind emits.
 */
const SEARCH_FIELD_CLASS = [
  '[&_[data-slot=command-input-wrapper]]:pb-(--density-popover-padding)',
  '[&_[data-slot=input-group]]:h-6.5',
  '[&_[data-slot=input-group]]:bg-transparent',
  '[&_[data-slot=input-group]_[data-slot=input-group-addon]]:pl-0!',
  '[&_[data-slot=input-group]_[data-slot=input-group-addon]]:py-0',
  '[&_[data-slot=input-group]_svg]:opacity-70',
].join(' ')

/**
 * Provider and model picker for the composer. Runs cmdk with its own filter
 * off and feeds it our ranking instead, so `model-picker-search` decides the
 * order rather than cmdk's generic scorer.
 */
export function ModelPicker({
  busy,
  disabled,
}: {
  readonly busy: boolean
  readonly disabled: boolean
}) {
  const { sessionProviderInstanceId, modelSelection, selectModel } = useModelPicker()
  const { openSignIn } = useProviderSignInDialog()
  const providersQuery = useQuery(providerListQueryOptions())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [legacyExpanded, setLegacyExpanded] = useState(false)
  const [railProviderInstanceId, setRailProviderInstanceId] = useState<ProviderInstanceId | null>(
    null,
  )

  // The picker is where hiding and ordering a model has to mean something.
  // Until now both lists were written and never read.
  const availableGroups = providerModelOptionGroups(providersQuery.data?.providers, {
    hidden: useSettingValue('models.hidden'),
    order: useSettingValue('models.order'),
  })
  const groups =
    sessionProviderInstanceId === null
      ? availableGroups
      : availableGroups.filter((group) => group.providerInstanceId === sessionProviderInstanceId)
  // The rail scopes the list to one provider. It appears the moment a second
  // provider exists and always has a selection, so the list is never an
  // unscoped pile of every provider's models.
  const activeGroup = railGroup(
    groups,
    railProviderInstanceId ?? modelSelection?.providerInstanceId ?? null,
  )
  const list = pickerList(groups, activeGroup, query)
  const selectedKey = modelSelection ? providerModelSelectionKey(modelSelection) : null
  const emptyLabel = pickerEmptyLabel(providersQuery.isPending, groups.length > 0)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      log.info({
        action: 'chat.model_picker.open',
        area: 'chat',
        outcome: disabled ? 'disabled' : 'opened',
        sessionProviderInstanceId,
        providerCount: groups.length,
        modelsStatus: providersQuery.status,
      })
    }
    if (disabled) return

    setQuery('')
    // A legacy model in use opens its section, so the check mark is never hidden.
    if (nextOpen) setLegacyExpanded(selectedIsLegacy(groups, selectedKey))
    setOpen(nextOpen)
  }

  function handleSelect(option: ProviderModelOption) {
    selectModel(option)
    setQuery('')
    setOpen(false)
  }

  function handleSignIn(target: ProviderSignInTarget) {
    setQuery('')
    setOpen(false)
    openSignIn(target)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <ModelPickerTrigger busy={busy} disabled={disabled} />
      <PopoverContent align='start' className={PANEL_CLASS} side='top'>
        {activeGroup ? (
          <ModelPickerRail
            activeProviderInstanceId={activeGroup.providerInstanceId}
            groups={groups}
            onSelect={setRailProviderInstanceId}
          />
        ) : null}
        <Command className='min-w-0 flex-1' label='Models' shouldFilter={false}>
          <div
            className={cn(
              'px-(--density-row-padding-x) pt-(--density-section-gap)',
              SEARCH_FIELD_CLASS,
            )}
          >
            <CommandInput
              className='h-6.5'
              placeholder='Search models'
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <div className='relative min-h-0 flex-1 overflow-hidden'>
            <CommandList className='h-full max-h-full p-(--density-row-padding-y)'>
              {providersQuery.isPending ? <ModelsLoading /> : null}
              {emptyLabel ? (
                <CommandEmpty className='text-muted-foreground text-xs leading-snug font-normal'>
                  {emptyLabel}
                </CommandEmpty>
              ) : null}
              {list.signInTarget ? (
                <ModelPickerSignInItem target={list.signInTarget} onSelect={handleSignIn} />
              ) : null}
              {list.options.map((option) => (
                <ModelPickerRow
                  key={option.key}
                  option={option}
                  selected={option.key === selectedKey}
                  onSelect={handleSelect}
                />
              ))}
              {list.legacyOptions.length > 0 ? (
                <ModelPickerLegacyRow
                  count={list.legacyOptions.length}
                  expanded={legacyExpanded}
                  onToggle={() => setLegacyExpanded(!legacyExpanded)}
                />
              ) : null}
              {legacyExpanded
                ? list.legacyOptions.map((option) => (
                    <ModelPickerRow
                      key={option.key}
                      option={option}
                      selected={option.key === selectedKey}
                      onSelect={handleSelect}
                    />
                  ))
                : null}
            </CommandList>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The group the rail scopes the list to, or `null` when there is no rail. */
function railGroup(
  groups: readonly ProviderModelOptionGroup[],
  providerInstanceId: ProviderInstanceId | null,
): ProviderModelOptionGroup | null {
  if (groups.length < 2) return null

  const match = groups.find((group) => group.providerInstanceId === providerInstanceId)

  return match ?? groups[0] ?? null
}

/** A search abandons rail and provider scoping: one flat, globally ranked list. */
function pickerList(
  groups: readonly ProviderModelOptionGroup[],
  activeGroup: ProviderModelOptionGroup | null,
  query: string,
): ModelPickerList {
  const trimmedQuery = query.trim()
  // A search flattens providers, so no single group owns the list and there is
  // nothing for a sign-in row to be scoped to.
  if (trimmedQuery) {
    const options = rankModelPickerOptions(
      groups.flatMap((group) => group.options),
      trimmedQuery,
    )

    return { legacyOptions: [], options, signInTarget: null }
  }

  const group = activeGroup ?? groups[0] ?? null
  if (!group) return { legacyOptions: [], options: [], signInTarget: null }

  return {
    legacyOptions: group.options.filter((option) => option.legacy),
    options: group.options.filter((option) => !option.legacy),
    signInTarget: group.signInTarget,
  }
}

function selectedIsLegacy(groups: readonly ProviderModelOptionGroup[], selectedKey: string | null) {
  return groups.some((group) =>
    group.options.some((option) => option.key === selectedKey && option.legacy),
  )
}

function pickerEmptyLabel(loading: boolean, hasProviders: boolean) {
  if (loading) return null
  if (!hasProviders) return 'No providers available'

  return 'No models match your search'
}
