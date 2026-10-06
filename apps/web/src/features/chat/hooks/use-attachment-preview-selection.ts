import { useState } from 'react'
import {
  attachmentPreviewMatchesOwner,
  type AttachmentPreviewSelection,
} from '@/features/chat/utils/attachment-file'

export function useAttachmentPreviewSelection(
  owner: Parameters<typeof attachmentPreviewMatchesOwner>[1],
) {
  const [selection, setSelection] = useState<AttachmentPreviewSelection | null>(null)
  if (selection && !attachmentPreviewMatchesOwner(selection, owner)) setSelection(null)
  return [selection, setSelection] as const
}
