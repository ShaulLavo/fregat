import { use } from 'react'

import { ChatModelPickerContext } from '@/features/chat/providers/model-picker-context'
import { requireContext } from '@/lib/require-context'

export function useModelPicker() {
  const picker = use(ChatModelPickerContext)
  requireContext(picker, 'useModelPicker must be used within ChatModelPickerContext')
  return picker
}
