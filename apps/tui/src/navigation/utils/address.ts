import {
  chatReferenceForToken,
  tokenForChatReference,
} from '@workspace/client-core/address/references'
import { readChatShell } from '@workspace/client-core/chat/snapshots'
import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'
import type { AgentLocation } from '@/agent/utils/target'
import { selectedWorktree } from '@/agent/utils/selection'
import {
  emptyAddress,
  formatAddress,
  parseAddress,
  SETTINGS_DOCUMENT_TOKEN,
} from '@workspace/client-core/address/grammar'
import { decodePath, encodePath } from '@workspace/client-core/address/path-token'
import {
  NO_WORKSPACE_TOKEN,
  parseWorkspaceToken,
  workspaceToken,
} from '@workspace/client-core/address/workspace'
import { toWorkspaceRelative } from '@workspace/client-core/files/path'
import { readServerPaths } from '@workspace/client-core/files/read'
import {
  readWorkspaceAddress,
  registerWorkspaceAddress,
} from '@workspace/client-core/files/workspace-address'
import { relativePickerPath } from '@workspace/client-core/files/path-input'
import { createTuiError } from '@/host/utils/structured-errors'
import type { Client } from '@workspace/client-core/transport/client'
import type { EnvironmentId } from '@workspace/contracts'
import type { WorkbenchLocation } from '@/workbench/utils/location'
import type { Location } from '@/navigation/state/history'

type AddressConnection = { readonly client: Client; readonly signal: AbortSignal }

export async function locationAddress(
  environmentId: EnvironmentId,
  location: Location,
  connection: AddressConnection,
  projection?: ChatProjectionSlice,
) {
  if (location.kind === 'agent')
    return agentAddress(environmentId, location, connection, projection)
  if (location.kind === 'settings') return settingsAddress(environmentId, location.query)
  if (location.kind === 'files')
    return fileAddress(environmentId, location.path, location.rootPath, connection)
  return workbenchAddress(environmentId, location, connection)
}

export async function agentAddress(
  environmentId: EnvironmentId,
  location: AgentLocation,
  connection: AddressConnection,
  projection?: ChatProjectionSlice,
) {
  const worktree = projection ? selectedWorktree(projection, location) : null
  if (!worktree && (location.worktreeId || location.sessionId))
    throw createTuiError(
      'This checkout is unavailable.',
      'Select an available checkout before copying its address.',
    )
  const workspace = worktree ? await registerRoot(connection, worktree.path) : null
  return formatAddress({
    ...emptyAddress(),
    environmentId,
    mode: 'chat',
    workspace: workspace ? workspaceToken(workspace) : NO_WORKSPACE_TOKEN,
    document: tokenForChatReference(
      location.sessionId ? { kind: 'session', sessionId: location.sessionId } : { kind: 'draft' },
    ),
  })
}

export async function workbenchAddress(
  environmentId: EnvironmentId,
  location: WorkbenchLocation,
  connection: AddressConnection,
) {
  const relative = location.path ? toWorkspaceRelative(location.rootPath, location.path) : null
  const workspace = await registerRoot(connection, location.rootPath)
  const bottom = location.pane === 'terminal' || location.pane === 'problems' ? location.pane : null
  const side =
    location.pane === 'terminal' || location.pane === 'problems' ? 'files' : location.pane
  return formatAddress({
    ...emptyAddress(),
    environmentId,
    mode: 'workbench',
    workspace: workspaceToken(workspace),
    side,
    bottom,
    document: relative && relative !== '.' ? `f/${encodePath(relative)}` : null,
    focus: location.line ? { line: location.line, column: null, endLine: null } : null,
  })
}

export function settingsAddress(environmentId: EnvironmentId, query = '') {
  return formatAddress({
    ...emptyAddress(),
    environmentId,
    workspace: NO_WORKSPACE_TOKEN,
    mode: 'workbench',
    document: SETTINGS_DOCUMENT_TOKEN,
    settings: query,
  })
}

export async function fileAddress(
  environmentId: EnvironmentId,
  path: string,
  defaultPath: string,
  connection: AddressConnection,
) {
  const preferred = toWorkspaceRelative(defaultPath, path)
  const root = preferred === null ? '' : defaultPath
  const relative = preferred ?? toWorkspaceRelative(root, path)
  if (relative === null) return null
  const workspace = await registerRoot(connection, root)
  return formatAddress({
    ...emptyAddress(),
    environmentId,
    mode: 'workbench',
    side: 'files',
    workspace: workspaceToken(workspace),
    document: relative === '.' ? null : `f/${encodePath(relative)}`,
  })
}

