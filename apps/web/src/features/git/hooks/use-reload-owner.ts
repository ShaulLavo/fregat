import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { gitReloadGeneration, subscribeGitReload } from '@/features/git/state/reload'

export function useGitReloadOwner(owner: QueryClient) {
  return useSyncExternalStore(
    subscribeGitReload,
    () => gitReloadGeneration(owner),
    () => gitReloadGeneration(owner),
  )
}
