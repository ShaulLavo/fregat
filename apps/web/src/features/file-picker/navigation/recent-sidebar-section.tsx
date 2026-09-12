import { ClockCounterClockwiseIcon } from '@phosphor-icons/react'

import type { EntriesLoadState } from '@/features/file-picker/model'

import { RecentShortcutList } from '@/features/file-picker/navigation/recent-shortcut-list'

export function RecentSidebarSection({
  currentPath,
  state,
}: {
  currentPath: string
  state: EntriesLoadState
}) {
  return (
    <div>
      <div className='text-muted-foreground text-2xs mb-1 flex items-center gap-1.5 px-(--density-row-padding-x) py-1 font-medium tracking-normal uppercase'>
        <ClockCounterClockwiseIcon className='size-3.5' />
        Recent
      </div>
      <RecentShortcutList currentPath={currentPath} state={state} />
    </div>
  )
}
