import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { ListRow } from '@workspace/ui/patterns/list-row'

export function SpinnerContexts() {
  return (
    <div className='grid gap-(--density-control-gap) md:grid-cols-2'>
      <div className='bg-background flex flex-col gap-(--density-control-gap) rounded-md p-(--density-section-padding)'>
        <div className='flex flex-wrap items-center gap-(--density-control-gap)'>
          <Button>
            <Spinner />
            Commit
          </Button>
          <Button variant='outline' size='sm'>
            <Spinner />
            Retry
          </Button>
          <Button variant='ghost' size='xs'>
            <Spinner />
            Refresh
          </Button>
          <Button variant='secondary' size='lg'>
            <Spinner />
            Save and apply
          </Button>
        </div>
        <div>
          <ListRow>
            <Spinner size='xs' label='Working' />
            <span className='min-w-0 flex-1 text-xs'>Refactor the settings page</span>
            <span className='text-muted-foreground text-2xs'>now</span>
          </ListRow>
          <ListRow selected>
            <Spinner size='xs' label='Generating title' />
            <span className='min-w-0 flex-1 text-xs'>New session</span>
          </ListRow>
        </div>
        <div className='text-muted-foreground flex items-center gap-2 text-xs'>
          <Spinner size='xs' aria-hidden='true' />
          <span className='tabular-nums'>Working for 3s</span>
        </div>
      </div>
      <div className='grid grid-cols-2 gap-(--density-control-gap)'>
        <div className='bg-background flex min-h-40 items-center justify-center rounded-md'>
          <Spinner size='md' label='Opening terminal' />
        </div>
        <div className='bg-background flex min-h-40 items-center justify-center rounded-md'>
          <Spinner size='lg' label='Connecting chat' />
        </div>
      </div>
    </div>
  )
}
