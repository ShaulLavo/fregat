import type { EnvironmentId } from '@workspace/contracts'
import type { EnvironmentEntry } from '@workspace/client-core/environments/utils/connection'

export type ConfirmedMachine = EnvironmentEntry & { readonly environmentId: EnvironmentId }

export function connectedMachines(
  entries: Readonly<Record<string, EnvironmentEntry>>,
): readonly ConfirmedMachine[] {
  const machines = new Map<EnvironmentId, ConfirmedMachine>()
  for (const entry of Object.values(entries)) {
    const environmentId = entry.environmentId
    if (!environmentId || (entry.kind !== 'primary' && entry.phase === 'idle')) continue
    if (machines.has(environmentId) && entry.kind !== 'primary') continue
    machines.set(environmentId, { ...entry, environmentId })
  }
  return Array.from(machines.values())
}
