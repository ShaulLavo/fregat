import { use } from 'react'

import { FocusServiceContext } from '@/lib/focus/providers/context'
import { requireContext } from '@/lib/require-context'

export function useFocusService() {
  const service = use(FocusServiceContext)
  requireContext(service, 'useFocusService must be used within FocusProvider')
  return service
}
