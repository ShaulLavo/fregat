import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { PageHeader } from '@/features/settings/components/page-header'

export function PageLoading({ showJson }: { showJson: boolean }) {
  return (
    <ToolPane
      className='bg-background @container/settings h-full'
      bodyClassName='overflow-hidden'
      header={
        <PageHeader
          scope={
            <>
              <div className='skeleton-sweep h-5 w-20 rounded-md' />
              <div className='skeleton-sweep h-5 w-24 rounded-md' />
            </>
          }
          search={
            showJson ? null : (
              <div className='skeleton-sweep h-(--density-control-height) w-full rounded-md' />
            )
          }
          summary={showJson ? null : <div className='skeleton-sweep h-4 w-24 rounded-md' />}
        />
      }
    >
      <LoadingState className='h-full' label='Loading settings'>
        <div aria-hidden='true' className='flex h-full min-h-0 flex-col overflow-hidden'>
          {showJson ? (
            <div className='min-h-0 flex-1 overflow-hidden py-3 font-mono'>
              <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center'>
                <div className='skeleton-sweep mr-3 ml-auto h-2 w-3 rounded-md' />
                <div className='skeleton-sweep h-2.5 w-2/5 rounded-md' />
              </div>
              <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center'>
                <div className='skeleton-sweep mr-3 ml-auto h-2 w-3 rounded-md' />
                <div className='skeleton-sweep ml-4 h-2.5 w-1/2 rounded-md' />
              </div>
              <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center'>
                <div className='skeleton-sweep mr-3 ml-auto h-2 w-3 rounded-md' />
                <div className='skeleton-sweep ml-4 h-2.5 w-2/3 rounded-md' />
              </div>
              <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center'>
                <div className='skeleton-sweep mr-3 ml-auto h-2 w-3 rounded-md' />
                <div className='skeleton-sweep ml-4 h-2.5 w-5/12 rounded-md' />
              </div>
              <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center'>
                <div className='skeleton-sweep mr-3 ml-auto h-2 w-3 rounded-md' />
                <div className='skeleton-sweep h-2.5 w-1/3 rounded-md' />
              </div>
            </div>
          ) : (
            <div className='min-h-0 flex-1 overflow-hidden p-(--density-section-padding)'>
              <div className='skeleton-sweep mb-2 h-3.5 w-28 rounded-md' />
              <div className='flex items-center gap-6 py-(--density-section-padding)'>
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <div className='skeleton-sweep h-3 w-2/5 rounded-md' />
                  <div className='skeleton-sweep h-2.5 w-4/5 rounded-md' />
                </div>
                <div className='skeleton-sweep h-6 w-20 rounded-md' />
              </div>
              <div className='flex items-center gap-6 py-(--density-section-padding)'>
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <div className='skeleton-sweep h-3 w-1/3 rounded-md' />
                  <div className='skeleton-sweep h-2.5 w-2/3 rounded-md' />
                </div>
                <div className='skeleton-sweep h-6 w-28 rounded-md' />
              </div>
              <div className='flex items-center gap-6 py-(--density-section-padding)'>
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <div className='skeleton-sweep h-3 w-1/2 rounded-md' />
                  <div className='skeleton-sweep h-2.5 w-3/4 rounded-md' />
                </div>
                <div className='skeleton-sweep h-6 w-16 rounded-md' />
              </div>
              <div className='skeleton-sweep mt-6 mb-2 h-3.5 w-24 rounded-md' />
              <div className='flex items-center gap-6 py-(--density-section-padding)'>
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <div className='skeleton-sweep h-3 w-2/5 rounded-md' />
                  <div className='skeleton-sweep h-2.5 w-3/5 rounded-md' />
                </div>
                <div className='skeleton-sweep h-6 w-24 rounded-md' />
              </div>
            </div>
          )}
        </div>
      </LoadingState>
    </ToolPane>
  )
}
