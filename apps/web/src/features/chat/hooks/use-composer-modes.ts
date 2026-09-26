import { use } from 'react'

import { ChatComposerModesContext } from '@/features/chat/providers/composer-modes-context'
import { requireContext } from '@/lib/require-context'

export function useComposerModes() {
  const modes = use(ChatComposerModesContext)
  requireContext(modes, 'useComposerModes must be used within ChatComposerModesProvider')
  return modes
}
