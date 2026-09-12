import type { LocationRewrite } from '@tanstack/react-router'
import { createError } from 'evlog'
import * as v from 'valibot'
import {
  serializeAddress,
  type Address,
  type AddressEnvironments,
} from '@workspace/client-core/address/grammar'
import { decodeSegment } from '@workspace/client-core/address/path-token'
import {
  editorReferenceSchema,
  chatReferenceSchema,
  editorReferenceForToken,
  tokenForEditorReference,
  chatReferenceForToken,
  tokenForChatReference,
  parseAddressIntent,
  type EditorReference,
} from '@/features/address/utils/intent'
import type { ApplicationRouter } from '@/state/router'
import type { NavigationHistoryTarget } from '@/features/address/utils/history'

const text = v.pipe(v.string(), v.nonEmpty())
const optionalText = v.fallback(v.optional(text), undefined)
const selectedTabSchema = v.object({ kind: v.literal('selected') })
const tabSchema = v.union([editorReferenceSchema, selectedTabSchema])

export const routeSearchSchema = v.object({
  tabs: v.fallback(v.optional(v.pipe(v.array(tabSchema), v.maxLength(64))), undefined),
  editor: v.fallback(v.optional(editorReferenceSchema), undefined),
  chat: v.fallback(v.optional(chatReferenceSchema), undefined),
  side: v.fallback(v.optional(v.picklist(['files', 'chat', 'git', 'logs', 'search'])), undefined),
  bottom: v.fallback(v.optional(v.picklist(['terminal', 'problems'])), undefined),
  tool: v.fallback(
    v.optional(v.picklist(['editor', 'files', 'git', 'logs', 'problems', 'search', 'terminal'])),
    undefined,
  ),
  rail: v.fallback(v.optional(v.picklist(['active', 'archived'])), undefined),
  diff: optionalText,
  settings: optionalText,
  's.q': optionalText,
  's.m': v.fallback(v.optional(v.picklist(['literal', 'regex', 'fuzzy'])), undefined),
  's.case': v.fallback(v.optional(v.literal('1')), undefined),
  's.word': v.fallback(v.optional(v.literal('1')), undefined),
  's.in': optionalText,
  's.x': optionalText,
  'log.level': v.fallback(
    v.optional(v.picklist(['all', 'debug', 'info', 'warn', 'error'])),
    undefined,
  ),
  'log.area': optionalText,
  'log.src': optionalText,
  'log.find': optionalText,
  'log.slow': v.fallback(
    v.optional(
      v.pipe(
        text,
        v.check((value) => Number.isFinite(Number(value)) && Number(value) >= 0),
      ),
    ),
    undefined,
  ),
  'log.since': v.fallback(v.optional(v.picklist(['15m', '1h', '6h', '24h', 'all'])), undefined),
  decode: optionalText,
  editorPerfDisable: optionalText,
  editorPerfLayout: optionalText,
  editorPerfTrace: optionalText,
})

export type RouteSearch = v.InferOutput<typeof routeSearchSchema>

export function parseRouteSearch(search: string): RouteSearch {
  const raw: Record<string, unknown> = {}
  for (const [key, value] of new URLSearchParams(search)) {
    if (key in raw) continue
    raw[key] = value
  }
  raw.editor = editorReferenceForToken(rawToken(search, 'editor') ?? '') ?? undefined
  raw.chat = chatReferenceForToken(rawToken(search, 'chat')) ?? undefined
  raw.tabs = parseTabs(rawToken(search, 'tabs'))
  return v.parse(routeSearchSchema, raw)
}

function parseTabs(raw: string | null): RouteSearch['tabs'] {
  if (!raw) return undefined
  if (raw === '-') return []
  const tokens = raw.split('~')
  if (tokens.length > 64) return undefined
  const tabs: NonNullable<RouteSearch['tabs']> = []
  let selected = false
  for (const token of tokens) {
    if (token === '@' && selected) return undefined
    if (token === '@') {
      tabs.push({ kind: 'selected' })
      selected = true
      continue
    }
    const reference = editorReferenceForToken(token)
    if (!reference) return undefined
    tabs.push(reference)
  }
  return tabs
}

