import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'

import type { FilePickerMode } from '@/features/file-picker/utils/model'

export function fileListAvailabilityLabel(entry: FsEntry, mode: FilePickerMode, pickable: boolean) {
  if (pickable) return null
  if (mode === 'file' && isDirectoryEntry(entry)) return 'Open to browse; cannot be chosen.'

  return 'Preview only; cannot be chosen.'
}
