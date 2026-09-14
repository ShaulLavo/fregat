import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

const contentTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

export function demoPreviewPlugin(webRoot: string): Plugin {
  const siteRoot = path.resolve(webRoot, '../site/dist')
  const worker = createRequire(path.join(webRoot, 'package.json')).resolve(
    'msw/mockServiceWorker.js',
  )
  return {
    name: 'fregat-demo-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const file = previewFile(pathname, siteRoot, worker)
        if (!file) return next()
        const info = await stat(file).catch(() => null)
        if (!info?.isFile()) return next()
        response.setHeader(
          'Content-Type',
          contentTypes[path.extname(file)] ?? 'application/octet-stream',
        )
        response.setHeader('Cache-Control', 'no-store')
        createReadStream(file).on('error', next).pipe(response)
      })
    },
  }
}

function previewFile(pathname: string, root: string, worker: string): string | null {
  if (pathname === '/mockServiceWorker.js') return worker
  if (pathname !== '/fregat' && !pathname.startsWith('/fregat/')) return null
  let relative: string
  try {
    relative = decodeURIComponent(pathname.slice('/fregat'.length))
  } catch {
    return null
  }
  const target = path.resolve(
    root,
    `.${relative || '/'}`,
    pathname.endsWith('/') || !relative ? 'index.html' : '',
  )
  return target.startsWith(`${root}${path.sep}`) ? target : null
}
