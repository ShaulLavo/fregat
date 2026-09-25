import { use } from 'react'

import { CommandBusContext } from '@/keymap/providers/bus-context'
import { requireContext } from '@/lib/require-context'

export function useBusBinding() {
  const value = use(CommandBusContext)
  requireContext(value, 'CommandBusProvider is missing')
  return value
}
