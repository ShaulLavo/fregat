import type { MouseEvent } from 'react'
import { createContext } from 'react'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

export const ChangesContext = createContext<{
  rowBindings: ReturnType<typeof useListbox<string>>['rowBindings']
  focus: () => void
  openMenu: (id: string, event: MouseEvent<HTMLElement>) => void
} | null>(null)
