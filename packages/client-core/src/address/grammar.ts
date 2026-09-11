import { environmentIdSchema, type EnvironmentId } from '@workspace/contracts'
import * as v from 'valibot'
import { NO_WORKSPACE_TOKEN } from '@workspace/client-core/address/workspace'
import { chatReferenceForToken, editorReferenceForToken } from './references'

// Parse explicit input before serialization removes static defaults.
const WORKSPACE_PREFIX = '~'

export const SETTINGS_DOCUMENT_TOKEN = 'settings'

export const ADDRESS_MODES = ['chat', 'workbench'] as const
export type AddressMode = (typeof ADDRESS_MODES)[number]

/**
 * A closed record, and that is the whitelist that makes the deny-list structural: a
 * store the encoder must never reach — the terminal command inbox, the composer inbox —
 * cannot be written into an `Address` even by mistake, because there is no field to put
 * it in. The same property, from the other side, is what `AddressSnapshot` provides:
 * nothing dangerous can be read FROM the store either.
 *
 * A plain type rather than a valibot schema. It was a `strictObject`, but nothing ever
 * parsed it — only `InferOutput` read it — so the runtime strictness was never on, and
 * naming a schema implied a validation step that did not exist. The URL is untrusted
 * input handled by a normalizing parser (below), which is the real defence: a garbage
 * segment costs the field it names and nothing else, where a schema would throw.
 */
export type Address = {
  readonly environmentId: EnvironmentId | null
  readonly rejectedEnvironment: string | null
  readonly bottom: 'terminal' | 'problems' | null
  readonly chat: string | null
  /** Session diff scope. Deliberately NOT `scope`: the rail owns no addressable scope. */
  readonly diff: string | null
  readonly document: string | null
  /** Selected editor document while the path identifies a chat session. */
  readonly editor: string | null
  readonly focus: {
    readonly column: number | null
    readonly endLine: number | null
    readonly line: number
  } | null
  /** `log.*` — the log dashboard's filters, which persist nothing today. */
  readonly logs: Readonly<Record<string, string>> | null
  readonly mode: AddressMode | null
  /** The four dev params, by name. Bounded on purpose — see `DEV_SEARCH_KEYS`. */
  readonly passthrough: Readonly<Record<string, string>>
  readonly rail: 'active' | 'archived' | null
  /** `s.*` — the search buffer's query and flags. Never its replacement text. */
  readonly search: Readonly<Record<string, string>> | null
  /** Settings category filter; tab membership and selection live in tabs/document/editor. */
  readonly settings: string | null
  readonly side: 'chat' | 'files' | 'git' | 'logs' | 'search' | null
  readonly tabs: readonly string[] | null
  readonly tool: string | null
  readonly workspace: string | null
}

export function editorDocumentToken(address: Address): string | null {
  return address.mode === 'chat' ? address.editor : address.document
}

const LOGS_PREFIX = 'log.'
const SEARCH_PREFIX = 's.'

export function emptyAddress(): Address {
  return {
    environmentId: null,
    rejectedEnvironment: null,
    bottom: null,
    chat: null,
    diff: null,
    document: null,
    editor: null,
    focus: null,
    logs: null,
    mode: null,
    passthrough: {},
    rail: null,
    search: null,
    settings: null,
    side: null,
    tabs: null,
    tool: null,
    workspace: null,
  }
}

/**
 * The URL is untrusted input parsed by a normalizing parser, never a schema that
 * throws. A garbage segment costs the field it names and nothing else.
 */
export type AddressEnvironments = {
  readonly knownEnvironmentIds: readonly EnvironmentId[]
  readonly primaryEnvironmentId: EnvironmentId | null
}

