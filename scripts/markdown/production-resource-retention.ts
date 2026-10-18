import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type CDPSession, type Page } from 'playwright'

import { startProductionCdp } from './production-cdp'
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
  await browser.close()
  await gateway?.close()
  await writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
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
  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  const instrumentation = await startProductionCdp(page)
  const heap = await context.newCDPSession(page)
  const rows: unknown[] = []
  try {
    const target = new URL(url)
    target.searchParams.set('engine', engine)
    await page.goto(target.href)
    await page.evaluate(() => window.markdownProductionProbe.ready)
    await capture('initial')
    await batches(page, 'Cycle **completed**.\n\n```ts\nconst count = 42\n```', 'product')
    await batches(page, null, 'control')
    await batches(page, 'Cycle **completed**.\n\n```ts\nconst count = 42\n```', 'product-repeat')
    await batches(page, null, 'control-repeat')
    await page.evaluate(() => window.markdownProductionProbe.dispose())
    await capture('disposed')
    const traceDirectory = path.join(output, `${engine}-trace`)
    await mkdir(traceDirectory, { recursive: true })
    await instrumentation.finishTrace(traceDirectory)
  } finally {
    await writeFile(path.join(output, `${engine}-samples.json`), JSON.stringify(rows, null, 2))
    await heap.detach()
    await instrumentation.close()
    await context.close()
  }

  async function batches(page: Page, source: string | null, label: string) {
    for (let index = 0; index < 6; index += 1) {
      const before = await instrumentation.collect()
      const resourceWindow = await page.evaluate(
        ({ source }) => window.markdownProductionProbe.resources(source, [20], 4),
        { source },
      )
      const after = await instrumentation.collect()
      rows.push({ label, batch: index + 1, before, after, window: resourceWindow })
      if (index === 1 || index === 5) await capture(`${label}-${index + 1}`)
    }
  }

  async function capture(label: string) {
    const metrics = await instrumentation.collect()
    const file = path.join(output, `${engine}-${label}.heapsnapshot`)
    await snapshot(heap, file)
    rows.push({ snapshot: label, metrics, file })
    process.stdout.write(
      JSON.stringify({ engine, snapshot: label, heap: metrics.jsHeapUsedBytes }) + '\n',
    )
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
