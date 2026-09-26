import { createContext, use } from 'react'

import type { LanguageServerMatchConfigurationSnapshot } from '@/features/editor/utils/query-keys'
import { requireContext } from '@/lib/require-context'

export const LanguageServerMatchConfigurationContext = createContext<
  LanguageServerMatchConfigurationSnapshot | undefined
>(undefined)

export function useLanguageServerMatchConfiguration(): LanguageServerMatchConfigurationSnapshot {
  const configuration = use(LanguageServerMatchConfigurationContext)
  requireContext(
    configuration,
    'useLanguageServerMatchConfiguration must be used within a LanguageServerMatchProvider',
  )
  return configuration
}
