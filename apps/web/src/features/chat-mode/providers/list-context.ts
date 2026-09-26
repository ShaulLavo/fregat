import { createContext } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { ItemPosition } from '@workspace/client-core/commands/item-position'

export const SessionListContext = createContext<{
  rowBindings: ReturnType<typeof useListbox>['rowBindings']
  focusList: () => void
  /** The select-item number of each of the first nine displayed sessions. */
  positions: ReadonlyMap<string, ItemPosition>
  selection: StoreApi<string | null>
} | null>(null)
