import { useContext } from 'react'
import { useStore } from 'zustand'

import { SessionListContext } from '@/features/chat-mode/providers/list-context'
import { clientErrors } from '@/lib/structured-errors'

export function useSessionListRow(id: string) {
  const list = useContext(SessionListContext)
  if (!list) throw clientErrors.CONTEXT_MISSING({ message: 'Session rows require a session list' })
  const active = useStore(list.selection, (activeId) => activeId === id)
  return { rowProps: list.rowBindings(id), active, position: list.positions.get(id) ?? null }
}
