import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'

export class SearchResultScrollState {
  private query: string | null = null
  private viewport: SearchResultVirtualListViewport = { height: 0, top: 0 }

  read(query: string | null): SearchResultVirtualListViewport {
    if (this.query === query) return this.viewport

    return { height: this.viewport.height, top: 0 }
  }

  remember(query: string | null, viewport: SearchResultVirtualListViewport): void {
    this.query = query
    this.viewport = viewport
  }
}

const scrollStates = new WeakMap<object, SearchResultScrollState>()

export function searchResultScrollState(incarnation: object): SearchResultScrollState {
  const existing = scrollStates.get(incarnation)
  if (existing) return existing

  const state = new SearchResultScrollState()
  scrollStates.set(incarnation, state)
  return state
}

export function attachSearchResultScroll({
  element,
  query,
  scrollToOffset,
  state,
}: {
  readonly element: HTMLElement
  readonly query: string | null
  readonly scrollToOffset: (offset: number) => void
  readonly state: SearchResultScrollState
}) {
  const viewport = state.read(query)
  scrollToOffset(viewport.top)
  let height = element.clientHeight || viewport.height
  const remember = () => {
    state.remember(query, { height, top: element.scrollTop })
  }
  remember()
  element.addEventListener('scroll', remember, { passive: true })

  return () => {
    if (element.isConnected) {
      height = element.clientHeight || height
      remember()
    }
    element.removeEventListener('scroll', remember)
  }
}
