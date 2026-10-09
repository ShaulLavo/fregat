import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('onboarding', {
  PROJECT_UNAVAILABLE: {
    status: 409,
    message: 'The folder could not be opened',
    why: 'The machine accepted the project but could not open its folder.',
    fix: 'Check that the folder still exists on that machine, then try again.',
  },
  MACHINE_UNREACHABLE: {
    status: 503,
    message: 'The machine did not connect',
    why: 'Fregat could not reach the server on that machine.',
    fix: 'Check that the machine is on and reachable, then try again.',
  },
})

export function projectUnavailableError(machine: string, reason: string) {
  const { code, status, message, why, fix } = errors.PROJECT_UNAVAILABLE
  return createClientError({
    code,
    status,
    message,
    why,
    fix,
    internal: { machine, reason },
  })
}

export function machineUnreachableError(machine: string, result: string) {
  const { code, status, message, why, fix } = errors.MACHINE_UNREACHABLE
  return createClientError({
    code,
    status,
    message,
    why,
    fix,
    internal: { machine, result },
  })
}
