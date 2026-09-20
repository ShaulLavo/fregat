import { createContext } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

export const SessionListContext = createContext<{
  rowBindings: ReturnType<typeof useListbox>['rowBindings']
  focusList: () => void
  selection: StoreApi<string | null>
} | null>(null)
