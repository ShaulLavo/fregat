import { LoadingState } from '@workspace/ui/components/loading-state'

const pathWidths = ['w-3/5', 'w-2/5', 'w-1/2'] as const

export function WorkspaceEditPreviewLoading() {
  return (
    <LoadingState className='py-2' label='Preparing workspace edit preview'>
      <div aria-hidden='true' className='grid gap-2'>
        {pathWidths.map((width) => (
          <div className='bg-card rounded-lg p-3' key={width}>
            <div className='flex items-center gap-2'>
              <div className='skeleton-sweep size-(--icon-size-sm) shrink-0 rounded-md' />
              <div className='skeleton-sweep h-3 w-24 rounded-md' />
              <div className='skeleton-sweep ml-auto h-3 w-14 rounded-md' />
            </div>
            <div className={`skeleton-sweep mt-2 h-2.5 rounded-md ${width}`} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
