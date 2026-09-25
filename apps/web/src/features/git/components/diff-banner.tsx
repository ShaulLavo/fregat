import { ArrowsLeftRightIcon, ListDashesIcon } from '@phosphor-icons/react'

import type { DiffFileNotice } from '@/features/git/utils/diff-presentation'

/**
 * One line of chrome above a drawn diff that answers what its rows cannot: that a rename changed
 * nothing, or that only the changed lines arrived.
 */
export function DiffBanner({ notice }: { notice: DiffFileNotice }) {
  const Icon = notice.kind === 'partial' ? ListDashesIcon : ArrowsLeftRightIcon

  return (
    <div
      className='text-muted-foreground flex shrink-0 items-center gap-(--density-control-gap) px-(--density-control-padding-x) py-(--density-control-gap) text-xs'
      role='status'
    >
      <Icon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      <span className='truncate'>{notice.message}</span>
    </div>
  )
}
