import { use } from 'react'
import { ApplicationRuntimeContext } from '@/providers/application-runtime-context'
import { requireContext } from '@/lib/require-context'

export function useApplicationRuntime() {
  const application = use(ApplicationRuntimeContext)
  requireContext(application, 'ApplicationRuntimeProvider is missing')
  return application
}
