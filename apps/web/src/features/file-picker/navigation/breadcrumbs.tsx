import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { Fragment } from 'react'

import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { pathCrumbs } from '@/features/file-picker/model'

export function Breadcrumbs({ currentPath }: { currentPath: string }) {
  const { navigateTo } = useFilePickerSessionActions()
  const crumbs = pathCrumbs(currentPath)

  return (
    <div className='flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs'>
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.path || 'root'}>
          {index > 0 && <CaretRightIcon className='text-muted-foreground size-3 shrink-0' />}
          <Button
            className={cn(
              'text-muted-foreground min-w-0 shrink truncate',
              crumb.path === currentPath && 'text-foreground',
            )}
            onClick={() => navigateTo(crumb.path)}
            size='sm'
            title={crumb.path || '/'}
            type='button'
            variant='ghost'
          >
            {crumb.label}
          </Button>
        </Fragment>
      ))}
    </div>
  )
}