function rawToken(search: string, key: string) {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const equals = pair.indexOf('=')
    if (equals < 0 || pair.slice(0, equals) !== key) continue
    return pair.slice(equals + 1)
  }
  return null
}

export function stringifyRouteSearch(value: Record<string, unknown>): string {
  const search = v.parse(routeSearchSchema, value)
  const { tabs, editor, chat, ...fields } = search
  const tokens: string[] = []
  if (tabs) tokens.push(`tabs=${tabTokens(tabs)}`)
  if (editor) tokens.push(`editor=${tokenForEditorReference(editor)}`)
  if (chat) tokens.push(`chat=${tokenForChatReference(chat)}`)
  const params = new URLSearchParams()
  for (const [key, field] of Object.entries(fields)) {
    if (field === undefined) continue
    params.set(key, field)
  }
  if (params.size) tokens.push(params.toString())
  return tokens.length ? `?${tokens.join('&')}` : ''
}

function tabTokens(tabs: NonNullable<RouteSearch['tabs']>) {
  if (!tabs.length) return '-'
  return tabs.map((tab) => (tab.kind === 'selected' ? '@' : tokenForEditorReference(tab))).join('~')
}

export function searchForAddress(address: Address): RouteSearch {
  return parseRouteSearch(serializeAddress(address).search)
}

// Metadata owns escaping inside a segment; Router owns the outer path parameter.
export const addressPathRewrite: LocationRewrite = {
  input: ({ url }) => rewriteMetadata(url, encodeURIComponent),
  output: ({ url }) =>
    canonicalPath(rewriteMetadata(url, (value) => decodeSegment(value) ?? value)),
}

function rewriteMetadata(url: URL, transform: (value: string) => string) {
  const segments = url.pathname.split('/')
  const workspace = segments[1]?.startsWith('@') ? 2 : 1
  if (!segments[workspace]?.startsWith('~') || segments[workspace + 1] !== 'workbench') return url
  const family = segments[workspace + 2]
  if (family !== 'd' && family !== 'k') return url
  const index = workspace + 4
  if (segments[index]) segments[index] = transform(segments[index])
  url.pathname = segments.join('/')
  return url
}

function canonicalPath(url: URL) {
  const segments = url.pathname.split('/')
  const workspace = segments[1]?.startsWith('@') ? 2 : 1
  const family = segments[workspace + 2]
  for (let index = 1; index < segments.length; index++) {
    if (index === workspace + 4 && (family === 'd' || family === 'k')) continue
    const segment = segments[index]
    if (index === workspace && segment.startsWith('~')) {
      segments[index] = `~${segment.slice(1).replaceAll('~', '%7E').replaceAll('!', '%21')}`
      continue
    }
    segments[index] = segment.replaceAll('~', '%7E').replaceAll('!', '%21')
  }
  url.pathname = segments.join('/')
  return url
}

