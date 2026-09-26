import { parseArgs } from 'node:util'

import { createScriptError } from '../structured-errors'

export type RestartRequest = { interrupt: boolean }

export type DeployOptions = {
  liveCheck: boolean
  reason: string | null
  /** Restart into the staged release once it is staged; null leaves it to the Restart button. */
  restart: RestartRequest | null
  server: boolean
  slug?: string
}

export type DeployCommand =
  | { kind: 'help' }
  | { kind: 'rollback'; liveCheck: boolean }
  | { kind: 'restart'; request: RestartRequest; liveCheck: boolean }
  | { kind: 'deploy'; options: DeployOptions }

export function parseDeployArgs(args: readonly string[]): DeployCommand {
  const { values } = parseArgs({
    args: [...args],
    options: {
      help: { type: 'boolean', default: false },
      interrupt: { type: 'boolean', default: false },
      reason: { type: 'string' },
      restart: { type: 'boolean', default: false },
      rollback: { type: 'boolean', default: false },
      server: { type: 'boolean', default: false },
      'skip-live-check': { type: 'boolean', default: false },
      slug: { type: 'string' },
    },
    strict: true,
  })
  const liveCheck = !values['skip-live-check']
  if (values.help) return { kind: 'help' }
  if (values.interrupt && !values.restart)
    throw createScriptError('--interrupt applies to a restart. Add --restart.')
  if (values.rollback && values.restart)
    throw createScriptError(
      '--rollback restarts on its own when its server differs. Drop --restart.',
    )
  if (values.rollback) return { kind: 'rollback', liveCheck }

  const restart = values.restart ? { interrupt: values.interrupt } : null
  // Without --server there is nothing to build: restart into what is already staged.
  if (restart && !values.server) return { kind: 'restart', request: restart, liveCheck }

  return {
    kind: 'deploy',
    options: {
      liveCheck,
      reason: values.reason ?? null,
      restart,
      server: values.server,
      slug: values.slug,
    },
  }
}
