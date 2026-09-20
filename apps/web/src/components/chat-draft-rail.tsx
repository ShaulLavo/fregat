import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@workspace/ui/components/tooltip'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { EnvironmentId } from '@workspace/contracts'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'
import { toast } from 'sonner'
import { useNavigation } from '@/hooks/use-navigation'
import { errorMessage } from '@/lib/error-message'
import { createClientInvariantError } from '@/lib/structured-errors'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import {
  useChatInputDraftStore,
  discardRecoverableDraft,
} from '@/features/chat/state/chat-input-draft-store'
import {
  recoverableDraftRows,
  type RecoverableDraftRow,
} from '@/features/chat/utils/recoverable-drafts'
import { releaseUnusedDraftAttachments } from '@/features/chat/state/stash-transfer'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

export function ChatDraftRail({
  projects,
  scope,
  machineFilter,
  query,
  archived,
}: {
  projects: readonly SessionRailProject[]
  scope: string | null
  machineFilter: EnvironmentId | null
  query: string
  archived: boolean
}) {
  const navigation = useNavigation()
  const drafts = useChatInputDraftStore((state) => state.draftsByKey)
  const selection = useSessionSelectionStore((state) => state.selection)
  const selected =
    selection.kind === 'draft' && selection.draftId
      ? `${selection.environmentId}:${selection.draftId}`
      : null
  const owners = projects.flatMap((project) =>
    project.members.map((member) => member.ref.environmentId),
  )
  const rows = recoverableDraftRows(drafts, owners)
  const [snapshot, setSnapshot] = useState<{
    selected: string | null
    row: RecoverableDraftRow | null
  }>({
    selected,
    row:
      rows.find(
        (row) =>
          `${row.target.environmentId}:${row.identity.id}` === selected &&
          selection.kind === 'draft' &&
          row.target.environmentId === selection.environmentId,
      ) ?? null,
  })
  const frozen =
    snapshot.selected === selected
      ? snapshot.row
      : (rows.find(
          (row) =>
            `${row.target.environmentId}:${row.identity.id}` === selected &&
            selection.kind === 'draft' &&
            row.target.environmentId === selection.environmentId,
        ) ?? null)
  if (snapshot.selected !== selected) setSnapshot({ selected, row: frozen })
  const visible = rows
    .filter((row) => `${row.target.environmentId}:${row.identity.id}` !== selected)
    .concat(frozen && drafts[frozen.key]?.identity ? [frozen] : [])
    .filter((row) => {
      if (machineFilter && row.target.environmentId !== machineFilter) return false
      const project = projects.find((project) =>
        project.members.some(
          (member) =>
            member.ref.environmentId === row.target.environmentId &&
            member.ref.projectId === row.identity.projectId,
        ),
      )
      if (!project || (scope && scope !== project.groupKey)) return false
      return !query.trim() || row.label.toLowerCase().includes(query.trim().toLowerCase())
    })
    .toSorted(
      (a, b) =>
        b.identity.createdAt.localeCompare(a.identity.createdAt) || a.key.localeCompare(b.key),
    )
  const [active, setActive] = useState<string | null>(null)
  const open = useMutation({
    mutationKey: chatMutationKeys.draftRecovery('open'),
    scope: { id: 'draft-recovery-navigation' },
    mutationFn: async (row: RecoverableDraftRow) => {
      const result = await navigation.openChat({
        environmentId: row.target.environmentId,
        projectId: row.identity.projectId,
        worktreeId: row.identity.baseWorktreeId,
        draftId: row.identity.id,
        sessionId: null,
        surface: 'main',
      })
      if (result.status === 'unavailable') throw createClientInvariantError(result.reason)
      return result
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not open this draft.')),
  })
  const discard = useMutation({
    mutationKey: chatMutationKeys.draftRecovery('discard'),
    scope: { id: 'draft-recovery-discard' },
    mutationFn: async (row: RecoverableDraftRow) => {
      const attachments = discardRecoverableDraft(row.target)
      if (!attachments)
        throw createClientInvariantError('Could not save draft removal. The draft was kept.')
      await releaseUnusedDraftAttachments(row.target.environmentId, attachments)
      const current = useSessionSelectionStore.getState().selection
      if (
        current.kind === 'draft' &&
        current.environmentId === row.target.environmentId &&
        current.draftId === row.identity.id
      )
        await navigation.startDraft(
          { environmentId: row.target.environmentId, projectId: row.identity.projectId },
          row.identity.baseWorktreeId,
        )
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not discard this draft.')),
  })
  const list = useListbox({
    role: 'listbox',
    items: visible.map((row) => ({ id: row.key, label: row.label })),
    activeId: active,
    onActiveChange: setActive,
    onCommit: (key) => {
      const row = visible.find((item) => item.key === key)
      if (row) open.mutate(row)
    },
  })
  if (archived || visible.length === 0) return null
  return (
    <section aria-label='Recoverable drafts' className='max-h-48 shrink-0 overflow-y-auto px-1'>
      <p className='text-muted-foreground text-2xs px-2 py-1'>Drafts</p>
      <div
        {...list.containerProps}
        aria-label='Drafts'
        onKeyDown={(event) => {
          event.stopPropagation()
          list.containerProps.onKeyDown(event)
        }}
      >
        {visible.map((row) => (
          <ListRow
            role='option'
            key={row.key}
            {...list.rowProps(row.key)}
            onClick={(event) => {
              list.rowProps(row.key).onClick(event)
              open.mutate(row)
            }}
            title={`${row.label}\n${row.identity.rootPath}`}
            selected={`${row.target.environmentId}:${row.identity.id}` === selected}
          >
            <PencilSimpleIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
            <span className='min-w-0 flex-1 truncate text-xs'>{row.label}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Discard draft: ${row.label}`}
                    variant='ghost'
                    size='icon-sm'
                    onClick={(event) => {
                      event.stopPropagation()
                      discard.mutate(row)
                    }}
                  >
                    <XIcon className='size-(--icon-size-sm)' />
                  </Button>
                }
              />
              <TooltipContent>Discard draft</TooltipContent>
            </Tooltip>
          </ListRow>
        ))}
      </div>
    </section>
  )
}
