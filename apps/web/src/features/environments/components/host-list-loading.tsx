import { LoadingState } from '@workspace/ui/components/loading-state'

const labelWidths = ['w-28', 'w-36', 'w-24'] as const

export function HostListLoading({ label }: { readonly label: string }) {
  return (
    <LoadingState label={label}>
      <div aria-hidden='true'>
        {labelWidths.map((width) => (
          <div
            className='flex h-(--density-row-height) items-center gap-2 px-(--density-row-padding-x)'
            key={width}
          >
            <div className='skeleton-sweep size-(--icon-size-sm) shrink-0 rounded-md' />
            <div className={`skeleton-sweep h-3 rounded-md ${width}`} />
            <div className='skeleton-sweep h-2.5 w-20 rounded-md' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
