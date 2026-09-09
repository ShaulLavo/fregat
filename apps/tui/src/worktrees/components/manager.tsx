import { useState, useSyncExternalStore } from 'react'
import type { OrchestrationProjectShell, WorktreeId } from '@workspace/contracts'
import type { ChatOwner } from '@workspace/client-core/chat/owner'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import type { SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'
import { WorktreeDetails } from '@/worktrees/components/details'
import { worktreeChoices } from '@/worktrees/utils/choices'

export function WorktreeManager({
  session,
  chat,
  project,
  currentWorktreeId,
  theme,
  onClose,
  onSelectWorktree,
  onOpenWorkbench,
}: {
  readonly session: SettingsSession
  readonly chat: ChatOwner
  readonly project: OrchestrationProjectShell
  readonly currentWorktreeId: WorktreeId | null
  readonly theme: Theme
  readonly onClose: () => void
  readonly onSelectWorktree?: (id: WorktreeId) => void
  readonly onOpenWorkbench?: (path: string) => void | Promise<void>
}) {
  const commands = useCommands()
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const [selected, setSelected] = useState(0)
  const [detailId, setDetailId] = useState<WorktreeId | null>(null)
  const worktrees = snapshot.projection.worktreeIds.flatMap((id) => {
    const worktree = snapshot.projection.worktreeById[id]
    return worktree ? [worktree] : []
  })
  const options = worktreeChoices({ worktrees, project, value: currentWorktreeId, query: '' })
  const detail = detailId ? snapshot.projection.worktreeById[detailId] : undefined
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'worktree-manager',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      available: !detail,
      focus: () => true,
    },
    !detail,
  )
  if (detail)
    return (
      <WorktreeDetails
        key={`${detail.id}:${currentWorktreeId}`}
        session={session}
        chat={chat}
        project={project}
        worktree={detail}
        currentWorktreeId={currentWorktreeId}
        theme={theme}
        onClose={() => setDetailId(null)}
        onSelectWorktree={onSelectWorktree}
        onOpenWorkbench={onOpenWorkbench}
      />
    )
  return (
    <Dialog
      title={`Worktrees · ${project.title}`}
      theme={theme}
      width={94}
      height={24}
      onClose={onClose}
    >
      <text fg={theme.mutedForeground}>
        Manage checkouts independently of sessions. Cleanup keeps branches and commits.
      </text>
      {snapshot.status === 'loading' && <LoadingState theme={theme} label='Reading worktrees…' />}
      {snapshot.error && <text fg={theme.destructive}>{snapshot.error}</text>}
      {snapshot.status === 'ready' && options.length === 0 && (
        <EmptyState title='No worktrees' theme={theme} />
      )}
      <Select
        id='worktree-manager'
        options={options}
        selectedIndex={Math.min(selected, Math.max(0, options.length - 1))}
        onChange={setSelected}
        onSelect={(index) => {
          const id = options[index]?.value.id
          if (id) setDetailId(id)
        }}
        focused
        flexGrow={1}
        minHeight={0}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
    </Dialog>
  )
}
