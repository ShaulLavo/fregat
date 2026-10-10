import { statSync } from 'node:fs'
import path from 'node:path'
import { Elysia, t } from 'elysia'
import * as v from 'valibot'
import { htmlBootstrapUrlSchema, type EnvironmentId } from '@workspace/contracts'

import { FsError } from '../fs/errors'
import type { ServerUpdate } from '../update/service'
import type { TerminalService } from '../terminal/service'
import { readReleaseDescriptor, releaseFileFor } from './release'
import { webErrors } from './structured-errors'
import type { AuthConfig } from '../auth'
import { isCorsOriginAllowed } from '../auth'
import { requestHeaderReader } from '../devices/trust'
import type { SettingsStore } from '../settings/store'
import type { PaletteLibrary } from '../themes/palette-library'
import {
  createAppearanceBootstrap,
  documentBackdrop,
  type AppearanceBootstrap,
} from './appearance-bootstrap'
import { renderHtmlBootstrap } from './html-bootstrap'

export type WebOptions = {
  /** The release's built `web/` directory. Unset serves the API alone. */
  root?: string
  /** The `build-config.json` of the running server bundle, if it has one. */
  serverReleaseFile?: string
  /** Vite sends transformed development documents through the Bun renderer. */
  bootstrapDevelopment?: boolean
}

