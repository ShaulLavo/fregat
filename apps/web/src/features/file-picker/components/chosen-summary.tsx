import { FilesIcon } from '@phosphor-icons/react'

import type { FsEntry } from '@/lib/file-system-types'
import { chosenSummaryLabel } from '@/features/file-picker/utils/model'

/** The footer's account of the files to attach, wherever they were chosen. */
export function ChosenSummary({ chosen, limit }: { chosen: readonly FsEntry[]; limit: number }) {
  return (
    <div
      className='text-muted-foreground flex min-w-0 items-center gap-2 text-xs'
      title={chosen.length > 0 ? chosen.map((entry) => entry.path).join('\n') : undefined}
    >
      <FilesIcon aria-hidden='true' className='size-(--icon-size) shrink-0' />
      <span className='truncate'>{chosenSummaryLabel(chosen, limit)}</span>
    </div>
  )
}
