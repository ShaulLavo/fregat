import type { Address } from '@workspace/client-core/address/grammar'
import { documentTokenForContent } from '@/features/address/utils/document-token'
import {
  emptyAddress,
  formatAddress,
  MAX_APPLIED_TABS,
  TABS_BUDGET_BYTES,
  compressedTabs,
  editorDocumentToken,
} from '@workspace/client-core/address/grammar'
import { NO_WORKSPACE_TOKEN, workspaceToken } from '@workspace/client-core/address/workspace'
import type { WorkspaceAddress } from '@workspace/contracts'
import type { TabContent } from '@/lib/documents/utils/types'

// Capture only addressed view data; commands, drafts, and document contents never enter this record.
export type AddressSnapshot = {
  readonly environmentId: Address['environmentId']
  readonly activeTabContent: TabContent | null
  readonly bottomTab: Address['bottom']
  readonly editorTabContents: readonly TabContent[]
  readonly focus: Address['focus']
  readonly workspaceAddress: WorkspaceAddress | null
  readonly mode: Address['mode']
  /** Unowned search keys observed at boot, carried so a rewrite cannot drop them. */
  readonly passthrough: Readonly<Record<string, string>>
  readonly railView: Address['rail']
  readonly rootPath: string | null
  readonly settingsCategory: string | null
  /** Main chat selection is independent from the sidebar conversation. */
  readonly sessionToken: string | null
  readonly sidebarSessionToken: string | null
  /** `s.*` — query and flags only. `replaceText` has no field here, by construction. */
  readonly search: Readonly<Record<string, string>> | null
  /** `log.*` — the dashboard's filters. */
  readonly logs: Readonly<Record<string, string>> | null
  readonly sidebarTab: Address['side']
  readonly sessionDiffScope: string | null
  readonly toolTab: string | null
}

export function emptyAddressSnapshot(): AddressSnapshot {
  return {
    environmentId: null,
    activeTabContent: null,
    bottomTab: null,
    editorTabContents: [],
    focus: null,
    workspaceAddress: null,
    mode: null,
    passthrough: {},
    railView: null,
    rootPath: null,
    logs: null,
    search: null,
    sessionToken: null,
    sidebarSessionToken: null,
    settingsCategory: null,
    sidebarTab: null,
    sessionDiffScope: null,
    toolTab: null,
  }
}

export function completeAddressFromSnapshot(snapshot: AddressSnapshot): Address {
  const rootPath = snapshot.rootPath
  const active = snapshot.activeTabContent
    ? documentTokenForContent(rootPath, snapshot.activeTabContent)
    : null

  return {
    ...emptyAddress(),
    environmentId: snapshot.environmentId,
    bottom: snapshot.bottomTab,
    chat: snapshot.sidebarTab === 'chat' ? snapshot.sidebarSessionToken : null,
    diff: snapshot.sessionDiffScope,
    document: snapshot.mode === 'chat' ? snapshot.sessionToken : documentToken(active),
    editor: snapshot.mode === 'chat' ? documentToken(active) : null,
    focus: snapshot.focus,
    mode: snapshot.mode,
    passthrough: { ...snapshot.passthrough },
    logs: snapshot.logs ? { ...snapshot.logs } : null,
    rail: snapshot.railView,
    search: snapshot.search ? { ...snapshot.search } : null,
    settings: settingsCategory(snapshot),
    side: snapshot.sidebarTab,
    tabs: tabTokens(rootPath, snapshot.editorTabContents, documentToken(active)),
    tool: snapshot.toolTab,
    workspace: snapshot.workspaceAddress
      ? workspaceToken(snapshot.workspaceAddress)
      : NO_WORKSPACE_TOKEN,
  }
}

export function addressFromSnapshot(snapshot: AddressSnapshot): Address {
  return budgetAddress(completeAddressFromSnapshot(snapshot)).address
}

export const URL_BUDGET_BYTES = 4000
export type AddressOmission = 'search' | 'logs' | 'tabs'
export type BudgetedAddress = {
  readonly address: Address
  readonly omissions: readonly AddressOmission[]
  readonly destinationOverBudget: boolean
}

// Drop whole collections: a truncated list would close tabs the sender kept open.
export function budgetAddress(complete: Address): BudgetedAddress {
  const omissions: AddressOmission[] = []
  let address = complete
  const signature = compressedTabs(complete.tabs, editorDocumentToken(complete))
  if (
    complete.tabs &&
    (complete.tabs.length > MAX_APPLIED_TABS || (signature?.length ?? 0) > TABS_BUDGET_BYTES)
  ) {
    address = { ...address, tabs: null }
    omissions.push('tabs')
  }
  for (const slot of ['search', 'logs', 'tabs'] as const) {
    if (formatAddress(address).length <= URL_BUDGET_BYTES) break
    if (address[slot] === null) continue
    address = { ...address, [slot]: null }
    omissions.push(slot)
  }
  const finalLength = formatAddress(address).length
  return { address, omissions, destinationOverBudget: finalLength > URL_BUDGET_BYTES }
}

function settingsCategory(snapshot: AddressSnapshot) {
  const open = snapshot.editorTabContents.some((content) => content.kind === 'settings')
  if (!open) return null

  return snapshot.settingsCategory
}

function tabTokens(rootPath: string | null, paths: readonly TabContent[], selected: string | null) {
  const tokens = paths
    .map((path) => documentTokenForContent(rootPath, path))
    .flatMap((result) => (result.kind === 'token' ? [result.token] : []))
  if (selected && !tokens.includes(selected)) tokens.push(selected)
  return tokens
}

function documentToken(active: ReturnType<typeof documentTokenForContent> | null) {
  return active?.kind === 'token' ? active.token : null
}