type WebBootstrapContext = {
  readonly auth: AuthConfig
  readonly settings: Pick<SettingsStore, 'snapshot'>
  readonly palettes: Pick<PaletteLibrary, 'read'>
  readonly environmentId: EnvironmentId
  readonly webBase: string
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

// Public routes: the page and its files load before any origin is known, so
// this plugin is mounted ahead of the auth guard and serves nothing but the
// release directory.
export function webRoutes(
  options: WebOptions,
  update: Pick<ServerUpdate, 'reread' | 'busySessions'>,
  terminal: Pick<TerminalService, 'hostInfo'>,
  bootstrap: WebBootstrapContext,
) {
  const routes = new Elysia({ name: 'web-routes' }).get('/release', ({ set }) => {
    set.headers['cache-control'] = 'no-store'
    return releaseDescriptor(options, update, terminal)
  })
  if (options.bootstrapDevelopment)
    routes.post(
      '/web/bootstrap',
      async ({ request, body }) => {
        const origin = request.headers.get('origin')
        if (!isCorsOriginAllowed(bootstrap.auth, origin)) {
          throw webErrors.BOOTSTRAP_ORIGIN_INVALID({ internal: { stage: 'origin' } })
        }
        const apiBase = body.apiBase ?? requestApiBase(request, bootstrap)
        const parsed = v.safeParse(htmlBootstrapUrlSchema, apiBase)
        if (
          !parsed.success ||
          (new URL(parsed.output).origin !== new URL(request.url).origin &&
            !isCorsOriginAllowed(bootstrap.auth, new URL(parsed.output).origin))
        ) {
          throw webErrors.BOOTSTRAP_ORIGIN_INVALID({ internal: { stage: 'api-base' } })
        }
        return renderHtmlBootstrap(
          new Response(body.html),
          await appearanceFor(request, bootstrap, parsed.output),
        )
      },
      { body: t.Object({ html: t.String(), apiBase: t.Optional(t.String()) }) },
    )
  const root = options.root
  if (!root) return routes

  assertWebRoot(root)
  const index = path.join(root, 'index.html')
  return routes
    .get('/', ({ request }) => document(index, request, bootstrap))
    .get('/*', ({ request }) => webFile(root, request, bootstrap))
}

// Re-reads `pending` on every call, so a deploy's missed signal heals on the next poll.
async function releaseDescriptor(
  options: WebOptions,
  update: Pick<ServerUpdate, 'reread' | 'busySessions'>,
  terminal: Pick<TerminalService, 'hostInfo'>,
) {
  const [current, server] = await Promise.all([
    readReleaseDescriptor(options.root ? releaseFileFor(options.root) : undefined),
    readReleaseDescriptor(options.serverReleaseFile),
  ])
  return {
    ...current.info,
    server: server.info,
    liveCheckRequired: current.liveCheckRequired,
    terminalHost: terminal.hostInfo(),
    ...update.reread('release'),
    busy: update.busySessions(),
  }
}

function webFile(root: string, request: Request, bootstrap: WebBootstrapContext) {
  const pathname = decodedPathname(request)
  if (pathname === '/licenses')
    return new Response(null, { status: 308, headers: { location: 'licenses/' } })
  if (pathname === '/licenses/server.txt') {
    const notice = path.resolve(root, '../server/THIRD_PARTY_NOTICES.txt')
    if (isFile(notice)) return staticFile(notice, pathname)
  }
  const file = releaseFile(root, pathname)
  if (file)
    return isAppDocument(pathname) ? document(file, request, bootstrap) : staticFile(file, pathname)
  const page = isDocumentNavigation(request) ? documentFor(root, pathname) : null
  if (page)
    return page === path.join(root, 'index.html') || page === path.join(root, 'dev.html')
      ? document(page, request, bootstrap)
      : staticFile(page, pathname)

  throw new FsError('ROUTE_NOT_FOUND')
}

async function document(index: string, request: Request, bootstrap: WebBootstrapContext) {
  return renderHtmlBootstrap(
    new Response(Bun.file(index), {
      headers: { 'cache-control': REVALIDATE, 'content-type': 'text/html; charset=utf-8' },
    }),
    await appearanceFor(request, bootstrap, documentApiBase(request, bootstrap)),
  )
}

function isAppDocument(pathname: string) {
  return pathname === '/index.html' || pathname === '/dev.html'
}

async function appearanceFor(
  request: Request,
  context: WebBootstrapContext,
  apiBase: string,
): Promise<AppearanceBootstrap> {
  if (context.auth.devices && !context.auth.devices.allows(requestHeaderReader(request))) {
    return { payload: { version: 1, kind: 'pairing' }, paletteCSS: '' }
  }
  return createAppearanceBootstrap({
    snapshot: context.settings.snapshot(),
    environmentId: context.environmentId,
    apiBase,
    backdrop: documentBackdrop(request.headers),
    palettes: context.palettes,
  })
}

function documentApiBase(request: Request, context: Pick<WebBootstrapContext, 'auth' | 'webBase'>) {
  const apiBase = requestApiBase(request, context)
  if (!isCorsOriginAllowed(context.auth, new URL(apiBase).origin)) {
    throw webErrors.BOOTSTRAP_DOCUMENT_ORIGIN_INVALID({ internal: { stage: 'document-origin' } })
  }
  return apiBase
}

function requestApiBase(request: Request, context: Pick<WebBootstrapContext, 'auth' | 'webBase'>) {
  const scheme = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('x-forwarded-host')
  if (scheme === null && host === null) return new URL(context.webBase, request.url).href
  if ((scheme !== 'http' && scheme !== 'https') || !host || /[\s,\\/@?#]/u.test(host)) {
    throw webErrors.BOOTSTRAP_PROXY_INVALID({ internal: { stage: 'forwarded-format' } })
  }
  const forwarded = URL.parse(`${scheme}://${host}`)
  if (!forwarded || !isCorsOriginAllowed(context.auth, forwarded.origin)) {
    throw webErrors.BOOTSTRAP_PROXY_INVALID({ internal: { stage: 'forwarded-origin' } })
  }
  return new URL(context.webBase, forwarded).href
}

function staticFile(file: string, pathname: string) {
  const cacheControl = pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE
  return new Response(Bun.file(file), { headers: { 'cache-control': cacheControl } })
}

// A release file, or null when the path leaves the root or is not a file.
function releaseFile(root: string, pathname: string) {
  if (pathname.includes('\0')) return null

  const resolved = path.resolve(root, `.${pathname}`)
  if (!resolved.startsWith(root + path.sep)) return null
  if (!isFile(resolved)) return null

  return resolved
}

function decodedPathname(request: Request) {
  const pathname = new URL(request.url).pathname
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function isDocumentNavigation(request: Request) {
  const dest = request.headers.get('sec-fetch-dest')
  if (dest) return dest === 'document'

  return request.headers.get('accept')?.includes('text/html') ?? false
}

// The frontend owns `/`, local workspaces under `/~`, remote ones under `/@` and the pairing link
// `/pair` (its code rides in the fragment); the dev gallery owns `/dev`, when the release carries it.
function documentFor(root: string, pathname: string) {
  if (
    pathname === '/' ||
    pathname === '/pair' ||
    pathname.startsWith('/~') ||
    pathname.startsWith('/@')
  )
    return path.join(root, 'index.html')
  if (pathname === '/licenses/') return releaseFile(root, '/licenses/index.html')
  if (pathname === '/dev' || pathname.startsWith('/dev/')) return releaseFile(root, '/dev.html')

  return null
}

function isFile(file: string) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function assertWebRoot(root: string) {
  try {
    if (statSync(root).isDirectory()) return
  } catch {
    // Reported below with the path.
  }

  throw webErrors.ROOT_MISSING({ root })
}
