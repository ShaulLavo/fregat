import { clientErrors } from '@/lib/structured-errors'
import { use } from 'react'
import { DraftPreviewContext } from '@/lib/appearance/providers/draft-preview-context'

export function useDraftPreview() {
  const preview = use(DraftPreviewContext)
  if (!preview)
    throw clientErrors.CONTEXT_MISSING({ message: 'Draft preview requires AppearanceProvider' })
  return preview
}
