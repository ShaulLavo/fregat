import type { FilePickerMode } from '@/features/file-picker/model'

export function fileListGridClass(mode: FilePickerMode) {
  if (mode === 'folder') {
    return 'grid-cols-[minmax(0,1fr)_116px_74px] max-sm:grid-cols-1'
  }

  return 'grid-cols-[minmax(0,1fr)_80px_116px_74px] max-sm:grid-cols-[minmax(0,1fr)_68px]'
}
