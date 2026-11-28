import { queryOptions } from '@tanstack/react-query'
import { loadVscodeThemeRegistration } from '@workspace/client-core/themes/registration'
import type { VscodeThemeDefinition } from '@singapore-editor/core/shiki'
import { shikiThemeContentHash } from '@/lib/code-theme/utils/content-hash'
import { codeThemeQueryKeys } from '@/lib/code-theme/utils/query-keys'

// The catalog loads immutable registrations from this build's Shiki modules.
export function themeRegistrationQueryOptions(theme: string | VscodeThemeDefinition) {
  const id = typeof theme === 'string' ? theme : theme.id
  return queryOptions({
    queryKey: codeThemeQueryKeys.registration(id),
    queryFn: async () => {
      const registration = await loadVscodeThemeRegistration(theme)
      return { registration, contentHash: shikiThemeContentHash(id, registration) }
    },
    staleTime: 'static',
    gcTime: Infinity,
    networkMode: 'always',
    structuralSharing: false,
    retry: false,
  })
}
