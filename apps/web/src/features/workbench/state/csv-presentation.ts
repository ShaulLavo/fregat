import { create } from 'zustand'
import type { TabId } from '@/lib/documents/utils/types'

type CsvView = { readonly mode: 'text' | 'table'; readonly header: boolean }
const DEFAULT_VIEW: CsvView = { mode: 'text', header: false }

export const useCsvPresentation = create<{
  readonly tabs: Readonly<Record<string, CsvView>>
  readonly setMode: (tabId: TabId, mode: CsvView['mode']) => void
  readonly toggleHeader: (tabId: TabId) => void
}>((set) => ({
  tabs: {},
  setMode: (tabId, mode) =>
    set((state) => ({
      tabs: { ...state.tabs, [tabId]: { ...(state.tabs[tabId] ?? DEFAULT_VIEW), mode } },
    })),
  toggleHeader: (tabId) =>
    set((state) => {
      const view = state.tabs[tabId] ?? DEFAULT_VIEW
      return { tabs: { ...state.tabs, [tabId]: { ...view, header: !view.header } } }
    }),
}))
