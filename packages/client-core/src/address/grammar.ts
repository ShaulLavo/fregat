import { environmentIdSchema, type EnvironmentId } from '@workspace/contracts'
import * as v from 'valibot'
import { NO_WORKSPACE_TOKEN } from '@workspace/client-core/address/workspace'

/**
 * `/~<workspace-token>/<mode>/<document-token>?<view params>#<position>`
 *
 * Path is identity, search is composition and filters, fragment is intra-document
 * position. The workspace segment always starts `~` so the flat top-level namespace
 * stays free — and that is load-bearing at the HTTP layer, not just tidiness: Vite
 * serves real files before its SPA fallback, and `apps/web/public/workbench/` exists,
 * so a bare `/workbench` route would be shadowed by a directory and never reach React.
 *
 * Every field is optional. An absent field means "defer to the remembered slice",
 * never "reset to default" — that rule is what lets a short link land somewhere sane
 * without flattening everything the URL does not mention.
 */

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

  return {
    ...emptyAddress(),
    ...searchFields(url.searchParams, url.search),
    ...environment,
    document: rest.slice(1).join('/') || null,
    focus: parseFocus(url.hash),
    mode: addressMode(rest[0]),
    workspace: workspaceTokenFromSegment(decodeOrEmpty(workspaceSegment ?? '')),
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

/**
 * `?tabs=` is written OUTSIDE `URLSearchParams`, and read back raw.
 *
 * RFC 3986 puts `/` in the legal character set for a query (`query = *( pchar / "/" /
 * "?" )`); `URLSearchParams` escapes it anyway, out of conservatism rather than need.
 * Since every tab token is already a `/`-joined list of individually encoded segments,
 * that escaping cost three characters per separator and turned a readable token into
 * `f%2Fapps%2Fweb%2Fsrc%2Fmain.tsx` — measured at 25% of the whole param on a
 * twelve-tab workspace.
 *
 * Reading it back has a trap, and it is why this cannot simply drop the encoding and
 * keep using `params.get`. That getter percent-decodes once, and the decode is
 * currently absorbed by `set` having escaped `%` as `%25` on the way out. Remove the
 * outer layer and a file named `a~b.ts` — encoded `a%7Eb.ts` — decodes back to a
 * literal `~` BEFORE the split, silently becoming two tabs. So the value is split
 * first and decoded per segment afterwards, exactly as `parseAddress` already treats
 * the path, for exactly the same reason.
 */
export const TAB_SEPARATOR = '~'

/**
 * A link naming more tabs than a person could have opened is not a tab set.
 *
 * Here rather than beside either consumer, because BOTH paths that apply `?tabs=` have
 * to honour it: the boot merge in `utils/cache.ts` and the post-mount applier in
 * `hooks/use-restore.ts`. The encoder caps what it writes, which says nothing about a
 * hand-edited or hostile link — and the boot merge runs inside a `useState`
 * initializer, so an unbounded set there blocks first paint and is then persisted.
 */
export const MAX_APPLIED_TABS = 64

/** The tab tokens an address may apply, or `null` when the set is not a tab set. */
export function applicableTabs(tabs: readonly string[] | null) {
  if (!tabs?.length) return null
  if (tabs.length > MAX_APPLIED_TABS) return null

  return tabs
}

function serializeSearch(address: Address) {
  const params = new URLSearchParams()

  if (address.side) params.set('side', address.side)
  if (address.bottom) params.set('bottom', address.bottom)
  // `!== null` for the free-text slots, matching `settings` below: an empty `?tool=`
  // or `?diff=` is a value the parser reads back, and dropping it as falsy made the
  // encoder disagree with its own decoder.
  if (address.tool !== null) params.set('tool', address.tool)
  if (address.rail) params.set('rail', address.rail)
  if (address.diff !== null) params.set('diff', address.diff)
  if (address.settings !== null) params.set('settings', address.settings)
  for (const [key, value] of Object.entries(address.logs ?? {}))
    params.set(`${LOGS_PREFIX}${key}`, value)
  for (const [key, value] of Object.entries(address.search ?? {}))
    params.set(`${SEARCH_PREFIX}${key}`, value)
  for (const [key, value] of Object.entries(address.passthrough)) params.set(key, value)

  // Tabs lead, as they did when `URLSearchParams` owned them, so the URL shape a user
  // has seen before does not reorder underneath them.
  const tabs = address.tabs?.length ? `tabs=${address.tabs.join(TAB_SEPARATOR)}` : ''
  const editor = address.editor ? `editor=${address.editor}` : ''
  const query = [tabs, editor, params.toString()].filter(Boolean).join('&')

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

function searchFields(params: URLSearchParams, rawSearch: string) {
  // Raw, not `params.get`: see `TAB_SEPARATOR`. Decoding before the split would let a
  // file named `a~b.ts` break the token list into two.
  const tabs = rawSearchValue(rawSearch, 'tabs')

  return {
    bottom: pick(params.get('bottom'), ['terminal', 'problems'] as const),
    editor: rawSearchValue(rawSearch, 'editor') || null,
    diff: params.get('diff'),
    logs: prefixedGroup(params, LOGS_PREFIX),
    search: prefixedGroup(params, SEARCH_PREFIX),
    passthrough: passthroughFrom(params),
    rail: pick(params.get('rail'), ['active', 'archived'] as const),
    settings: params.get('settings'),
    side: pick(params.get('side'), ['chat', 'files', 'git', 'logs', 'search'] as const),
    tabs: tabs ? tabs.split(TAB_SEPARATOR).filter(Boolean) : null,
    tool: params.get('tool'),
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

    group[name] = value
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
  if (!Number.isInteger(line) || line < 1) return null

  // Every part is validated, not just the line. `#L10,0` yields a column the 1-based
  // grammar cannot mean — and which `serializeFocus` then drops as falsy, so it does not
  // even survive a round trip — while `#L20-L10` is a reversed range the editor would
  // have to apply as a selection. Neither is something the encoder can emit, so a
  // fragment carrying one is hand-edited and gets the same answer as any other garbage
  // segment: the field it names is dropped, and nothing else.
  const column = match[2] ? Number(match[2]) : null
  const endLine = match[3] ? Number(match[3]) : null
  if (column !== null && column < 1) return null
  if (endLine !== null && endLine < line) return null

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

function pick<const T extends readonly string[]>(value: string | null, allowed: T) {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : null
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
