import { serverServiceSchema, type ServerService } from '@workspace/contracts'
import * as v from 'valibot'
import { systemErrors } from './structured-errors'

/**
 * The supervisor named on the command line (`--service=systemd-socket:fregat-server.socket`), so
 * the registration that owns this process is recorded where setup and uninstall can read it.
 */
export function serviceFromArgv(argv: readonly string[]): ServerService {
  const value = argv.find((arg) => arg.startsWith('--service='))?.slice('--service='.length)
  if (!value) return { kind: 'unmanaged', registrationId: null }
  const separator = value.indexOf(':')
  const parsed = v.safeParse(serverServiceSchema, {
    kind: separator < 0 ? value : value.slice(0, separator),
    registrationId: separator < 0 ? null : value.slice(separator + 1),
  })
  if (!parsed.success)
    throw systemErrors.ACTIVATION_INVALID({
      internal: { argument: 'service', length: value.length },
    })
  return parsed.output
}
