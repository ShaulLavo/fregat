import { createContext } from 'react'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

export const ChangesContext = createContext<{
  rowBindings: ReturnType<typeof useListbox<string>>['rowBindings']
  focus: () => void
} | null>(null)
