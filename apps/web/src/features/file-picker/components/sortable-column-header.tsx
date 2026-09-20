import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import { SortIndicator } from '@/features/file-picker/components/sort-indicator'
import { sortButtonLabel } from '@/features/file-picker/utils/rows'
import type { FileListSort, FileListSortKey } from '@/features/file-picker/utils/sort-entries'

export function SortableColumnHeader({
  align = 'start',
  className,
  isLoading = false,
  keyName,
  label,
  onSort,
  sort,
}: {
  align?: 'start' | 'end'
  className?: string
  isLoading?: boolean
  keyName: FileListSortKey
  label: string
  onSort: (key: FileListSortKey) => void
  sort: FileListSort | null
}) {
  const direction = sort?.key === keyName ? sort.direction : undefined

  return (
    <div className={cn('min-w-0', align === 'end' && 'flex justify-end', className)}>
      <Button
        aria-label={sortButtonLabel(keyName, direction)}
        className={cn(
          'text-muted-foreground min-w-0 px-1.5 text-2xs font-medium tracking-normal uppercase',
          align === 'start' && '-ml-1.5',
          align === 'end' && '-mr-1.5',
        )}
        onClick={() => onSort(keyName)}
        size='xs'
        type='button'
        variant='ghost'
      >
        <span className='truncate'>{label}</span>
        {isLoading ? (
          <OrbitLoader className='size-3' label='Loading entries' />
        ) : (
          <SortIndicator direction={direction} />
        )}
      </Button>
    </div>
  )
}
