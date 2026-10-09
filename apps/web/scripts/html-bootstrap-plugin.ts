import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { createScriptError } from '../../../scripts/structured-errors'

/** Loopback verification requests bind HTML production to their isolated Bun API. */
export const BOOTSTRAP_API_HEADER = 'x-fregat-bootstrap-api'

export function htmlBootstrapPlugin(apiBase: string): Plugin {
  return {
    name: 'fregat-html-bootstrap',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (request.method !== 'GET' || !documentRequest(request) || !appDocument(url.pathname))
          return next()
        void renderDocument(server, request, response, apiBase).catch(next)
      })
    },
  }
}

async function renderDocument(
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
  configuredApi: string,
) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const source = await readFile(
    path.join(server.config.root, galleryDocument(url.pathname) ? 'dev.html' : 'index.html'),
    'utf8',
  )
  const html = await server.transformIndexHtml(request.url ?? '/', source)
  const api = requestApi(request, configuredApi)
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const name of ['cookie', 'user-agent', 'sec-ch-ua-platform', 'x-forwarded-for']) {
    const value = request.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }
  headers.set(
    'origin',
    developmentDocumentOrigin(request.headers, Boolean(server.config.server.https)),
  )
  const rendered = await fetch(`${api.replace(/\/+$/u, '')}/web/bootstrap`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ html, apiBase: api }),
  })
  response.statusCode = rendered.status
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'private, no-store')
  response.end(Buffer.from(await rendered.arrayBuffer()))
}

function requestApi(request: IncomingMessage, configuredApi: string) {
  const fixture = request.headers[BOOTSTRAP_API_HEADER]
  if (typeof fixture !== 'string') return configuredApi
  const api = URL.parse(fixture)
  const peer = request.socket.remoteAddress
  const forwarded = request.headers['x-forwarded-for']
  if (
    !api ||
    api.protocol !== 'http:' ||
    !loopback(api.hostname) ||
    api.pathname !== '/' ||
    api.search ||
    api.hash ||
    api.username ||
    api.password ||
    !loopback(peer) ||
    forwarded
  ) {
    throw createScriptError('The isolated HTML bootstrap requires a direct loopback API.', {
      internal: { stage: 'fixture-document' },
    })
  }
  return api.origin
}

export function developmentDocumentOrigin(headers: IncomingHttpHeaders, secure: boolean) {
  const forwardedHost = headers['x-forwarded-host']
  const forwardedProto = headers['x-forwarded-proto']
  const forwarded = forwardedHost !== undefined || forwardedProto !== undefined
  const host = forwarded ? forwardedHost : headers.host
  const protocol = forwarded ? forwardedProto : secure ? 'https' : 'http'
  const origin =
    typeof host === 'string' && typeof protocol === 'string'
      ? URL.parse(`${protocol}://${host}`)
      : null
  if (
    !origin ||
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    typeof host !== 'string' ||
    host.includes(',')
  ) {
    throw createScriptError('The development document has invalid origin metadata.', {
      internal: { stage: 'document-origin' },
    })
  }
  return origin.origin
}

function loopback(address: string | undefined) {
  return (
    address === 'localhost' ||
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '[::1]' ||
    address === '::ffff:127.0.0.1'
  )
}

function documentRequest(request: IncomingMessage) {
  const destination = request.headers['sec-fetch-dest']
  if (destination) return destination === 'document'
  return request.headers.accept?.includes('text/html') ?? false
}

function appDocument(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/pair' ||
    pathname.startsWith('/~') ||
    pathname.startsWith('/@') ||
    galleryDocument(pathname)
  )
}

function galleryDocument(pathname: string) {
  return pathname === '/dev' || pathname === '/dev.html' || pathname.startsWith('/dev/')
}
