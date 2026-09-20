import { createContext, use } from 'react'

import type { LanguageServerMatchConfigurationSnapshot } from '@/features/editor/utils/query-keys'
import { clientErrors } from '@/lib/structured-errors'

export const LanguageServerMatchConfigurationContext = createContext<
  LanguageServerMatchConfigurationSnapshot | undefined
>(undefined)

export function useLanguageServerMatchConfiguration(): LanguageServerMatchConfigurationSnapshot {
  const configuration = use(LanguageServerMatchConfigurationContext)
  if (configuration) return configuration

  throw clientErrors.CONTEXT_MISSING({
    message:
      'useLanguageServerMatchConfiguration must be used within a LanguageServerMatchProvider',
  })
}
