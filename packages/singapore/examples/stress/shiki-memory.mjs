import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { fail } from './errors.mjs'
const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: { output: { type: 'string' }, sizes: { type: 'string', default: '1048576,5242880' } },
})
if (!values.output) fail('--output is required')
// NOT-PORTABLE: mkdtemp requires /work/tmp, which this script does not create.
const directory = await mkdtemp('/work/tmp/editor-shiki-memory-')
let browser
const result = { samples: [] }
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    build: { outDir: directory, rolldownOptions: { input: resolve(root, 'shiki-memory.html') } },
  })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  result.browser = browser.version()
  for (const size of values.sizes.split(',').map(Number)) result.samples.push(await sample(size))
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}
async function sample(size) {
  const context = await browser.newContext()
  try {
    await context.route('http://shiki.local/**', async (route) => {
      const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
      if (!path.startsWith(directory + sep)) return route.abort()
      await route.fulfill({
        body: await readFile(path),
        contentType:
          { '.html': 'text/html', '.js': 'text/javascript' }[extname(path)] ??
          'application/octet-stream',
      })
    })
    const page = await context.newPage()
    await page.goto('http://shiki.local/shiki-memory.html')
    const cdp = await context.newCDPSession(page)
    const before = await heap(cdp)
    const measurement = await page.evaluate((size) => __shikiMemory.run(size), size)
    const retained = await heap(cdp)
    await page.evaluate(() => __shikiMemory.dispose())
    const disposed = await heap(cdp)
    const row = { size, measurement, before, retained, disposed }
    console.log(JSON.stringify(row))
    return row
  } finally {
    await context.close()
  }
}
async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return cdp.send('Runtime.getHeapUsage')
}