export async function resolveAddress(
  input: string,
  client: Client,
  environmentId: EnvironmentId,
  signal: AbortSignal,
) {
  const address = parseAddress(input, {
    knownEnvironmentIds: [environmentId],
    primaryEnvironmentId: environmentId,
  })
  if (address.rejectedEnvironment !== null)
    return {
      kind: 'failed',
      message: 'This address belongs to a different or unknown environment.',
    } as const
  if (address.workspace && parseWorkspaceToken(address.workspace).kind === 'invalid')
    return {
      kind: 'failed',
      message: 'This address contains an invalid workspace identity.',
    } as const
  if (address.mode === 'chat') return resolveAgentAddress(address, client, signal)
  if (address.mode === 'workbench' && address.document === SETTINGS_DOCUMENT_TOKEN)
    return { kind: 'settings', query: address.settings ?? '' } as const
  if (
    address.mode !== 'workbench' ||
    !address.workspace ||
    (address.document !== null && !address.document.startsWith('f/'))
  ) {
    return {
      kind: 'failed',
      message: 'Open a chat, settings, or workbench address.',
    } as const
  }
  const token = parseWorkspaceToken(address.workspace)
  if (token.kind !== 'workspace')
    return { kind: 'failed', message: 'This address does not identify a workspace.' } as const
  const root = await readWorkspaceAddress({ client, signal, id: token.id })
  const path =
    address.document === null
      ? undefined
      : decodePath(root.path, address.document.split('/').slice(1))
  if (path === null)
    return { kind: 'failed', message: 'The file address contains an invalid path.' } as const
  const side =
    address.side === 'git' || address.side === 'search' || address.side === 'logs'
      ? address.side
      : 'files'
  return {
    kind: 'workbench',
    rootPath: root.path,
    path,
    pane: address.bottom ?? side,
    line: address.focus?.line,
  } satisfies WorkbenchLocation
}

async function resolveAgentAddress(
  address: ReturnType<typeof parseAddress>,
  client: Client,
  signal: AbortSignal,
) {
  const selection = chatReferenceForToken(address.document ?? 't/new')
  if (!selection)
    return { kind: 'failed', message: 'This address does not identify a chat session.' } as const
  const snapshot = await readChatShell(client, signal)
  if (selection.kind === 'session') {
    const session = snapshot.sessions.find((item) => item.id === selection.sessionId)
    if (!session)
      return {
        kind: 'failed',
        message: 'This chat session is unavailable on this server.',
      } as const
    const worktree = snapshot.worktrees.find((item) => item.id === session.worktreeId)
    if (!worktree)
      return { kind: 'failed', message: 'The session worktree is unavailable.' } as const
    return {
      kind: 'agent',
      sessionId: session.id,
      projectId: worktree.projectId,
    } satisfies AgentLocation
  }
  if (!address.workspace || address.workspace === NO_WORKSPACE_TOKEN)
    return { kind: 'agent', sessionId: null, projectId: null } satisfies AgentLocation
  const workspace = parseWorkspaceToken(address.workspace)
  if (workspace.kind !== 'workspace')
    return { kind: 'failed', message: 'This address does not identify a workspace.' } as const
  const root = await readWorkspaceAddress({ client, signal, id: workspace.id })
  const paths = await readServerPaths({ client, signal })
  const matches = snapshot.worktrees.filter((item) => {
    if (item.lifecycle.state === 'removed' || item.lifecycle.state === 'retired') return false
    const path = item.path.startsWith('/')
      ? relativePickerPath(item.path, paths.workspaceRoot)
      : item.path
    return path === root.path
  })
  const [worktree] = matches
  if (!worktree || matches.length !== 1)
    return {
      kind: 'failed',
      message: 'The project in this address is unknown or ambiguous.',
    } as const
  return {
    kind: 'agent',
    sessionId: null,
    projectId: worktree.projectId,
    worktreeId: worktree.id,
  } satisfies AgentLocation
}

async function registerRoot(connection: AddressConnection, rootPath: string) {
  if (!rootPath.startsWith('/')) return registerWorkspaceAddress({ ...connection, path: rootPath })
  const paths = await readServerPaths(connection)
  const path = relativePickerPath(rootPath, paths.workspaceRoot)
  if (path === null)
    throw createTuiError(
      'That folder is outside the available file system.',
      'Choose a folder available on this server.',
    )
  return registerWorkspaceAddress({ ...connection, path })
}
