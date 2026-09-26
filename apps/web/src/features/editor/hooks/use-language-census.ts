import { useLayoutEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { bindLanguageCensus } from '@/features/editor/state/language-census'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'

export function useLanguageCensus({
  queryClient,
  workspaceStore,
}: Pick<EditorRuntime, 'queryClient' | 'workspaceStore'>) {
  const root = useStore(workspaceStore, (state) => state.rootFolder?.path ?? null)
  useQuery({ ...languageCensusQueryOptions(root ?? ''), enabled: root !== null }, queryClient)
  useLayoutEffect(
    () =>
      bindLanguageCensus({
        queryClient,
        root: () => workspaceStore.getState().rootFolder?.path ?? null,
      }),
    [queryClient, workspaceStore],
  )
}
