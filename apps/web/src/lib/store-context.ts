import { createContext, use } from 'react'
import { useStore } from 'zustand'
import type { ExtractState, StoreApi } from 'zustand/vanilla'

import { requireContext } from '@/lib/require-context'

// Generic over the whole api: a state-generic factory would erase `subscribeWithSelector`'s subscribe.
export function createStoreContext<TStoreApi extends StoreApi<unknown>>(message: string) {
  const Context = createContext<TStoreApi | null>(null)

  function useStoreApi(): TStoreApi {
    const api = use(Context)
    requireContext(api, message)
    return api
  }

  function useSelector<T>(selector: (state: ExtractState<TStoreApi>) => T): T {
    return useStore(useStoreApi(), selector)
  }

  return { Context, useStoreApi, useSelector }
}