export function parseAddress(href: string, environments?: AddressEnvironments): Address {
  const url = safeUrl(href)
  if (!url) return emptyAddress()

  // Segments stay RAW here. Only the workspace token is decoded, because only the token
  // is a plain value; a document token owns its own encoding and decodes per segment
  // in `document-token.ts`. Decoding the whole path first turned
  // `r/refs%2Fheads%2Fmain/src/a.ts` into `r/refs/heads/main/src/a.ts`, which then
  // split into the wrong fields and restored the wrong document.
  const segments = url.pathname.split('/').filter(Boolean)
  const environmentSegment = segments[0]?.startsWith('@') ? segments.shift() : undefined
  const environment = parseEnvironment(environmentSegment, environments)
  const [workspaceSegment, ...rest] = segments

  const address: Address = {
    ...emptyAddress(),
    ...searchFields(url.searchParams, url.search),
    ...environment,
    document: rest.slice(1).join('/') || null,
    focus: parseFocus(url.hash),
    mode: addressMode(rest[0]),
    workspace: workspaceTokenFromSegment(decodeOrEmpty(workspaceSegment ?? '')),
  }
  const chat = address.chat && chatReferenceForToken(address.chat) ? address.chat : null
  const side = address.side ?? (chat ? 'chat' : null)
  return {
    ...address,
    chat: side === 'chat' ? chat : null,
    side,
    tabs: expandTabs(address.tabs, editorDocumentToken(address)),
  }
}

export function serializeAddress(address: Address, primaryEnvironmentId?: EnvironmentId | null) {
  return {
    hash: serializeFocus(address.focus),
    pathname: serializePathname(address, primaryEnvironmentId),
    search: serializeSearch(address),
  }
}

export function formatAddress(address: Address, primaryEnvironmentId?: EnvironmentId | null) {
  const { hash, pathname, search } = serializeAddress(address, primaryEnvironmentId)

  return `${pathname}${search}${hash}`
}

function serializePathname(address: Address, primaryEnvironmentId?: EnvironmentId | null) {
  if (!address.workspace) return '/'

  const segments: string[] = []
  if (address.environmentId && address.environmentId !== primaryEnvironmentId)
    segments.push(`@${address.environmentId}`)
  if (address.rejectedEnvironment !== null)
    segments.push(`@${encodeURIComponent(address.rejectedEnvironment)}`)
  segments.push(`${WORKSPACE_PREFIX}${encodeWorkspaceToken(address.workspace)}`)
  if (address.mode) segments.push(address.mode)
  if (address.mode && address.document) segments.push(address.document)

  return `/${segments.join('/')}`
}

function parseEnvironment(
  segment: string | undefined,
  environments: AddressEnvironments | undefined,
) {
  if (!segment) return { environmentId: null, rejectedEnvironment: null }
  const raw = decodeOrEmpty(segment.slice(1))
  const parsed = v.safeParse(environmentIdSchema, raw)
  if (!parsed.success || !environments?.knownEnvironmentIds.includes(parsed.output)) {
    return { environmentId: null, rejectedEnvironment: raw }
  }
  const environmentId = parsed.output === environments.primaryEnvironmentId ? null : parsed.output
  return { environmentId, rejectedEnvironment: null }
}

// Split raw delimiters before decoding so a filename containing ~ stays one tab.
export const TAB_SEPARATOR = '~'
export const SELECTED_TAB_TOKEN = '@'
export const EMPTY_TABS_TOKEN = '-'
export const MAX_APPLIED_TABS = 64
export const TABS_BUDGET_BYTES = 1500

export function applicableTabs(tabs: readonly string[] | null) {
  if (tabs === null || tabs.length > MAX_APPLIED_TABS) return null
  if (tabs.some((token) => editorReferenceForToken(token) === null)) return null
  return tabs
}

export function expandTabs(tabs: readonly string[] | null, selected: string | null) {
  if (tabs === null) return null
  if (tabs.length === 0) return selected ? null : tabs
  if (tabs.join(TAB_SEPARATOR).length > TABS_BUDGET_BYTES) return null
  if (tabs.filter((token) => token === SELECTED_TAB_TOKEN).length > 1) return null
  if (tabs.includes(SELECTED_TAB_TOKEN) && !selected) return null
  const expanded = tabs.map((token) => (token === SELECTED_TAB_TOKEN ? (selected ?? '') : token))
  if (selected && !expanded.includes(selected)) expanded.push(selected)
  if (new Set(expanded).size !== expanded.length) return null
  return applicableTabs(expanded)
}

