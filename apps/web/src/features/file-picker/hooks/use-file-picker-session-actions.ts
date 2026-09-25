import { use } from 'react'

import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import { requireContext } from '@/lib/require-context'

export function useFilePickerSessionActions() {
  const actions = use(FilePickerSessionActionsContext)
  requireContext(
    actions,
    'useFilePickerSessionActions must be used within FilePickerSessionActionsContext',
  )
  return actions
}
