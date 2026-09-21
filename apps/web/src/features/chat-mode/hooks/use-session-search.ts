import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { observeSessionSearch } from '@/features/chat-mode/state/observe-session-search'
import { sessionSearchOwners } from '@/features/chat-mode/utils/session-search-owners'
import {
  SESSION_SEARCH_DEBOUNCE_MS,
  isSessionSearchQuery,
} from '@/features/chat-mode/utils/session-search-query'

export function useSessionSearch() {
  const query = useSessionRailStore((state) => state.query).trim()
  const entries = useEnvironmentsStore((state) => state.entries)
  const represented = useChatProjectionStore(useShallow((state) => Object.keys(state.slices)))
  // Keep query observers attached across unrelated transcript updates.
  const owners = sessionSearchOwners(entries, represented)
  useEffect(() => {
    const store = useSessionSearchStore.getState()
    const enabled = isSessionSearchQuery(query)
    const generation = store.begin(query, enabled)
    if (!enabled) return
    let stopSearch = () => {}
    const debouncer = new Debouncer(
      () => {
        stopSearch = observeSessionSearch({
          query,
          owners,
          queryClientForOrigin: queryClientFor,
          publish: store.publish.bind(null, generation),
        })
      },
      { wait: SESSION_SEARCH_DEBOUNCE_MS },
    )
    debouncer.maybeExecute()
    return () => {
      debouncer.cancel()
      stopSearch()
    }
  }, [query, owners])
}
