import { use } from 'react'

import { CommandBusContext } from '@/keymap/providers/bus-context'
import { CommandContext } from '@/keymap/providers/command-context'
import { clientErrors } from '@/lib/structured-errors'

// The bus alone, for surfaces that dispatch a command but never read palette state.
// The command provider carries it in the app; leaner trees mount only the bus provider.
export function useCommandBus() {
  const command = use(CommandContext)
  const bus = use(CommandBusContext)
  const resolved = command?.bus ?? bus?.bus
  if (resolved) return resolved

  throw clientErrors.CONTEXT_MISSING({
    message: 'useCommandBus must be used within CommandProvider or CommandBusProvider',
  })
}
