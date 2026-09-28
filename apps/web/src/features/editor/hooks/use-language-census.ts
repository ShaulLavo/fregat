import { useQuery } from '@tanstack/react-query'
import { useStore } from 'zustand'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'

export function useLanguageCensus({
  queryClient,
  workspaceStore,
}: Pick<EditorRuntime, 'queryClient' | 'workspaceStore'>) {
  const root = useStore(workspaceStore, (state) => state.rootFolder?.path ?? null)
  useQuery({ ...languageCensusQueryOptions(root ?? ''), enabled: root !== null }, queryClient)
}
