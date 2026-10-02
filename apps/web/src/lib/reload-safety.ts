import { createContext } from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'

type ReloadSafety = { readonly dirtyFiles: readonly string[] }
export type ReloadSafetyStore = StoreApi<ReloadSafety>

export function createReloadSafetyStore(): ReloadSafetyStore {
  return createStore<ReloadSafety>(() => ({ dirtyFiles: [] }))
}

export const ReloadSafetyContext = createContext<ReloadSafetyStore | null>(null)
