import { LoadingState } from '@workspace/ui/components/loading-state'

const NAME_WIDTHS = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'] as const

export function ColumnLoading() {
  return (
    <LoadingState className='h-full overflow-hidden' label='Loading folder'>
      <div aria-hidden='true'>
        {NAME_WIDTHS.map((width) => (
          <div
            className='flex h-(--density-row-height) items-center gap-2 px-(--density-row-padding-x)'
            key={width}
          >
            <div className='skeleton-sweep size-(--icon-size) shrink-0 rounded-md' />
            <div className={`skeleton-sweep h-3 rounded-md ${width}`} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
