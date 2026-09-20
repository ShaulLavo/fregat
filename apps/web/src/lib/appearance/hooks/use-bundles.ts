import { use } from 'react'

import { BundleContext } from '@/lib/appearance/providers/bundle-context'
import { clientErrors } from '@/lib/structured-errors'

export function useBundles() {
  const context = use(BundleContext)
  if (context) return context

  throw clientErrors.CONTEXT_MISSING({
    message: 'useBundles must be used within AppearanceProvider',
  })
}
