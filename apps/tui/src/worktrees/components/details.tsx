import { useEffect, useState, useSyncExternalStore } from 'react'
import { errorStringField } from '@workspace/contracts'
import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  WorktreeId,
} from '@workspace/contracts'
import type { ChatOwner } from '@workspace/client-core/chat/owner'
import { cleanupStatusLabel } from '@workspace/client-core/chat/worktrees/cleanup'
import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { Spinner } from '@/components/spinner'
import type { SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'
import { WorktreeChip } from '@/worktrees/components/chip'
import { WorktreeCleanupDialog } from '@/worktrees/components/cleanup-dialog'
import { WorktreeDescription } from '@/worktrees/components/description'
import { createWorktreeActions } from '@/worktrees/state/actions'
import {
  openableWorktree,
  selectableWorktree,
  worktreeActions,
  worktreeFailure,
} from '@/worktrees/utils/choices'

export function WorktreeDetails({
  session,
  chat,
  project,
  worktree,
  currentWorktreeId,
  theme,
  onClose,
  onSelectWorktree,
  onOpenWorkbench,
}: {
  readonly session: SettingsSession
  readonly chat: ChatOwner
  readonly project: OrchestrationProjectShell
  readonly worktree: OrchestrationWorktreeShell
  readonly currentWorktreeId: WorktreeId | null
  readonly theme: Theme
  readonly onClose: () => void
  readonly onSelectWorktree?: (id: WorktreeId) => void
  readonly onOpenWorkbench?: (path: string) => void | Promise<void>
}) {
  const commands = useCommands()
  const [store] = useState(() =>
    createWorktreeActions({ session, chat, worktreeId: worktree.id, currentWorktreeId }),
  )
  const actions = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selected, setSelected] = useState(0)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const pending = actions.pending || opening
  const current = worktree.id === currentWorktreeId
  const options = worktreeActions(worktree, current).map((action) => ({
    ...action,
    value: () => {
      void store.request(action.value)
    },
  }))
  if (onOpenWorkbench && openableWorktree(worktree))
    options.unshift({
      name: 'Open checkout',
      description: 'Open files and Git in this checkout',
      value: () => {
        void openWorkbench()
      },
    })
  if (onSelectWorktree && selectableWorktree(worktree))
    options.unshift({
      name: 'New session here',
      description: 'Start a draft in this checkout',
      value: () => onSelectWorktree(worktree.id),
    })
  useEffect(() => () => store.dispose(), [store])
  async function openWorkbench() {
    if (!onOpenWorkbench || pending) return
    setOpening(true)
    setOpenError(null)
    try {
      await onOpenWorkbench(worktree.path)
    } catch (error) {
      setOpenError(errorStringField(error, 'message') ?? 'The checkout could not be opened.')
    } finally {
      setOpening(false)
    }
  }
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'worktree-actions',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      available: actions.confirmation === null,
      focus: () => true,
    },
    actions.confirmation === null,
  )
  if (actions.confirmation)
    return (
      <WorktreeCleanupDialog
        confirmation={actions.confirmation}
        label={worktreeLabel(worktree, project.repositoryKind)}
        pending={actions.pending}
        error={actions.error}
        theme={theme}
        onCancel={() => store.dismiss()}
        onConfirm={() => {
          void store.confirm()
        }}
      />
    )
  return (
    <Dialog
      title='Worktree actions'
      theme={theme}
      width={92}
      height={28}
      footer='PgUp/PgDn details'
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <WorktreeDescription owner='worktree-actions'>
        <WorktreeChip worktree={worktree} repositoryKind={project.repositoryKind} theme={theme} />
        <text fg={theme.mutedForeground} wrapMode='char'>
          {worktree.canonicalPath}
        </text>
        <text fg={theme.mutedForeground}>{cleanupStatusLabel(worktree)}</text>
        {current && (
          <text fg={theme.warning}>
            Current checkout. Switch to another checkout before cleanup.
          </text>
        )}
        {worktreeFailure(worktree) && (
          <text fg={theme.destructive}>{worktreeFailure(worktree)}</text>
        )}
        {actions.error && <text fg={theme.destructive}>{actions.error}</text>}
        {openError && <text fg={theme.destructive}>{openError}</text>}
        {pending && <Spinner theme={theme} />}
      </WorktreeDescription>
      <Select
        id='worktree-actions'
        options={options}
        selectedIndex={Math.min(selected, Math.max(0, options.length - 1))}
        onChange={setSelected}
        onSelect={(index) => {
          if (!pending) options[index]?.value()
        }}
        focused
        flexGrow={1}
        flexBasis={0}
        minHeight={2}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
      {options.length === 0 && <text fg={theme.mutedForeground}>No actions available.</text>}
    </Dialog>
  )
}
