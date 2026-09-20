import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { RecentShortcut } from '@/features/file-picker/components/recent-shortcut'
import { RecentSidebarNote } from '@/features/file-picker/components/recent-sidebar-note'
import { RecentsLoading } from '@/features/file-picker/components/recents-loading'

export function RecentShortcutList({
  currentPath,
  state,
}: {
  currentPath: string
  state: EntriesLoadState
}) {
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
