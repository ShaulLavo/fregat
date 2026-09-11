import {
  emptyAddress,
  editorDocumentToken,
  type Address,
  type AddressMode,
} from '@workspace/client-core/address/grammar'
import {
  chatReferenceForToken,
  editorReferenceForToken,
  tokenForChatReference,
  tokenForEditorReference,
  type ChatReference,
  type EditorReference,
} from '@workspace/client-core/address/references'
import { diffScopeFor, diffScopeParam } from '@/features/address/utils/diff-scope'
import { logsFiltersFor, logsParamsFor } from '@/features/address/utils/logs-params'
import {
  searchParamsFor,
  searchStateFor,
  type SearchBufferFacts,
} from '@/features/address/utils/search-params'
import type { SessionDiffScope } from '@/features/chat/utils/session-diff-scope-storage'
import { isChatModeToolTab, type ChatModeToolTab } from '@/features/chat-mode/utils/panels'
import type { LogsFilterState } from '@/features/logs/utils/filter-params'

export type WorkspaceView = {
  readonly mode: AddressMode
  readonly editor: EditorReference | null
  readonly mainChat: ChatReference | null
  readonly sidebarChat: ChatReference | null
  readonly tabs: readonly EditorReference[]
  readonly side: NonNullable<Address['side']>
  readonly bottom: NonNullable<Address['bottom']>
  readonly tool: ChatModeToolTab
  readonly rail: NonNullable<Address['rail']>
  readonly diff: SessionDiffScope | null
  readonly search: Omit<SearchBufferFacts, 'filtersVisible'>
  readonly logs: Readonly<LogsFilterState>
  readonly settings: string | null
  readonly focus: Address['focus']
}

export type WorkspaceAddressOwner = Pick<
  Address,
  'workspace' | 'environmentId' | 'rejectedEnvironment'
>

export function viewForAddress(address: Address, logDefaults: LogsFilterState): WorkspaceView {
  const search = searchStateFor(address.search)
  return {
    mode: address.mode ?? 'workbench',
    editor: editorReferenceForToken(editorDocumentToken(address)),
    mainChat: address.mode === 'chat' ? chatReferenceForToken(address.document) : null,
    sidebarChat: address.side === 'chat' ? chatReferenceForToken(address.chat) : null,
    tabs: (address.tabs ?? []).map(editorReferenceForToken).filter((tab) => tab !== null),
    side: address.side ?? 'files',
    bottom: address.bottom ?? 'terminal',
    tool: isChatModeToolTab(address.tool) ? address.tool : 'git',
    rail: address.rail ?? 'active',
    diff: diffScopeFor(address.diff),
    search: {
      caseSensitive: search?.caseSensitive ?? false,
      excludeGlobText: search?.excludeGlobText ?? '',
      includeGlobText: search?.includeGlobText ?? '',
      matchMode: search?.matchMode ?? 'literal',
      query: search?.query ?? '',
      wholeWord: search?.wholeWord ?? false,
    },
    logs: logsFiltersFor(address.logs, logDefaults) ?? logDefaults,
    settings: address.settings,
    focus: address.focus,
  }
}

export function addressForView(
  owner: WorkspaceAddressOwner,
  view: WorkspaceView,
  logDefaults: LogsFilterState,
  passthrough: Address['passthrough'] = {},
): Address {
  const selected = view.editor ? tokenForEditorReference(view.editor) : null
  const mainChat = view.mainChat ? tokenForChatReference(view.mainChat) : null
  return {
    ...emptyAddress(),
    ...owner,
    mode: view.mode,
    document: view.mode === 'chat' ? mainChat : selected,
    editor: view.mode === 'chat' ? selected : null,
    chat: view.side === 'chat' && view.sidebarChat ? tokenForChatReference(view.sidebarChat) : null,
    tabs: view.tabs.map(tokenForEditorReference),
    side: view.side,
    bottom: view.bottom,
    tool: view.tool,
    rail: view.rail,
    diff: diffScopeParam(view.diff),
    search: searchParamsFor({ ...view.search, filtersVisible: true }),
    logs: logsParamsFor(view.logs, logDefaults),
    settings: view.settings,
    focus: view.focus,
    passthrough,
  }
}
