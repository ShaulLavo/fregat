import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { createScriptError } from '../structured-errors.ts'

export async function serveMarkdownProductionProbe(directory: string, port: number) {
  const root = path.resolve(directory)
  const { makeTestServer } = await import('../../apps/web/test/server.ts')
  const { TEST_ENVIRONMENT_ID } = await import('../../apps/web/test/factories/chat.ts')
  const fixture = await makeTestServer({
    filesystemWatch: false,
    environmentId: TEST_ENVIRONMENT_ID,
  })
  let closed = false
  const server = await startFixtureGateway(root, port, fixture)
  async function close() {
    if (closed) return
    closed = true
    await server.stop(true)
    await fixture.cleanup()
  }
  return {
    url: `http://127.0.0.1:${server.port}/test/markdown-production.html`,
    resources: { port: server.port, workspace: fixture.root, stateHome: fixture.stateHome },
    close,
  }
}

async function startFixtureGateway(
  root: string,
  port: number,
  fixture: Awaited<ReturnType<typeof import('../../apps/web/test/server.ts').makeTestServer>>,
) {
  try {
    return Bun.serve({
      hostname: '127.0.0.1',
      port,
      idleTimeout: 0,
      fetch: (request) => productionRequest(root, request, fixture.app.handle),
    })
  } catch (error) {
    await fixture.cleanup()
    throw error
  }
}

async function productionRequest(
  root: string,
  request: Request,
  handle: (request: Request) => Response | Promise<Response>,
) {
  const asset = path.resolve(root, `.${new URL(request.url).pathname}`)
  if (asset.startsWith(root + path.sep)) {
    const file = Bun.file(asset)
    if (await file.exists())
      return new Response(file, { headers: { 'cache-control': 'public, max-age=3600' } })
  }
  const { TEST_ORIGIN } = await import('../../apps/web/test/server.ts')
  const headers = new Headers(request.headers)
  headers.set('origin', TEST_ORIGIN)
  return handle(new Request(request, { headers }))
}

async function main() {
  const { values } = parseArgs({
    options: { directory: { type: 'string' }, port: { type: 'string' } },
  })
  if (!values.directory)
    throw createScriptError('Choose a production probe build directory.', {
      internal: { directoryProvided: false },
    })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw createScriptError('The production probe port is invalid.', { internal: { port } })
  const done = Promise.withResolvers<void>()
  const stop = () => done.resolve()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let started: Awaited<ReturnType<typeof serveMarkdownProductionProbe>> | null = null
  try {
    started = await serveMarkdownProductionProbe(values.directory, port)
    process.stdout.write(JSON.stringify({ url: started.url }) + '\n')
    await done.promise
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await started?.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
