import { useContext } from 'react'
import { useStore } from 'zustand'

import { SessionListContext } from '@/features/chat-mode/providers/list-context'
import { requireContext } from '@/lib/require-context'

export function useSessionListRow(id: string) {
  const list = useContext(SessionListContext)
  requireContext(list, 'Session rows require a session list')
  const active = useStore(list.selection, (activeId) => activeId === id)
  return { rowProps: list.rowBindings(id), active }
}
