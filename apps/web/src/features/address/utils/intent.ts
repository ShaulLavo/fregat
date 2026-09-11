import {
  editorDocumentToken,
  parseAddress,
  type Address,
  type AddressEnvironments,
} from '@workspace/client-core/address/grammar'
import {
  chatReferenceForToken,
  editorReferenceForToken,
  tokenForEditorReference,
  type ChatReference,
  type EditorReference,
} from '@workspace/client-core/address/references'
import { parseWorkspaceToken } from '@workspace/client-core/address/workspace'

export {
  chatReferenceForToken,
  chatReferenceSchema,
  editorReferenceForToken,
  editorReferenceSchema,
  tokenForChatReference,
  tokenForEditorReference,
  type ChatReference,
  type EditorReference,
} from '@workspace/client-core/address/references'

export type AddressIntent = {
  readonly source: 'incoming' | 'command'
  readonly address: Address
  readonly editor: EditorReference | null
  readonly mainChat: ChatReference | null
  readonly sidebarChat: ChatReference | null
  readonly tabs: readonly EditorReference[] | null
  readonly unavailable: string | null
}

export function parseAddressIntent(href: string, environments?: AddressEnvironments) {
  return intentForAddress(parseAddress(href, environments))
}

export function resolveIntentEnvironment(
  intent: AddressIntent,
  environments: AddressEnvironments,
): AddressIntent {
  const requestedId = intent.address.environmentId ?? intent.address.rejectedEnvironment
  if (requestedId === null) return intent
  const knownId = environments.knownEnvironmentIds.find((id) => id === requestedId)
  return intentForAddress(
    {
      ...intent.address,
      environmentId: knownId && knownId !== environments.primaryEnvironmentId ? knownId : null,
      rejectedEnvironment: knownId ? null : requestedId,
    },
    { complete: intent.source === 'command' },
  )
}

export function intentForAddress(
  input: Address,
  options: { readonly complete?: boolean } = {},
): AddressIntent {
  const selected = editorDocumentToken(input)
  const editor = editorReferenceForToken(selected)
  const mainChat = input.mode === 'chat' ? chatReferenceForToken(input.document) : null
  const sidebarChat = input.side === 'chat' ? chatReferenceForToken(input.chat) : null
  const tabs = referencesForTabs(input.tabs)
  const address: Address = {
    ...input,
    editor: input.mode === 'chat' && editor ? tokenForEditorReference(editor) : null,
    chat: sidebarChat ? input.chat : null,
    tabs: tabs?.map(tokenForEditorReference) ?? null,
    search: validSearchParams(input.search),
    logs: validLogParams(input.logs),
  }
  return {
    source: options.complete ? 'command' : 'incoming',
    address,
    editor,
    mainChat,
    sidebarChat,
    tabs,
    unavailable: unavailableReason(input, editor, mainChat),
  }
}

function referencesForTabs(tokens: readonly string[] | null) {
  if (tokens === null) return null
  const references = tokens.map(editorReferenceForToken)
  if (
    references.some(
      (reference) =>
        reference === null || (reference.kind === 'snapshot' && reference.source === 'branch'),
    )
  )
    return null
  return references.filter((reference) => reference !== null)
}

function unavailableReason(
  address: Address,
  editor: EditorReference | null,
  mainChat: ChatReference | null,
) {
  if (address.rejectedEnvironment !== null) return 'This environment is unavailable.'
  if (address.workspace && parseWorkspaceToken(address.workspace).kind === 'invalid')
    return 'This workspace address is invalid.'
  if (address.mode === 'chat' && address.document && !mainChat)
    return 'This chat address is invalid.'
  if (address.mode === 'workbench' && address.document && !editor)
    return 'This editor address is invalid.'
  if (editor?.kind === 'snapshot' && editor.source === 'branch')
    return 'Branch diffs are not rendered yet.'
  if (editor && editor.kind !== 'settings' && address.workspace === '-')
    return 'This document requires a workspace.'
  return null
}

export function validSearchParams(input: Address['search']): Address['search'] {
  if (!input) return null
  const result: Record<string, string> = {}
  for (const key of ['q', 'in', 'x']) {
    if (input[key]) result[key] = input[key]
  }
  if (input.m && ['literal', 'regex', 'fuzzy'].includes(input.m)) result.m = input.m
  for (const key of ['case', 'word']) {
    if (input[key] === '0' || input[key] === '1') result[key] = input[key]
  }
  return Object.keys(result).length ? result : null
}

export function validLogParams(input: Address['logs']): Address['logs'] {
  if (!input) return null
  const result: Record<string, string> = {}
  for (const key of ['area', 'src', 'find']) {
    if (input[key]) result[key] = input[key]
  }
  if (input.level && ['all', 'debug', 'info', 'warn', 'error'].includes(input.level))
    result.level = input.level
  if (input.since && ['15m', '1h', '6h', '24h', 'all'].includes(input.since))
    result.since = input.since
  if (input.slow && Number.isFinite(Number(input.slow)) && Number(input.slow) >= 0)
    result.slow = input.slow
  return Object.keys(result).length ? result : null
}