export function stripRouterBasepath(href: string, basepath = '/') {
  const url = new URL(href, 'http://localhost')
  const prefix = basepath.replace(/\/+$/, '')
  if (prefix && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
    url.pathname = url.pathname.slice(prefix.length) || '/'
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function acceptedAddressIntent(
  router: ApplicationRouter,
  environments?: AddressEnvironments,
) {
  return parseAddressIntent(
    stripRouterBasepath(router.history.location.href, router.options.basepath),
    environments,
  )
}

export function hasAvailableRoute(router: ApplicationRouter) {
  return (
    router.state.matches.length > 1 &&
    router.state.matches.every((match) => match.status === 'success' && !match._notFound)
  )
}

export function buildAddressLocation(router: ApplicationRouter, address: Address) {
  return router.buildLocation(addressRouteOptions(address))
}

export function navigateAddress(
  router: ApplicationRouter,
  address: Address,
  {
    replace = false,
    historyTarget,
  }: { replace?: boolean; historyTarget?: NavigationHistoryTarget | null } = {},
) {
  return router.navigate({
    ...addressRouteOptions(address),
    replace,
    resetScroll: false,
    state:
      replace && historyTarget === undefined
        ? true
        : { platformNavigationTarget: historyTarget ?? null },
  })
}

function addressRouteOptions(address: Address) {
  const common = {
    search: searchForAddress(address),
    hash: serializeAddress(address).hash.slice(1),
  }
  if (!address.workspace) return { to: '/' as const, ...common }
  if (address.environmentId) {
    return workspaceAddressOptions(
      'remote',
      address,
      { environmentId: address.environmentId, workspace: address.workspace },
      common,
    )
  }
  return workspaceAddressOptions('local', address, { workspace: address.workspace }, common)
}

type CommonOptions = { search: RouteSearch; hash: string }

function editorForAddress(address: Address): EditorReference {
  const editor = editorReferenceForToken(address.document ?? '')
  if (editor) return editor
  throw createError({
    code: 'address.INVALID_EDITOR_DESTINATION',
    message: 'The destination is not an addressable editor',
    status: 400,
    why: 'The editor token is malformed',
    fix: 'Select an addressable document',
  })
}

const PREFIX = { local: '/~{$workspace}', remote: '/@{$environmentId}/~{$workspace}' } as const

type RouteOwner = {
  local: { workspace: string }
  remote: { workspace: string; environmentId: NonNullable<Address['environmentId']> }
}

function workspaceAddressOptions<K extends keyof RouteOwner>(
  kind: K,
  address: Address,
  params: RouteOwner[K],
  common: CommonOptions,
) {
  const prefix = PREFIX[kind]
  if (!address.mode) return { to: `${prefix}` as const, params, ...common }
  if (address.mode === 'chat') return chatOptions(kind, address, params, common)
  if (!address.document) return { to: `${prefix}/workbench` as const, params, ...common }
  const editor = editorForAddress(address)
  switch (editor.kind) {
    case 'settings':
      return { to: `${prefix}/workbench/settings` as const, params, ...common }
    case 'search':
      return { to: `${prefix}/workbench/s` as const, params, ...common }
    case 'file':
      return {
        to: `${prefix}/workbench/f/$` as const,
        params: { ...params, _splat: editor.path },
        ...common,
      }
    case 'compare':
      return {
        to: `${prefix}/workbench/c/$` as const,
        params: { ...params, _splat: editor.path },
        ...common,
      }
    case 'ref':
      return {
        to: `${prefix}/workbench/r/$ref/$` as const,
        params: { ...params, ref: editor.ref, _splat: editor.path },
        ...common,
      }
    case 'snapshot':
      return {
        to: `${prefix}/workbench/d/$source/$revision/$` as const,
        params: {
          ...params,
          source: editor.source,
          revision: editor.revisionToken,
          _splat: editor.path,
        },
        ...common,
      }
    case 'checkpoint':
      return checkpointOptions(kind, editor, params, common)
  }
}

function chatOptions<K extends keyof RouteOwner>(
  kind: K,
  address: Address,
  params: RouteOwner[K],
  common: CommonOptions,
) {
  const prefix = PREFIX[kind]
  const chat = chatReferenceForToken(address.document)
  if (!chat) return { to: `${prefix}/chat` as const, params, ...common }
  if (chat.kind === 'draft') return { to: `${prefix}/chat/t/new` as const, params, ...common }
  return {
    to: `${prefix}/chat/t/$sessionId` as const,
    params: { ...params, sessionId: chat.sessionId },
    ...common,
  }
}

function checkpointOptions<K extends keyof RouteOwner>(
  kind: K,
  editor: Extract<EditorReference, { kind: 'checkpoint' }>,
  owner: RouteOwner[K],
  common: CommonOptions,
) {
  const prefix = PREFIX[kind]
  const params = { ...owner, sessionId: editor.sessionId, turns: editor.turnsToken }
  if (editor.path === null)
    return { to: `${prefix}/workbench/k/$sessionId/$turns` as const, params, ...common }
  return {
    to: `${prefix}/workbench/k/$sessionId/$turns/$` as const,
    params: { ...params, _splat: editor.path },
    ...common,
  }
}
