import { use } from 'react'

import { PickerLocationActionsContext } from '@/features/file-picker/providers/locations-context'
import { requireContext } from '@/lib/require-context'

export function usePickerLocationActions() {
  const actions = use(PickerLocationActionsContext)
  requireContext(
    actions,
    'usePickerLocationActions must be used within PickerLocationActionsContext',
  )
  return actions
}
