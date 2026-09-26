import { LoadingState } from '@workspace/ui/components/loading-state'

const labelWidths = ['w-2/5', 'w-3/5', 'w-1/3', 'w-1/2', 'w-2/5'] as const

export function LogsListLoading() {
  return (
    <LoadingState className='flex min-h-0 flex-1 flex-col' label='Loading logs'>
      <div aria-hidden='true'>
        {labelWidths.map((width, row) => (
          <div
            className='flex h-(--density-row-height) items-center gap-2 px-(--density-row-padding-x)'
            key={row}
          >
            <div className='skeleton-sweep size-(--status-dot-size) shrink-0' />
            <div className='skeleton-sweep h-2.5 w-12 shrink-0 rounded-md' />
            <div className={`skeleton-sweep h-3 rounded-md ${width}`} />
            <div className='skeleton-sweep ml-auto h-2.5 w-8 shrink-0 rounded-md' />
            <div className='skeleton-sweep size-(--icon-size-sm) shrink-0 rounded-md' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
