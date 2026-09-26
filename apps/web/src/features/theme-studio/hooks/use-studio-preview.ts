import type { ColorMode, Palette } from '@workspace/contracts'
import { useEffect, useEffectEvent } from 'react'

import { useDraftPreview } from '@/lib/appearance/hooks/use-draft-preview'
import type { StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { previewBundle } from '@/features/theme-studio/utils/draft'

/**
 * Keeps the whole app showing the draft, in the half chosen, for as long as the studio is open.
 * Nothing is written: leaving without Apply clears the preview and the saved theme returns.
 */
export function useStudioPreview(
  draft: StudioDraft | null,
  mode: ColorMode | null,
  palette: Palette | null,
) {
  const preview = useDraftPreview()
  // A serialized key: the draft is rebuilt each render, and the preview must not be re-set for it.
  const key = draft ? JSON.stringify([draft.theme.id, draft.variants, mode, palette]) : ''
  const show = useEffectEvent(() => {
    preview(draft ? { bundle: previewBundle(draft), mode, palette } : null)
  })

  useEffect(() => {
    show()
  }, [key])

  useEffect(() => () => preview(null), [preview])
}
