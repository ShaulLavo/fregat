import { useLayoutEffect, useState, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { LanguageServerMatchConfigurationContext } from '@/features/editor/providers/language-server-match-context'
import { useSettingValue } from '@/hooks/use-setting-value'
import type { LanguageServerMatchConfigurationSnapshot } from '@/features/editor/utils/query-keys'

const configurationStateByQueryClient = new WeakMap<QueryClient, LanguageServerMatchProviderState>()

type LanguageServerMatchProviderState = {
  readonly queryClient: QueryClient
  readonly signature: string
  readonly snapshot: LanguageServerMatchConfigurationSnapshot
}

export function LanguageServerMatchProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient()
  const currentConfiguration = {
    'lsp.experimental.tyForPython': useSettingValue('lsp.experimental.tyForPython'),
    'lsp.languageServers': useSettingValue('lsp.languageServers'),
    'lsp.servers': useSettingValue('lsp.servers'),
  }
  const signature = JSON.stringify(currentConfiguration)
  const [state, setState] = useState(() =>
    configurationState(queryClient, signature, currentConfiguration),
  )

  if (state.queryClient !== queryClient || state.signature !== signature) {
    setState(configurationState(queryClient, signature, currentConfiguration))
  }

  useLayoutEffect(() => {
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey[0] === 'language-server-matches' &&
        query.queryKey[3] !== state.snapshot.generation,
    })
  }, [queryClient, signature, state])

  return (
    <LanguageServerMatchConfigurationContext value={state.snapshot}>
      {children}
    </LanguageServerMatchConfigurationContext>
  )
}

function configurationState(
  queryClient: QueryClient,
  signature: string,
  configuration: LanguageServerMatchConfigurationSnapshot['configuration'],
): LanguageServerMatchProviderState {
  const current = configurationStateByQueryClient.get(queryClient)
  if (current?.signature === signature) return current

  const state = {
    queryClient,
    signature,
    snapshot: Object.freeze({
      configuration: Object.freeze(configuration),
      generation: (current?.snapshot.generation ?? 0) + 1,
    }),
  }
  configurationStateByQueryClient.set(queryClient, state)
  return state
}
