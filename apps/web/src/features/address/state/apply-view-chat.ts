import { selectSessionOwnership, selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import type { EnvironmentId, WorktreeId } from '@workspace/contracts'
import type { AddressIntent } from '@/features/address/utils/intent'
import type { AddressApplyReason } from '@/features/address/state/apply-view'
import { diffScopeFor } from '@/features/address/utils/diff-scope'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import {
  useSidebarSelectionStore,
  type SidebarSelection,
} from '@/features/chat/state/sidebar-selection-store'
import { DEFAULT_SESSION_DIFF_SCOPE } from '@/features/chat/utils/session-diff-scope-storage'

type PreparedChat = {
  readonly kind: 'ready'
  readonly rootPath: string
  readonly worktreeId: WorktreeId | null
  readonly draftWorktreeId: WorktreeId | null
  readonly main: SidebarSelection | null
  readonly sidebar: SidebarSelection | null
}

export function needsChatSnapshot(
  intent: AddressIntent,
  environmentId: EnvironmentId,
  rootPath: string,
) {
  if (!intent.mainChat && !intent.sidebarChat) return false
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  if (!selectWorktreeAtPath(slice, rootPath)) return true
  const refs = [intent.mainChat, intent.sidebarChat]
  return refs.some(
    (ref) => ref?.kind === 'session' && !selectSessionOwnership(slice, ref.sessionId),
  )
}

export function prepareAddressChat(
  intent: AddressIntent,
  environmentId: EnvironmentId,
  rootPath: string,
  draftWorktreeId?: WorktreeId,
  preserveCurrentDraft = false,
): PreparedChat | { readonly kind: 'unavailable'; readonly reason: string } {
  if (!intent.mainChat && !intent.sidebarChat)
    return {
      kind: 'ready',
      rootPath,
      worktreeId: null,
      draftWorktreeId: null,
      main: null,
      sidebar: null,
    }
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  const addressed = selectWorktreeAtPath(slice, rootPath)
  if (!addressed)
    return { kind: 'unavailable', reason: 'The addressed workspace has no chat project.' }
  const main = scopedSelection(intent.mainChat, environmentId, addressed.projectId)
  const sidebar = scopedSelection(intent.sidebarChat, environmentId, addressed.projectId)
  const mainOwner =
    intent.mainChat?.kind === 'session'
      ? selectSessionOwnership(slice, intent.mainChat.sessionId)
      : null
  if (main?.kind === 'session' && mainOwner?.project.id !== addressed.projectId)
    return {
      kind: 'unavailable',
      reason: 'The conversation does not belong to this workspace project.',
    }
  if (sidebar?.kind === 'session') {
    const owner = selectSessionOwnership(slice, sidebar.sessionId)
    if (owner?.project.id !== addressed.projectId)
      return {
        kind: 'unavailable',
        reason: 'The sidebar conversation does not belong to this workspace project.',
      }
  }
  const sessionWorktree =
    mainOwner?.worktree.lifecycle.state === 'ready' ? mainOwner.worktree : null
  return {
    kind: 'ready',
    rootPath: sessionWorktree?.path ?? rootPath,
    worktreeId: sessionWorktree?.id ?? addressed.id,
    draftWorktreeId: resolveDraftWorktreeId(
      main,
      addressed.id,
      draftWorktreeId,
      preserveCurrentDraft,
    ),
    main,
    sidebar,
  }
}

function resolveDraftWorktreeId(
  selection: SidebarSelection | null,
  addressedWorktreeId: WorktreeId,
  requestedWorktreeId: WorktreeId | undefined,
  preserveCurrentDraft: boolean,
) {
  if (selection?.kind !== 'draft') return null
  if (requestedWorktreeId !== undefined) return requestedWorktreeId
  if (!preserveCurrentDraft) return addressedWorktreeId

  const current = useSessionSelectionStore.getState()
  if (current.selection.kind !== 'draft') return addressedWorktreeId
  if (current.selection.environmentId !== selection.environmentId) return addressedWorktreeId
  if (current.selection.projectId !== selection.projectId) return addressedWorktreeId
  return current.draftWorktreeId ?? addressedWorktreeId
}

function scopedSelection(
  ref: AddressIntent['mainChat'],
  environmentId: EnvironmentId,
  projectId: Extract<SidebarSelection, { kind: 'draft' }>['projectId'],
): SidebarSelection | null {
  if (!ref) return null
  if (ref.kind === 'draft')
    return { kind: 'draft', environmentId, projectId, draftId: ref.draftId ?? crypto.randomUUID() }
  return { kind: 'session', environmentId, projectId, sessionId: ref.sessionId }
}

export function applyAddressChat(
  intent: AddressIntent,
  prepared: PreparedChat | null,
  reason: AddressApplyReason,
) {
  const main = prepared?.main
  if (main) applyMainSelection(main, prepared?.draftWorktreeId ?? null)
  if (!main && intent.address.mode === 'chat' && reason !== 'boot')
    useSessionSelectionStore.setState({
      restored: false,
      selection: { kind: 'auto' },
      draftWorktreeId: null,
    })
  if (prepared?.sidebar) useSidebarSelectionStore.getState().restoreSelection(prepared.sidebar)
  if (main?.kind !== 'session') return
  const scope =
    diffScopeFor(intent.address.diff) ?? (reason !== 'boot' ? DEFAULT_SESSION_DIFF_SCOPE : null)
  if (!scope) return
  useSessionDiffScopeStore
    .getState()
    .selectSessionDiffScope({ environmentId: main.environmentId, sessionId: main.sessionId }, scope)
}

function applyMainSelection(selection: SidebarSelection, worktreeId: WorktreeId | null) {
  if (selection.kind === 'auto') return
  const state = useSessionSelectionStore.getState()
  if (selection.kind === 'session') {
    state.restoreSession(selection.environmentId, selection.projectId, selection.sessionId)
    return
  }
  const current = state.selection
  if (
    current.kind === 'draft' &&
    current.environmentId === selection.environmentId &&
    current.projectId === selection.projectId &&
    current.draftId === selection.draftId &&
    state.draftWorktreeId === worktreeId
  )
    return
  state.startDraft(
    selection.environmentId,
    selection.projectId,
    worktreeId ?? undefined,
    selection.draftId,
  )
}
