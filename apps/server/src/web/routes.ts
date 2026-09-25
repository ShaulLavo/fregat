import { statSync } from 'node:fs'
import path from 'node:path'
import { Elysia } from 'elysia'

import { FsError } from '../fs/errors'
import type { ServerUpdate } from '../update/service'
import type { TerminalService } from '../terminal/service'
import { readReleaseInfo, releaseFileFor } from './release'
import { webErrors } from './structured-errors'

export type WebOptions = {
  /** The release's built `web/` directory. Unset serves the API alone. */
  root?: string
  /** The `build-config.json` of the running server bundle, if it has one. */
  serverReleaseFile?: string
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

// Public routes: the page and its files load before any origin is known, so
// this plugin is mounted ahead of the auth guard and serves nothing but the
// release directory.
export function webRoutes(
  options: WebOptions,
  update: Pick<ServerUpdate, 'reread'>,
  terminal: Pick<TerminalService, 'hostInfo'>,
) {
  const routes = new Elysia({ name: 'web-routes' }).get('/release', () =>
    releaseDescriptor(options, update, terminal),
  )
  const root = options.root
  if (!root) return routes

  assertWebRoot(root)
  const index = path.join(root, 'index.html')
  return routes.get('/', () => document(index)).get('/*', ({ request }) => webFile(root, request))
}

// Re-reads `pending` on every call, so a deploy's missed signal heals on the next poll.
async function releaseDescriptor(
  options: WebOptions,
  update: Pick<ServerUpdate, 'reread'>,
  terminal: Pick<TerminalService, 'hostInfo'>,
) {
  const [current, server] = await Promise.all([
    readReleaseInfo(options.root ? releaseFileFor(options.root) : undefined),
    readReleaseInfo(options.serverReleaseFile),
  ])
  return { ...current, server, terminalHost: terminal.hostInfo(), ...update.reread('release') }
}

function webFile(root: string, request: Request) {
  const pathname = decodedPathname(request)
  const file = releaseFile(root, pathname)
  if (file) return staticFile(file, pathname)
  const page = isDocumentNavigation(request) ? documentFor(root, pathname) : null
  if (page) return document(page)

  throw new FsError('ROUTE_NOT_FOUND')
}

function document(index: string) {
  return new Response(Bun.file(index), {
    headers: { 'cache-control': REVALIDATE, 'content-type': 'text/html; charset=utf-8' },
  })
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

// The frontend owns `/`, local workspaces under `/~` and remote ones under `/@`;
// the dev gallery owns `/dev`, when the release carries it.
function documentFor(root: string, pathname: string) {
  if (pathname === '/' || pathname.startsWith('/~') || pathname.startsWith('/@'))
    return path.join(root, 'index.html')
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
