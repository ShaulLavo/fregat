import type { ColorMode } from '@workspace/contracts'
import { useEffect, useEffectEvent } from 'react'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import type { StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { previewBundle } from '@/features/theme-studio/utils/draft'

/**
 * Keeps the whole app showing the draft, in the half chosen, for as long as the studio is open.
 * Nothing is written: leaving without Apply clears the preview and the saved theme returns.
 */
export function useStudioPreview(draft: StudioDraft | null, mode: ColorMode | null) {
  const { preview, clear } = useBundles()
  // A serialized key: the draft is rebuilt each render, and the preview must not be re-set for it.
  const key = draft ? JSON.stringify([draft.theme.id, draft.variants, mode]) : ''
  const show = useEffectEvent(() => {
    if (draft) preview(previewBundle(draft), mode ?? undefined)
  })

  useEffect(() => {
    show()
  }, [key])

  useEffect(() => () => clear(), [clear])
}
