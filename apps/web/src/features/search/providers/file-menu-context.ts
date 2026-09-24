import { createContext, type MouseEvent } from 'react'

import type { SearchResultOpenTarget } from '@/features/search/utils/result-view-model'

/** Opens the search file menu for a row; provided by the surface that owns the menu. */
export type OpenSearchFileMenu = (
  target: SearchResultOpenTarget,
  event: MouseEvent<HTMLElement>,
) => void

export const SearchFileMenuContext = createContext<OpenSearchFileMenu | null>(null)
