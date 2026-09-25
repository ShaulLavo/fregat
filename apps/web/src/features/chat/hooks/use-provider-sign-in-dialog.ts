import { use } from 'react'

import { ProviderSignInDialogContext } from '@/features/chat/providers/provider-sign-in-context'
import { requireContext } from '@/lib/require-context'

export function useProviderSignInDialog() {
  const dialog = use(ProviderSignInDialogContext)
  requireContext(dialog, 'useProviderSignInDialog must be used within ProviderSignInDialogContext')
  return dialog
}
