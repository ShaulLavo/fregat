import { createError } from 'evlog'

export function createMachineProxyError(cause?: unknown) {
  return createError({
    code: 'MACHINE_PROXY_UNAVAILABLE',
    message: 'The connected machine could not be reached',
    status: 502,
    why: 'The SSH connection ended or the remote server did not accept the request.',
    fix: 'Reconnect the machine and try again.',
    ...(cause instanceof Error ? { cause } : {}),
  })
}
