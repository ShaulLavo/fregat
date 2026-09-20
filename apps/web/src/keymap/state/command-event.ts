import { clientLogEnabled } from '@/lib/client-logging'
import type { CommandEventFactory, CommandEventScope } from './command-bus'

export function createCommandEvent(
  base: () => Parameters<CommandEventFactory>[0],
  create: CommandEventFactory,
  quietSuccess: boolean,
): CommandEventScope {
  if (!quietSuccess || clientLogEnabled('debug')) return create(base())
  let scope: CommandEventScope | null = null
  const ensure = () => (scope ??= create(base()))
  return {
    warn(message, context) {
      ensure().warn(message, context)
    },
    error(error, context) {
      ensure().error(error, context)
    },
    end(context) {
      const slow = typeof context?.durationMs === 'number' && context.durationMs >= 500
      if (
        !scope &&
        quietSuccess &&
        context?.outcome === 'handled' &&
        !slow &&
        !clientLogEnabled('debug')
      )
        return
      if (slow) ensure().warn('Slow editor command', context)
      ensure().end(context)
    },
  }
}
