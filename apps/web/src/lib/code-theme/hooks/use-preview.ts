import { useEffect, useState } from 'react'
import type { TokensResult } from 'shiki/core'

import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'

type PreviewState =
  | { readonly themeId: string; readonly kind: 'loading' }
  | { readonly themeId: string; readonly kind: 'ready'; readonly result: TokensResult }
  | { readonly themeId: string; readonly kind: 'error' }

export function useCodeThemePreview(themeId: string): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: 'loading', themeId })

  useEffect(() => {
    let active = true
    void loadCodeThemePreview(themeId).then(
      (result) => {
        if (active) setState({ kind: 'ready', result, themeId })
      },
      () => {
        if (active) setState({ kind: 'error', themeId })
      },
    )
    return () => {
      active = false
    }
  }, [themeId])

  return state.themeId === themeId ? state : { kind: 'loading', themeId }
}
