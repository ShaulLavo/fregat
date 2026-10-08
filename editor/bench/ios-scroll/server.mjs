// Optional private Mesh collector. Static hosts still support JSON copy and download.
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const portArgument = process.argv.indexOf('--port')
const port = Number(process.argv[portArgument + 1])
if (portArgument < 0 || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new TypeError('Pass an explicit --port')
const results = resolve(root, 'results')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}
Bun.serve({
  port,
  hostname: '127.0.0.1',
  maxRequestBodySize: 3 * 1024 * 1024,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/api/results' && request.method === 'POST') {
      let run
      try {
        run = await request.json()
      } catch {
        return new Response('Invalid JSON', { status: 400 })
      }
      if (
        run?.schema !== 1 ||
        typeof run.id !== 'string' ||
        !Array.isArray(run.frames) ||
        !Array.isArray(run.events)
      )
        return new Response('Invalid run', { status: 400 })
      await mkdir(results, { recursive: true })
      const id = crypto.randomUUID()
      await writeFile(resolve(results, `${id}.json`), JSON.stringify(run))
      return Response.json({ saved: id })
    }
    if (url.pathname === '/api/results' && request.method === 'GET') {
      const files = await readdir(results).catch(() => [])
      const runs = await Promise.all(
        files
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => JSON.parse(await readFile(resolve(results, name), 'utf8'))),
      )
      return Response.json(runs)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method unavailable', { status: 405 })
    let path
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return new Response('Invalid path', { status: 400 })
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path))
    if (
      !file.startsWith(root + '/') ||
      file.startsWith(results + '/') ||
      file === resolve(root, 'server.mjs')
    )
      return new Response('File unavailable', { status: 404 })
    const content = Bun.file(file)
    if (!(await content.exists())) return new Response('File unavailable', { status: 404 })
    return new Response(content, {
      headers: {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      },
    })
  },
})
console.log(`Probe on http://127.0.0.1:${port}`)
