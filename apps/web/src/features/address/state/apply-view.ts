import { editorDocumentToken, emptyAddress } from '@workspace/client-core/address/grammar'
import { retainedTextBudgetFromSettings } from '@/features/editor/utils/retained-text-budget'
import { NO_WORKSPACE_TOKEN, parseWorkspaceToken } from '@workspace/client-core/address/workspace'
import { readWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { errorStringField, type EnvironmentId, type WorktreeId } from '@workspace/contracts'
import {
  applyAddressChat,
  needsChatSnapshot,
  prepareAddressChat,
} from '@/features/address/state/apply-view-chat'
import { applyAddressEditors } from '@/features/address/state/apply-view-editors'
import { applyAddressFields } from '@/features/address/state/apply-view-fields'
import { contentForDocumentToken } from '@/features/address/utils/document-token'
import { addressEnvironments } from '@/features/address/utils/environments'
import type { AddressIntent } from '@/features/address/utils/intent'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { createEditorApplyActions } from '@/features/editor/state/apply-actions'
import { activateWorkspaceRoot } from '@/features/workspace/state/active-project'
import type { Client } from '@/lib/client'
import { log } from '@/lib/client-logging'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { errorMessage } from '@/lib/error-message'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { intentForAddress } from '@/features/address/utils/intent'
import { toast } from 'sonner'

export type AddressApplyReason = 'boot' | 'traverse' | 'navigate'
export type AddressApplyResult =
  | { readonly status: 'applied'; readonly reason: AddressApplyReason }
  | { readonly status: 'unavailable' | 'superseded'; readonly reason: string }

type ApplyOptions = {
  readonly application: ApplicationRuntime
  readonly address: AddressIntent
  readonly reason: AddressApplyReason
  readonly isCurrent: () => boolean
  readonly signal?: AbortSignal
  readonly commitEditorState?: (owner: EditorWorkspaceStoreApi) => boolean
  readonly preserveTransient?: boolean
  readonly draftWorktreeId?: WorktreeId
  readonly reconcileResources?: (owner: EditorWorkspaceStoreApi, rootPath: string | null) => void
}

type ApplyTrace = {
  workspaceSource: 'cache' | 'server' | 'session' | null
  workspaceId: string | null
  rejectedTabs: string | null
}

export async function applyAddressView(options: ApplyOptions): Promise<AddressApplyResult> {
  const trace: ApplyTrace = { workspaceSource: null, workspaceId: null, rejectedTabs: null }
  let result: AddressApplyResult
  try {
    result = await applyCurrentView(options, trace)
  } catch (error) {
    result =
      options.isCurrent() && !options.signal?.aborted
        ? {
            status: 'unavailable',
            reason: errorMessage(error, 'The address could not be restored.'),
          }
        : superseded()
  }
  log.info({
    action: 'address.restored',
    area: 'address',
    applyReason: options.reason,
    reason: result.reason,
    status: result.status,
    ...trace,
  })
  return result
}

async function applyCurrentView(
  options: ApplyOptions,
  trace: ApplyTrace,
): Promise<AddressApplyResult> {
  const { application, address: intent, reason } = options
  if (!options.isCurrent() || options.signal?.aborted) return superseded()
  if (intent.unavailable) return { status: 'unavailable', reason: intent.unavailable }
  const address = intent.address
  if (address.rejectedEnvironment !== null)
    return { status: 'unavailable', reason: 'The addressed environment is unavailable.' }
  const environments = addressEnvironments(useEnvironmentsStore.getState().entries)
  const environmentId = address.environmentId ?? environments.primaryEnvironmentId
  if (!environmentId)
    return { status: 'unavailable', reason: 'The machine identity is unconfirmed.' }
  application.activateEnvironment(confirmedEnvironmentOrigin(environmentId))
  const owner = application.getSnapshot()
  const activity = environmentActivitySignal(owner.origin)
  const signal = options.signal ? AbortSignal.any([activity, options.signal]) : activity
  const current = () =>
    options.isCurrent() && !signal.aborted && application.getSnapshot() === owner
  if (!current()) return superseded()
  if (!address.workspace) return { status: 'applied', reason }
  if (address.workspace === NO_WORKSPACE_TOKEN) return applyFolderless(options, owner, trace)

  const client = clientForQueryClient(owner.queryClient)
  const addressedRoot = await resolveRoot(address.workspace, owner, trace, client, signal)
  if (!current()) return superseded()
  confirmedEnvironmentId(owner.origin)
  if (addressedRoot === UNKNOWN_ROOT) return landOnStart(options, owner, trace)
  if (addressedRoot === null)
    return { status: 'unavailable', reason: 'The link does not contain a valid workspace ID.' }

  if (needsChatSnapshot(intent, environmentId, addressedRoot)) {
    const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
    if (!current()) return superseded()
    confirmedEnvironmentId(owner.origin)
    useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
  }
  const currentRootPath = owner.editor.workspaceStore.getState().rootFolder?.path
  const chat = prepareAddressChat(
    intent,
    environmentId,
    addressedRoot,
    options.draftWorktreeId,
    currentRootPath === addressedRoot,
  )
  if (chat.kind === 'unavailable') return { status: 'unavailable', reason: chat.reason }
  if (chat.rootPath !== addressedRoot) trace.workspaceSource = 'session'
  options.reconcileResources?.(owner.editor.workspaceStore, chat.rootPath)
  if (!current()) return superseded()
  const rejectedDocument = documentFailure(intent, chat.rootPath)
  if (rejectedDocument) return { status: 'unavailable', reason: rejectedDocument }
  const opened = await openRoot(options, owner, environmentId, chat.rootPath, current, signal)
  if (!current() || opened === 'superseded') return superseded()
  if (opened === 'failed')
    return { status: 'unavailable', reason: 'The workspace root failed to open.' }
  confirmedEnvironmentId(owner.origin)
  const rootPath = owner.editor.workspaceStore.getState().rootFolder?.path ?? chat.rootPath
  options.reconcileResources?.(owner.editor.workspaceStore, rootPath)
  if (!current()) return superseded()
  if (chat.worktreeId)
    owner.editor.workspaceStore.getState().bindWorktrees([{ id: chat.worktreeId, path: rootPath }])
  if (!applyOwnedView(options, owner, rootPath, trace)) return superseded()
  applyAddressChat(intent, chat, reason)
  return { status: 'applied', reason }
}

async function resolveRoot(
  token: string,
  owner: ReturnType<ApplicationRuntime['getSnapshot']>,
  trace: ApplyTrace,
  client: Client,
  signal: AbortSignal,
) {
  const parsed = parseWorkspaceToken(token)
  if (parsed.kind !== 'workspace') return null
  trace.workspaceId = parsed.id
  const root = owner.editor.workspaceStore.getState().rootFolder
  if (root?.workspaceAddress?.id === parsed.id) {
    trace.workspaceSource = 'cache'
    return root.path
  }
  trace.workspaceSource = 'server'
  try {
    const workspace = await readWorkspaceAddress({ client, id: parsed.id, signal })
    return workspace.path
  } catch (error) {
    if (errorStringField(error, 'code') === 'WORKSPACE_ADDRESS_NOT_FOUND') return UNKNOWN_ROOT
    throw error
  }
}

const UNKNOWN_ROOT = Symbol('unknown workspace address')

/** A link minted by another database: open the start page, keeping only the view mode. */
function landOnStart(
  options: ApplyOptions,
  owner: ReturnType<ApplicationRuntime['getSnapshot']>,
  trace: ApplyTrace,
): AddressApplyResult {
  const { address } = options.address
  const start = intentForAddress({
    ...emptyAddress(),
    environmentId: address.environmentId,
    mode: address.mode,
    passthrough: address.passthrough,
    workspace: NO_WORKSPACE_TOKEN,
  })
  const result = applyFolderless({ ...options, address: start }, owner, trace)
  if (result.status !== 'applied') return result
  toast.info('Workspace link not found', {
    description: 'This server has no workspace for that link. Open a folder to continue.',
  })
  return result
}

function openRoot(
  options: ApplyOptions,
  owner: ReturnType<ApplicationRuntime['getSnapshot']>,
  environmentId: EnvironmentId,
  rootPath: string,
  isCurrent: () => boolean,
  signal: AbortSignal,
) {
  if (owner.editor.workspaceStore.getState().rootFolder?.path === rootPath) return 'already-open'
  return options.application.openEnvironmentWorkspaceRoot(environmentId, rootPath, {
    isCurrent,
    signal,
  })
}

function documentFailure(intent: AddressIntent, rootPath: string | null) {
  const token = editorDocumentToken(intent.address)
  if (!token) return null
  const parsed = contentForDocumentToken(rootPath, token)
  return parsed.kind === 'content' ? null : parsed.reason
}

function applyFolderless(
  options: ApplyOptions,
  owner: ReturnType<ApplicationRuntime['getSnapshot']>,
  trace: ApplyTrace,
): AddressApplyResult {
  if (options.address.mainChat || options.address.sidebarChat)
    return { status: 'unavailable', reason: 'A conversation requires a workspace.' }
  const rejectedDocument = documentFailure(options.address, null)
  if (rejectedDocument) return { status: 'unavailable', reason: rejectedDocument }
  const editor = owner.editor
  options.reconcileResources?.(editor.workspaceStore, null)
  if (!options.isCurrent()) return superseded()
  if (editor.workspaceStore.getState().rootFolder) {
    createEditorApplyActions({
      retainedTextBudget: retainedTextBudgetFromSettings,
      activation: editor.editorActivation,
      documentStore: editor.documentStore,
      searchStore: editor.searchBufferStore,
      uiStore: editor.uiStore,
      workspaceStore: editor.workspaceStore,
    }).clearRootFolder()
    activateWorkspaceRoot(null)
  }
  if (!applyOwnedView(options, owner, null, trace)) return superseded()
  applyAddressChat(options.address, null, options.reason)
  return { status: 'applied', reason: options.reason }
}

function applyOwnedView(
  options: ApplyOptions,
  owner: ReturnType<ApplicationRuntime['getSnapshot']>,
  rootPath: string | null,
  trace: ApplyTrace,
) {
  const editor = owner.editor
  const commands = createEditorApplyActions({
    retainedTextBudget: retainedTextBudgetFromSettings,
    activation: editor.editorActivation,
    documentStore: editor.documentStore,
    searchStore: editor.searchBufferStore,
    uiStore: editor.uiStore,
    workspaceStore: editor.workspaceStore,
  })
  if (options.commitEditorState && !options.commitEditorState(editor.workspaceStore)) return false
  if (!options.commitEditorState)
    trace.rejectedTabs = applyAddressEditors({
      address: options.address.address,
      commands,
      documentStore: editor.documentStore,
      workspaceStore: editor.workspaceStore,
      uiStore: editor.uiStore,
      rootPath,
      reason: options.reason,
      preserveTransient: options.preserveTransient ?? false,
      complete: options.address.source === 'command',
    })
  applyAddressFields({
    address: options.address.address,
    workspaceStore: editor.workspaceStore,
    searchStore: editor.searchBufferStore,
    rootPath,
    reason: options.reason,
  })
  return true
}

function superseded(): AddressApplyResult {
  return { status: 'superseded', reason: 'A newer navigation owns the application.' }
}
