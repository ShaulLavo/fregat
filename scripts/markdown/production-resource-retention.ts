import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type CDPSession } from 'playwright'

import { startProductionCdp } from './production-cdp'
import { closeProductionPage, retainProductionFailure } from './production-capture-lifecycle'
import { withProductionDeadline } from './production-deadline'
import {
  observeProductionBrowserResources,
  observeProductionWorkerLifetimes,
  replaceProductionHighlightWorker,
} from './production-resource-observer'
import { serveMarkdownProductionProbe } from './production-server'
import { createScriptError } from '../structured-errors'
import { absent, listenerAbsent } from './production-cleanup'

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    out: { type: 'string' },
    port: { type: 'string', default: '5417' },
    engine: { type: 'string', multiple: true },
  },
})
if (!values.directory || !values.out)
  throw createScriptError('Retention diagnostics require build and output directories.')
const output = path.resolve(values.out)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
let gateway: Awaited<ReturnType<typeof serveMarkdownProductionProbe>> | null = null
const interrupt = () => {
  void browser.close()
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
try {
  gateway = await serveMarkdownProductionProbe(values.directory, Number(values.port))
  await writeFile(path.join(output, 'ownership.json'), JSON.stringify(gateway.resources, null, 2))
  for (const engine of values.engine ?? ['remark', 'tree-sitter'])
    await diagnose(engine, gateway.url, output)
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  const operations = await Promise.allSettled([browser.close(), gateway?.close()])
  await writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
        operations: operations.map((operation) =>
          operation.status === 'fulfilled' ? null : String(operation.reason),
        ),
        browserClosed: !browser.isConnected(),
        workspaceAbsent: gateway ? await absent(gateway.resources.workspace) : null,
        stateHomeAbsent: gateway ? await absent(gateway.resources.stateHome) : null,
        stateHome: gateway?.resources.stateHome ?? null,
        listenerStopped: gateway ? await listenerAbsent(gateway.url) : null,
      },
      null,
      2,
    ),
  )
}

async function diagnose(engine: string, url: string, output: string) {
  const directory = path.join(output, engine)
  await mkdir(directory, { recursive: true })
  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  const lifetimes = observeProductionWorkerLifetimes(page)
  let instrumentation: Awaited<ReturnType<typeof startProductionCdp>> | null = null
  let heap: CDPSession | null = null
  const rows: unknown[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    instrumentation = await startProductionCdp(page)
    heap = await context.newCDPSession(page)
    const target = new URL(url)
    target.searchParams.set('engine', engine)
    await page.goto(target.href)
    await page.evaluate(() => window.markdownProductionProbe.ready)
    await capture('initial')
    await batches('Cycle **completed**.\n\n```ts\nconst count = 42\n```', 'product')
    await batches(null, 'control')
    await batches('Cycle **completed**.\n\n```ts\nconst count = 42\n```', 'product-repeat')
    await batches(null, 'control-repeat')
    await capture('before-worker-replacement')
    rows.push({
      operation: 'worker-replacement',
      injectedFailure: 'Intentional production resource worker replacement',
    })
    const replacement = await replaceProductionHighlightWorker(page)
    rows.push({ replacement })
    await capture('after-worker-replacement')
    await page.evaluate(() => window.markdownProductionProbe.dispose())
    await capture('disposed')
    await instrumentation.finishTrace(directory)
  } catch (error) {
    await retainProductionFailure({
      page,
      directory,
      prefix: 'failure',
      diagnostic: { engine, failure: error instanceof Error ? error.message : String(error) },
      instrumentation,
    })
    throw error
  } finally {
    const detach = heap
      ? await withProductionDeadline(heap.detach(), 'resource heap session detach', 5000).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
      : null
    await closeProductionPage(page, context, instrumentation, directory)
    rows.push({ contextClosed: { workers: lifetimes.read(), errors, heapDetachFailure: detach } })
    lifetimes.close()
    await writeFile(path.join(output, `${engine}-samples.json`), JSON.stringify(rows, null, 2))
  }

  async function observe() {
    if (!instrumentation || !heap)
      throw createScriptError('Resource instrumentation is absent.', { internal: { engine } })
    return observeProductionBrowserResources(instrumentation, heap)
  }

  async function batches(source: string | null, label: string) {
    for (let index = 0; index < 6; index += 1) {
      const before = await observe()
      const resourceWindow = await withProductionDeadline(
        page.evaluate(({ source }) => window.markdownProductionProbe.resources(source, [20], 4), {
          source,
        }),
        'resource batch',
      )
      const after = await observe()
      rows.push({ label, batch: index + 1, before, after, window: resourceWindow })
      await writeFile(path.join(output, `${engine}-samples.json`), JSON.stringify(rows, null, 2))
      if (index === 1 || index === 5) await capture(`${label}-${index + 1}`)
    }
  }

  async function capture(label: string) {
    const resources = await observe()
    const file = path.join(output, `${engine}-${label}.heapsnapshot`)
    if (!heap)
      throw createScriptError('The resource heap session is absent.', {
        internal: { engine, label },
      })
    await withProductionDeadline(snapshot(heap, file), 'resource heap snapshot')
    rows.push({ snapshot: label, ...resources, file })
    process.stdout.write(JSON.stringify({ engine, snapshot: label, ...resources }) + '\n')
  }
}

async function snapshot(session: CDPSession, file: string) {
  const chunks: string[] = []
  const append = ({ chunk }: { chunk: string }) => chunks.push(chunk)
  session.on('HeapProfiler.addHeapSnapshotChunk', append)
  try {
    await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    await writeFile(file, chunks.join(''))
  } finally {
    session.off('HeapProfiler.addHeapSnapshotChunk', append)
  }
}
