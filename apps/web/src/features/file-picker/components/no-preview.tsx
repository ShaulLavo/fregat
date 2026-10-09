import { FolderOpenIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

import { PICKER_COPY } from '@/features/file-picker/utils/model'

export function NoPreview({ isSearching }: { isSearching: boolean }) {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center text-center'>
      <div className='text-muted-foreground flex items-center justify-center'>
        {isSearching ? (
          <MagnifyingGlassIcon className='size-(--icon-size)' />
        ) : (
          <FolderOpenIcon className='size-(--icon-size)' weight='duotone' />
        )}
      </div>
      <div className='text-muted-foreground text-2xs mt-2'>{PICKER_COPY.emptyPreviewTitle}</div>
    </div>
  )
}
