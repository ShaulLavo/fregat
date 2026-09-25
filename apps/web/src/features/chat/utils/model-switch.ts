import type {
  ModelSelection,
  OrchestrationMessage,
  OrchestrationSessionActivity,
  ProviderSnapshot,
} from '@workspace/contracts'
import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'

import { providerModelDisplayLabel } from '@/features/chat/utils/formatters'
import { descriptorSummary } from '@/features/chat/utils/model-options'

export type ModelSwitchKind = 'rerouted' | 'switched'

export type ModelSwitch = {
  /** The message or activity the marker sits above. */
  anchorId: string
  kind: ModelSwitchKind
  selection: ModelSelection
  timestamp: string
}

export const REROUTED_ACTIVITY_KIND = 'model.rerouted'

export function sameModelSelection(left: ModelSelection, right: ModelSelection) {
  if (left.providerInstanceId !== right.providerInstanceId) return false
  if (left.model !== right.model) return false

  const leftOptions = Object.entries(left.options ?? {})
  const rightOptions = right.options ?? {}
  if (leftOptions.length !== Object.keys(rightOptions).length) return false

  return leftOptions.every(([key, value]) => rightOptions[key] === value)
}

/**
 * A marker above every user turn whose selection differs from the turn before it, never
 * the first, and one where the provider rerouted a turn to another model.
 */
export function modelSwitches(
  messages: readonly OrchestrationMessage[],
  activities: readonly OrchestrationSessionActivity[],
): ModelSwitch[] {
  const switches: ModelSwitch[] = []
  let previous: ModelSelection | null = null
  for (const message of messages) {
    if (message.role !== 'user' || !message.modelSelection) continue

    if (previous && !sameModelSelection(previous, message.modelSelection)) {
      switches.push({
        anchorId: message.id,
        kind: 'switched',
        selection: message.modelSelection,
        timestamp: message.createdAt,
      })
    }
    previous = message.modelSelection
  }

  return [...switches, ...reroutes(messages, activities)]
}

function reroutes(
  messages: readonly OrchestrationMessage[],
  activities: readonly OrchestrationSessionActivity[],
): ModelSwitch[] {
  return activities.flatMap((activity) => {
    if (activity.kind !== REROUTED_ACTIVITY_KIND) return []
    const toModel = payloadString(activity.payload, 'toModel')
    const turnSelection = messages.find(
      (message) => message.role === 'user' && message.turnId === activity.turnId,
    )?.modelSelection
    if (!toModel || !turnSelection) return []

    return [
      {
        anchorId: activity.id,
        kind: 'rerouted' as const,
        selection: { providerInstanceId: turnSelection.providerInstanceId, model: toModel },
        timestamp: activity.createdAt,
      },
    ]
  })
}

/** "Switched to GPT-5.2 · High", in the words the model picker uses. */
export function modelSwitchLabel(
  kind: ModelSwitchKind,
  provider: ProviderSnapshot | undefined,
  selection: ModelSelection,
) {
  const verb = kind === 'rerouted' ? 'Rerouted to' : 'Switched to'
  const model = providerModelDisplayLabel(provider, selection)
  const catalogModel = provider?.models.find((candidate) => candidate.slug === selection.model)
  if (kind === 'rerouted' || !catalogModel) return `${verb} ${model}`

  const options = descriptorSummary(modelOptionDescriptors(catalogModel), selection)
  if (options.label === 'Options') return `${verb} ${model}`

  return `${verb} ${model} · ${options.label}`
}

function payloadString(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[key]

  return typeof value === 'string' && value.length > 0 ? value : null
}
