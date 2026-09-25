import { use } from 'react'
import { ApplicationRuntimeContext } from '@/providers/application-runtime-context'
import { clientErrors } from '@/lib/structured-errors'

export function useApplicationRuntime() {
  const application = use(ApplicationRuntimeContext)
  if (!application)
    throw clientErrors.CONTEXT_MISSING({ message: 'ApplicationRuntimeProvider is missing' })
  return application
}
