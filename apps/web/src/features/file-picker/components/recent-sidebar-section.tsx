import { ClockCounterClockwiseIcon } from '@phosphor-icons/react'

import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { RecentShortcut } from '@/features/file-picker/components/recent-shortcut'
import { RecentSidebarNote } from '@/features/file-picker/components/recent-sidebar-note'
import { RecentsLoading } from '@/features/file-picker/components/recents-loading'

export function RecentSidebarSection({
  currentPath,
  state,
}: {
  currentPath: string
  state: EntriesLoadState
}) {
  return (
    <div>
      <div className='text-muted-foreground section-label mb-1 flex items-center gap-1.5 px-(--density-row-padding-x) py-1'>
        <ClockCounterClockwiseIcon className='size-(--icon-size-sm)' />
        Recent
      </div>
      {recentShortcuts(currentPath, state)}
    </div>
  )
}

function recentShortcuts(currentPath: string, state: EntriesLoadState) {
  if (state.status === 'loading') {
    return <RecentsLoading />
  }
  if (state.status === 'error') return <RecentSidebarNote>Could not load</RecentSidebarNote>
  if (state.status === 'ready' && state.data.length === 0) {
    return <RecentSidebarNote>No recent items</RecentSidebarNote>
  }

  const entries = state.status === 'ready' ? state.data : []

  return (
    <div className='space-y-0.5'>
      {entries.map((entry) => (
        <RecentShortcut currentPath={currentPath} entry={entry} key={entry.path} />
      ))}
    </div>
  )
}
