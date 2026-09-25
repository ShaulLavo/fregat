import { use } from 'react'

import { CommandBusContext } from '@/keymap/providers/bus-context'
import { clientErrors } from '@/lib/structured-errors'

export function useBusBinding() {
  const value = use(CommandBusContext)
  if (!value) throw clientErrors.CONTEXT_MISSING({ message: 'CommandBusProvider is missing' })
  return value
}
