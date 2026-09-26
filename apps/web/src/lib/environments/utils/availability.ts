import type { EnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { createClientError } from '@workspace/client-core/errors'
import { defineErrorCatalog } from 'evlog'

const availabilityErrors = defineErrorCatalog('environment', {
  MACHINE_UNAVAILABLE: {
    status: 503,
    message: ({ machine }: { machine: string }) => `${machine} is unreachable.`,
    why: 'The machine that runs this action is disconnected.',
    fix: 'Reconnect the machine in Settings → Machines, then try again.',
  },
})

export function unavailableEnvironment(entry: EnvironmentEntry | undefined) {
  if (!entry || entry.phase === 'live') return null
  if (entry.phase === 'idle') {
    return entry.connectedAt === null ? null : entry
  }
  return entry
}

export function hasConnectionNotice(
  entry: Pick<EnvironmentEntry, 'phase' | 'lastErrorAt' | 'connectedAt'>,
) {
  if (entry.phase === 'live') return false
  if (entry.phase === 'blocked' || entry.phase === 'identity-drift') return true
  if (entry.phase === 'reconnecting') return true
  return entry.lastErrorAt !== null || entry.connectedAt !== null
}

export function createMachineUnavailableError(entry: EnvironmentEntry) {
  const machine = entry.label ?? entry.name
  const definition = availabilityErrors.MACHINE_UNAVAILABLE
  return createClientError({
    code: definition.code,
    status: definition.status,
    message: definition.message({ machine }),
    why: definition.why,
    fix: `Reconnect ${machine} in Settings → Machines, then try again.`,
  })
}
