import { InfoIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { selectSettingsScope } from '../state/scope-store'

/**
 * Says up front that the defaults document is read-only. A silently read-only
 * buffer makes people type into it first and find out second.
 */
export function DefaultsBanner() {
  return (
    <div className='bg-muted m-(--density-section-padding) flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg p-(--density-section-padding)'>
      <div className='flex min-w-0 items-start gap-2'>
        <InfoIcon className='text-info mt-0.5 size-(--icon-size) shrink-0' weight='fill' />
        <div className='min-w-0'>
          <p className='text-foreground text-sm font-medium'>Defaults are read-only</p>
          <p className='text-muted-foreground text-xs'>
            This document is generated from this build. Copy a key into your user settings to change
            it.
          </p>
        </div>
      </div>
      <Button onClick={() => selectSettingsScope('user')} size='sm' variant='secondary'>
        Open user settings
      </Button>
    </div>
  )
}
