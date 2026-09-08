import type { Address } from '@workspace/client-core/address/grammar'
import { log } from '@/lib/client-logging'
import { reportTabOmission } from '@/features/address/state/tab-omission-logging'
import { documentTokenForPath } from '@/features/address/utils/document-token'
import {
  emptyAddress,
  formatAddress,
  MAX_APPLIED_TABS,
  TAB_SEPARATOR,
} from '@workspace/client-core/address/grammar'
import { NO_WORKSPACE_TOKEN, workspaceToken } from '@workspace/client-core/address/workspace'
import type { WorkspaceAddress } from '@workspace/contracts'
import { isSettingsDocumentId } from '@/features/settings/utils/document'

/**
 * The narrow record the encoder takes, instead of a store.
 *
 * This is half of what makes the deny-list structural. `Address` is a `strictObject`
 * with no field for a dangerous value; `AddressSnapshot` is a hand-written record with
 * no field to read one FROM. The terminal command inbox and the composer inbox are
 * `take`-once queues — a URL that replayed one would run a shell command or inject
 * prompt text on page load — and neither store is reachable from here.
 *
 * Every field is what the user is looking at, never how it is drawn: no pane
 * percentages, no theme, no scroll offsets, no open/closed chrome booleans.
 */
export type AddressSnapshot = {
  readonly environmentId: Address['environmentId']
  readonly activeDocumentPath: string | null
  readonly bottomTab: Address['bottom']
  readonly editorTabPaths: readonly string[]
  readonly focus: Address['focus']
  readonly workspaceAddress: WorkspaceAddress | null
  readonly mode: Address['mode']
  /** Unowned search keys observed at boot, carried so a rewrite cannot drop them. */
  readonly passthrough: Readonly<Record<string, string>>
  readonly railView: Address['rail']
  readonly rootPath: string | null
  readonly settingsCategory: string | null
  /**
   * Chat mode's session, as a token: `t/<sessionId>`, `t/new`, or absent for an
   * auto-pick. Chat mode's selection only — the workbench sidebar's chat tab keeps
   * its own unpersisted pick, and addressing both would make `t/` ambiguous about
   * which surface it targets.
   */
  readonly sessionToken: string | null
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
    activeDocumentPath: null,
    bottomTab: null,
    editorTabPaths: [],
    focus: null,
    workspaceAddress: null,
    mode: null,
    passthrough: {},
    railView: null,
    rootPath: null,
    logs: null,
    search: null,
    sessionToken: null,
    settingsCategory: null,
    sidebarTab: null,
    sessionDiffScope: null,
    toolTab: null,
  }
}

export function addressFromSnapshot(snapshot: AddressSnapshot): Address {
  const rootPath = snapshot.rootPath
  const active = snapshot.activeDocumentPath
    ? documentTokenForPath(rootPath, snapshot.activeDocumentPath)
    : null

  return withinUrlBudget({
    ...emptyAddress(),
    environmentId: snapshot.environmentId,
    bottom: snapshot.bottomTab,
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
    tabs: tabTokens(rootPath, snapshot.editorTabPaths),
    tool: snapshot.toolTab,
    workspace: snapshot.workspaceAddress
      ? workspaceToken(snapshot.workspaceAddress)
      : NO_WORKSPACE_TOKEN,
  })
}

/**
 * A total ceiling on the emitted URL, because three slots are unbounded free text:
 * `s.q`, `s.in`/`s.x` and `log.find` all carry whatever the user typed — or pasted.
 *
 * Measured against the real servers: both the Vite dev server (Node) and the Elysia
 * backend (Bun) answer **431** past roughly 16KB, which is a blank error page rather
 * than a degraded app, and it strikes on reload or on opening a shared link — the
 * moments the URL travels over HTTP before React exists. 4000 leaves room under the
 * 8KB default that nginx (`large_client_header_buffers`) and Apache
 * (`LimitRequestLine`) impose if this ever sits behind a proxy, and absorbs the 3.75×
 * blow-up that percent-encoding inflicts on a non-ASCII path.
 */
const URL_BUDGET_BYTES = 4000

/**
 * Dropped in ascending order of how much the recipient of a link would miss them. The
 * identity — workspace, mode, document, focus — is never dropped, so an over-budget
 * address still lands you on the right file; it just arrives without the search query
 * that was never yours anyway.
 */
const DROPPABLE_SLOTS: readonly (readonly [string, (address: Address) => Address])[] = [
  ['search', (address) => ({ ...address, search: null })],
  ['logs', (address) => ({ ...address, logs: null })],
  ['tabs', (address) => ({ ...address, tabs: null })],
]

function withinUrlBudget(address: Address): Address {
  if (formatAddress(address).length <= URL_BUDGET_BYTES) return address

  const dropped: string[] = []
  let trimmed = address
  for (const [slot, drop] of DROPPABLE_SLOTS) {
    trimmed = drop(trimmed)
    dropped.push(slot)
    if (formatAddress(trimmed).length <= URL_BUDGET_BYTES) break
  }

  log.warn({
    action: 'address.truncated',
    area: 'address',
    budgetBytes: URL_BUDGET_BYTES,
    dropped,
    // Lengths, never the content: an over-budget address is over budget precisely
    // because it carries a lot of what the user typed.
    finalLength: formatAddress(trimmed).length,
    originalLength: formatAddress(address).length,
  })

  return trimmed
}

function settingsCategory(snapshot: AddressSnapshot) {
  const open = snapshot.editorTabPaths.some(isSettingsDocumentId)
  if (!open) return null

  return snapshot.settingsCategory
}

/**
 * Over budget, `tabs` is dropped ENTIRELY and never truncated: a partial tab set
 * would delete tabs on apply. The path still names the active document, so the link
 * degrades to something useful rather than to something wrong.
 */
const TABS_BUDGET_BYTES = 1500

function tabTokens(rootPath: string | null, paths: readonly string[]) {
  const tokens = paths
    .map((path) => documentTokenForPath(rootPath, path))
    .flatMap((result) => (result.kind === 'token' ? [result.token] : []))
  if (tokens.length === 0) return null

  // Two ceilings, because they bind on different link shapes. `MAX_APPLIED_TABS` is the
  // reader's rule, and emitting past it would hand the recipient a set their own applier
  // discards whole — sixty-five short tokens sit far under the byte budget, so the byte
  // check alone let the two sides disagree. `TABS_BUDGET_BYTES` still catches the few
  // very long tokens that fit the count but not the URL.
  const signature = tokens.join(TAB_SEPARATOR)
  const bytes = signature.length
  if (tokens.length <= MAX_APPLIED_TABS && bytes <= TABS_BUDGET_BYTES) return tokens

  reportTabOmission({
    bytes,
    signature,
    tabCount: tokens.length,
  })
  return null
}

function documentToken(active: ReturnType<typeof documentTokenForPath> | null) {
  return active?.kind === 'token' ? active.token : null
}
