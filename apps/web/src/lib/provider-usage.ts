import { queryOptions } from '@tanstack/react-query'
import type {
  ProviderAccountUsage,
  ProviderInstanceId,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@workspace/contracts'
import { formatWait } from '@workspace/utils/timing'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/** Every consumer reads the service snapshot; collection belongs to the server lifecycle. */
export function providerUsageQueryOptions() {
  return queryOptions({
    queryKey: ['providers', 'usage'] as const,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async ({ client }) => {
      const response = await clientForQueryClient(client).providers.usage.get()
      if (response.error) throw createRpcError(response.error)
      return response.data as ProviderUsageResult
    },
  })
}

/** Only a source-supplied instance mapping establishes a composer's account group. */
export function accountsUsageFor(
  result: ProviderUsageResult | undefined,
  instance: ProviderInstanceId | null | undefined,
): readonly ProviderAccountUsage[] {
  if (!result || !instance) return []
  return result.accounts.filter((account) => account.providerInstanceIds.includes(instance))
}

export function usageProviderLabel(driverKind: string) {
  if (driverKind === 'claude') return 'Claude'
  if (driverKind === 'codex') return 'Codex'
  return driverKind
}

export function observedUsageLabel(observedAt: string | null | undefined, nowMs: number) {
  if (!observedAt) return 'Observation time unavailable'
  const age = nowMs - Date.parse(observedAt)
  if (!Number.isFinite(age) || age < 0) return 'Observation time unavailable'
  if (age < 60_000) return 'Observed just now'
  return `Observed ${formatWait(age)} ago`
}

export function usageWindowIsCurrent(
  window: ProviderUsageWindow,
  nowMs: number,
  staleAfterMs: number,
) {
  if (window.freshness !== 'fresh' || !window.observedAt) return false
  if (window.resetsAt && Date.parse(window.resetsAt) <= nowMs) return false
  const age = nowMs - Date.parse(window.observedAt)
  return Number.isFinite(age) && age >= 0 && age < staleAfterMs
}

export function usageWindowState(window: ProviderUsageWindow, nowMs: number, staleAfterMs: number) {
  if (window.resetsAt && Date.parse(window.resetsAt) <= nowMs)
    return 'Reset passed · awaiting observation'
  if (window.freshness === 'reset-passed') return 'Reset passed · awaiting observation'
  if (window.freshness === 'stale') return 'Stale observation'
  if (window.freshness !== 'fresh' || !window.observedAt) return 'Freshness unknown'
  const age = nowMs - Date.parse(window.observedAt)
  if (!Number.isFinite(age) || age < 0) return 'Freshness unknown'
  if (!usageWindowIsCurrent(window, nowMs, staleAfterMs)) return 'Stale observation'
  return 'Current observation'
}

export function usageRoutingLabel(account: ProviderAccountUsage) {
  if (!account.routing || account.routing.active === null) return 'Account selection unknown'
  if (account.routing.active) return 'Selected by source'
  return 'Source reports account unselected'
}

export function usageAccountLabel(account: ProviderAccountUsage, index: number) {
  return account.label ?? `${usageProviderLabel(account.driverKind)} account ${index + 1}`
}
