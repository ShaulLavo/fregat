import type { EnvironmentId } from '@workspace/contracts'
import type { EnvironmentsState } from '@workspace/client-core/environments/state/store'

export type SessionSearchOwner = {
  readonly environmentId: EnvironmentId
  readonly origin: string
  readonly label: string
  readonly connected: boolean
}

export function sessionSearchOwners(
  entries: EnvironmentsState['entries'],
  represented: readonly string[],
) {
  const owners = new Map<EnvironmentId, SessionSearchOwner>()
  for (const entry of Object.values(entries)) {
    if (!entry.environmentId || !represented.includes(entry.environmentId)) continue
    if (owners.has(entry.environmentId) && entry.kind !== 'primary') continue
    owners.set(entry.environmentId, {
      environmentId: entry.environmentId,
      origin: entry.origin,
      label: entry.label ?? entry.name,
      connected: entry.phase === 'live',
    })
  }
  return [...owners.values()]
}
