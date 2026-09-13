import {
  settingsMutationResourceKeys,
  settingsMutationResourcesIntersect,
  type SettingsMutationRequest,
  type SettingsMutationResourceKey,
  type SettingsOperation,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import type { QueryClient } from '@tanstack/query-core'

import {
  createIntentQueue,
  type FailedIntent,
  type Intent,
  type IntentSettlement,
} from '../optimistic/queue'

const transportStartedAtByMutationId = new Map<string, number>()

export type SettingsIntentSettlement = IntentSettlement

export type SettingsIntentHandle = {
  readonly kind: 'submitted'
  readonly mutationId: string
  readonly settled: Promise<SettingsIntentSettlement>
}

export type SettingsNoop = { readonly kind: 'noop' }
export type SettingsSubmission = SettingsIntentHandle | SettingsNoop

/**
 * One settings write as the queue carries it. The owner is the query client
 * whose confirmed document the write projects over; several environments can
 * share the queue and each reads only its own.
 */
export type SettingsIntentPatch = {
  readonly owner: QueryClient
  readonly request: SettingsMutationRequest
  readonly initiator?: string
}

/** The intent id is the mutation id, so the server's acknowledgement names it directly. */
export type ActiveSettingsIntent = Intent<SettingsIntentPatch>
export type FailedSettingsIntent = FailedIntent<SettingsIntentPatch>

export type TargetedResourceKey = `${SettingsWriteTarget}/${SettingsMutationResourceKey}`

type SubmitSettingsIntentResult = {
  readonly entry: ActiveSettingsIntent
  readonly supersededMutationIds: readonly string[]
}

// Supersession is per owner: a newer write on another environment's document
// says nothing about this one. The owner id prefixes every resource key.
const ownerIds = new WeakMap<QueryClient, string>()
let nextOwnerId = 0

export const settingsIntentStore = createIntentQueue<SettingsIntentPatch>({
  resourcesIntersect: (left, right) => {
    const [leftOwner, leftResource] = splitOwnedResource(left)
    const [rightOwner, rightResource] = splitOwnedResource(right)
    if (leftOwner !== rightOwner) return false
    return targetedResourceIntersects(leftResource, rightResource)
  },
})

export function submitSettingsIntent(
  owner: QueryClient,
  target: SettingsWriteTarget,
  operations: readonly SettingsOperation[],
  initiator?: string,
): SubmitSettingsIntentResult {
  const request: SettingsMutationRequest = {
    mutationId: globalThis.crypto.randomUUID(),
    operations,
    target,
  }
  const { intent, supersededIntentIds } = settingsIntentStore.submit(
    { owner, request, initiator },
    {
      intentId: request.mutationId,
      resources: targetedResources(target, operations).map(
        (resource) => `${ownerIdFor(owner)}|${resource}`,
      ),
    },
  )

  return { entry: intent, supersededMutationIds: supersededIntentIds }
}

export function activeSettingsIntentsFor(owner: QueryClient): readonly ActiveSettingsIntent[] {
  return settingsIntentStore.getState().active.filter((entry) => entry.patch.owner === owner)
}

export function failedSettingsIntentsFor(owner: QueryClient): readonly FailedSettingsIntent[] {
  return settingsIntentStore.getState().failed.filter((entry) => entry.patch.owner === owner)
}

export function acknowledgeSettingsIntent(mutationId: string): ActiveSettingsIntent | null {
  return settingsIntentStore.acknowledge(mutationId)
}

export function failSettingsIntent(
  mutationId: string,
  error: unknown,
): FailedSettingsIntent | null {
  const failed = settingsIntentStore.fail(mutationId, error)
  if (failed) transportStartedAtByMutationId.delete(mutationId)
  return failed
}

export function discardSettingsIntent(mutationId: string): boolean {
  transportStartedAtByMutationId.delete(mutationId)
  return settingsIntentStore.discard(mutationId)
}

export function discardFailedSettingsIntent(mutationId: string): boolean {
  return settingsIntentStore.discardFailed(mutationId)
}

export function retrySettingsIntent(mutationId: string): ActiveSettingsIntent | null {
  return settingsIntentStore.retry(mutationId)
}

export function settleSettingsIntentTransport(mutationId: string) {
  settingsIntentStore.settleTransport(mutationId)
  transportStartedAtByMutationId.delete(mutationId)
}

export function settingsIntentStatus(
  mutationId: string,
): ActiveSettingsIntent['status'] | 'failed' | null {
  const state = settingsIntentStore.getState()
  const active = state.active.find((entry) => entry.intentId === mutationId)
  if (active) return active.status

  return state.failed.some((entry) => entry.intentId === mutationId) ? 'failed' : null
}

export function markSettingsIntentTransportStarted(mutationId: string, startedAt: number) {
  const known = transportStartedAtByMutationId.get(mutationId)
  if (known !== undefined) return known

  transportStartedAtByMutationId.set(mutationId, startedAt)
  return startedAt
}

export function settingsIntentTransportStartedAt(mutationId: string) {
  return transportStartedAtByMutationId.get(mutationId)
}

export function resetSettingsIntentStore() {
  settingsIntentStore.reset()
  transportStartedAtByMutationId.clear()
}

function targetedResources(
  target: SettingsWriteTarget,
  operations: readonly SettingsOperation[],
): readonly TargetedResourceKey[] {
  return settingsMutationResourceKeys(operations).map(
    (resource): TargetedResourceKey => `${target}/${resource}`,
  )
}

function ownerIdFor(owner: QueryClient) {
  const known = ownerIds.get(owner)
  if (known !== undefined) return known

  nextOwnerId += 1
  const id = String(nextOwnerId)
  ownerIds.set(owner, id)
  return id
}

function splitOwnedResource(resource: string): [string, TargetedResourceKey] {
  const separator = resource.indexOf('|')
  return [resource.slice(0, separator), resource.slice(separator + 1) as TargetedResourceKey]
}

function targetedResourceIntersects(left: TargetedResourceKey, right: TargetedResourceKey) {
  const leftTarget = left.slice(0, left.indexOf('/'))
  const rightTarget = right.slice(0, right.indexOf('/'))
  if (leftTarget !== rightTarget) return false

  return settingsMutationResourcesIntersect(resourcePart(left), resourcePart(right))
}

function resourcePart(resource: TargetedResourceKey): SettingsMutationResourceKey {
  return resource.slice(resource.indexOf('/') + 1) as SettingsMutationResourceKey
}