export function compressedTabs(tabs: readonly string[] | null, selected: string | null) {
  if (tabs === null) return null
  if (tabs.length === 0) return selected ? null : EMPTY_TABS_TOKEN
  return tabs.map((token) => (token === selected ? SELECTED_TAB_TOKEN : token)).join(TAB_SEPARATOR)
}

function serializeSearch(address: Address) {
  const params = new URLSearchParams()
  const side = address.side ?? (address.chat ? 'chat' : null)
  if (side && side !== 'files') params.set('side', side)
  if (address.bottom && address.bottom !== 'terminal') params.set('bottom', address.bottom)
  if (address.tool && address.tool !== 'git') params.set('tool', address.tool)
  if (address.rail && address.rail !== 'active') params.set('rail', address.rail)
  if (address.diff) params.set('diff', address.diff)
  if (address.settings) params.set('settings', address.settings)
  for (const [key, value] of Object.entries(address.logs ?? {})) {
    if (value) params.set(`${LOGS_PREFIX}${key}`, value)
  }
  for (const [key, value] of Object.entries(address.search ?? {})) {
    if (value) params.set(`${SEARCH_PREFIX}${key}`, value)
  }
  for (const [key, value] of Object.entries(address.passthrough)) params.set(key, value)

  const tabValue = compressedTabs(address.tabs, editorDocumentToken(address))
  const tabs = tabValue === null ? '' : `tabs=${tabValue}`
  const editor = address.editor ? `editor=${address.editor}` : ''
  const chat = side === 'chat' && address.chat ? `chat=${address.chat}` : ''
  const query = [tabs, editor, chat, params.toString()].filter(Boolean).join('&')
  return query ? `?${query}` : ''
}

/**
 * The raw, still-encoded value of one query key.
 *
 * Splitting on `&` and `=` is safe for exactly the keys that need it: every tab token
 * segment goes through `encodeSegment`, which leaves only unreserved characters plus
 * `/` — never `&`, `=` or `#`.
 */
function rawSearchValue(search: string, key: string) {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const equals = pair.indexOf('=')
    if (equals < 0) continue
    if (pair.slice(0, equals) !== key) continue

    return pair.slice(equals + 1)
  }

  return null
}

function parseTabsValue(raw: string | null) {
  if (raw === EMPTY_TABS_TOKEN) return []
  if (!raw) return null
  return raw.split(TAB_SEPARATOR)
}

function searchFields(params: URLSearchParams, rawSearch: string) {
  // Raw, not `params.get`: see `TAB_SEPARATOR`. Decoding before the split would let a
  // file named `a~b.ts` break the token list into two.
  const tabs = rawSearchValue(rawSearch, 'tabs')

  return {
    bottom: pick(params.get('bottom'), ['terminal', 'problems'] as const),
    chat: rawSearchValue(rawSearch, 'chat') || null,
    editor: rawSearchValue(rawSearch, 'editor') || null,
    diff: params.get('diff') || null,
    logs: prefixedGroup(params, LOGS_PREFIX),
    search: prefixedGroup(params, SEARCH_PREFIX),
    passthrough: passthroughFrom(params),
    rail: pick(params.get('rail'), ['active', 'archived'] as const),
    settings: params.get('settings') || null,
    side: pick(params.get('side'), ['chat', 'files', 'git', 'logs', 'search'] as const),
    tabs: parseTabsValue(tabs),
    tool: pick(params.get('tool'), [
      'editor',
      'files',
      'git',
      'logs',
      'problems',
      'search',
      'terminal',
    ]),
  }
}

/**
 * The four dev params, by name.
 *
 * They are carried because they are read by code outside React's lifecycle, two of
 * them LATE — `editorPerfLayout` during every editor render, and `decode` on the first
 * editor's idle callback — so a canonicalizing rewrite that dropped them would change
 * behaviour mid-session with no error and no log.
 *
 * An allow-list rather than "everything unowned", which is what this used to be. That
 * version made ANY query param permanent for the install: the projection copied it into
 * every subsequent address, `mergeLiveSearch` can override a stored key but never remove
 * one, and `copyAddress` then shipped it to whoever received the link. `?decode=`, whose
 * own docs call it opt-in per session, became a setting you could not turn off. It also
 * punched an unbounded wildcard through the `strictObject` whose entire purpose is that
 * un-addressable state has no field to travel in.
 */
