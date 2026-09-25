import { use } from 'react'

import { BundleContext } from '@/lib/appearance/providers/bundle-context'
import { requireContext } from '@/lib/require-context'

export function useBundles() {
  const context = use(BundleContext)
  requireContext(context, 'useBundles must be used within AppearanceProvider')
  return context
}
