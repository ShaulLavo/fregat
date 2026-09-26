import { LoadingState } from '@workspace/ui/components/loading-state'
import { ListRow } from '@workspace/ui/patterns/list-row'

export function IconsLoading({ columns }: { columns: number }) {
  return (
    <LoadingState className='absolute inset-0 overflow-hidden' label='Loading folder'>
      <div aria-hidden='true' className='flex flex-wrap gap-1 px-2'>
        {Array.from({ length: columns * 3 }, (_, index) => (
          <ListRow
            className='flex h-auto w-(--picker-tile-width) flex-col items-center gap-1 p-2'
            key={index}
          >
            <div className='skeleton-sweep h-20 w-full rounded-md' />
            <div className='skeleton-sweep h-4 w-2/3 rounded-md' />
          </ListRow>
        ))}
      </div>
    </LoadingState>
  )
}