export const DEV_SEARCH_KEYS = [
  'decode',
  'editorPerfDisable',
  'editorPerfLayout',
  'editorPerfTrace',
] as const

const DEV_SEARCH_KEY_SET: ReadonlySet<string> = new Set(DEV_SEARCH_KEYS)

function passthroughFrom(params: URLSearchParams) {
  const passthrough: Record<string, string> = {}

  for (const [key, value] of params) {
    if (!DEV_SEARCH_KEY_SET.has(key)) continue
    // First wins, matching `URLSearchParams.get` — which is how every named slot above
    // reads its value. Letting these loops take the LAST occurrence instead meant
    // `?side=git&side=files` and `?decode=a&decode=b` resolved by opposite rules.
    if (key in passthrough) continue

    passthrough[key] = value
  }

  return passthrough
}

/** A prefixed family collapses to one record, so the grammar owns the group not the keys. */
function prefixedGroup(params: URLSearchParams, prefix: string) {
  const group: Record<string, string> = {}

  for (const [key, value] of params) {
    if (!key.startsWith(prefix)) continue

    const name = key.slice(prefix.length)
    // First wins, as everywhere else in this parser.
    if (name in group) continue

    if (value) group[name] = value
  }

  return Object.keys(group).length > 0 ? group : null
}

function workspaceTokenFromSegment(segment: string | undefined) {
  if (!segment?.startsWith(WORKSPACE_PREFIX)) return null

  return segment.slice(WORKSPACE_PREFIX.length) || null
}

function addressMode(segment: string | undefined): AddressMode | null {
  return pick(segment ?? null, ADDRESS_MODES)
}

/** `#L484`, `#L21,9`, `#L484-L520`. Never sent to a server, never in a referer. */
function parseFocus(hash: string) {
  const match = /^#L(\d+)(?:,(\d+))?(?:-L(\d+))?$/.exec(hash)
  if (!match) return null

  const line = Number(match[1])
  if (!Number.isSafeInteger(line) || line < 1) return null

  // Every part is validated, not just the line. `#L10,0` yields a column the 1-based
  // grammar cannot mean — and which `serializeFocus` then drops as falsy, so it does not
  // even survive a round trip — while `#L20-L10` is a reversed range the editor would
  // have to apply as a selection. Neither is something the encoder can emit, so a
  // fragment carrying one is hand-edited and gets the same answer as any other garbage
  // segment: the field it names is dropped, and nothing else.
  const column = match[2] ? Number(match[2]) : null
  const endLine = match[3] ? Number(match[3]) : null
  if (column !== null && (!Number.isSafeInteger(column) || column < 1)) return null
  if (endLine !== null && (!Number.isSafeInteger(endLine) || endLine < line)) return null

  return { column, endLine, line }
}

function serializeFocus(focus: Address['focus']) {
  if (!focus) return ''
  // A line the parser could not read back is worse than no fragment: `1e21` stringifies
  // to `1e+21`, which `#L(\d+)` rejects, so the position silently vanished on reload.
  if (!Number.isSafeInteger(focus.line) || focus.line < 1) return ''

  // Column and range are independent: `#L10,5-L20` is a real position and the parser
  // already reads it. Emitting them exclusively silently dropped the column on every
  // ranged go-to-definition.
  const column = focus.column ? `,${focus.column}` : ''
  const end = focus.endLine ? `-L${focus.endLine}` : ''

  return `#L${focus.line}${column}${end}`
}

function pick<const T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null
}

function encodeWorkspaceToken(token: string) {
  if (token === NO_WORKSPACE_TOKEN) return token

  return encodeURIComponent(token).replaceAll('~', '%7E')
}

function decodeOrEmpty(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function safeUrl(href: string) {
  try {
    return new URL(href, 'http://localhost')
  } catch {
    return null
  }
}
