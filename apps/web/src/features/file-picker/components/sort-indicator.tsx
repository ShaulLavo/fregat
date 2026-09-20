import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import type { FileListSortDirection } from '@/features/file-picker/utils/sort-entries'

export function SortIndicator({ direction }: { direction?: FileListSortDirection }) {
  if (direction === 'ascending') {
    return <CaretUpIcon aria-hidden='true' className='size-(--icon-size-sm)' weight='bold' />
  }
  if (direction === 'descending') {
    return <CaretDownIcon aria-hidden='true' className='size-(--icon-size-sm)' weight='bold' />
  }

  return <CaretUpDownIcon aria-hidden='true' className='size-(--icon-size-sm)' />
}
