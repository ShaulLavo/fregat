import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(process.argv[2])
const port = Number(process.argv[3])
assert(Number.isInteger(port) && port > 0, 'Provide an explicit port')
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const file = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '')
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end()
    return
  }
  try {
    const content = await readFile(file)
    response
      .writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(content)
  } catch {
    response.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`Static embed server on http://127.0.0.1:${port}`))
