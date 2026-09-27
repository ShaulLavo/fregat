import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'
import { useStore } from 'zustand'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { treeSitterWarmUpMutationOptions } from '@/features/editor/state/tree-sitter-warm-up'
import { treeSitterLanguagesForCensus } from '@/features/editor/utils/census-languages'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'

export function useLanguageCensus({
  queryClient,
  workspaceStore,
}: Pick<EditorRuntime, 'queryClient' | 'workspaceStore'>) {
  const root = useStore(workspaceStore, (state) => state.rootFolder?.path ?? null)
  const census = useQuery(
    { ...languageCensusQueryOptions(root ?? ''), enabled: root !== null },
    queryClient,
  ).data
  const { mutate: warmUp } = useMutation(treeSitterWarmUpMutationOptions(), queryClient)
  const usable = census?.readiness === 'ready' || census?.readiness === 'stale'
  // A string key: the effect runs once per distinct language set, whatever the refetch identity.
  const languageKey = usable ? treeSitterLanguagesForCensus(census.counts).join('\n') : null
  const warmUpLanguages = useEffectEvent((key: string) => warmUp(key ? key.split('\n') : []))

  useEffect(() => {
    if (languageKey !== null) warmUpLanguages(languageKey)
  }, [languageKey])
}
