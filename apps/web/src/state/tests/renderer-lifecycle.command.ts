import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { chromium, type Page } from 'playwright'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { phosphorImportPlugin } from '../../../scripts/phosphor-import-plugin.ts'
import { createScriptError } from '../../../../../scripts/structured-errors.ts'

const webRoot = path.resolve(import.meta.dirname, '../../..')
const checkoutRoot = path.resolve(webRoot, '../..')

type Observation = { boot: number; children: number }

function probe(phase: string, server = false) {
  return `import {GearIcon} from '@phosphor-icons/react';
${server ? "import {renderToStaticMarkup} from 'react-dom/server.browser';window.serverMarkup=renderToStaticMarkup;" : ''}
export function DevPage(){return <main data-phase='${phase}'><GearIcon /><span>${phase}</span></main>}`
}

async function availablePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = probe.address()
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  if (!address || typeof address === 'string')
    throw createScriptError('The renderer test requires a loopback TCP port', {
      internal: { addressType: typeof address },
    })
  return address.port
}

async function prepare(root: string) {
  const entry = await readFile(path.join(webRoot, 'src/dev-entry.tsx'), 'utf8')
  await symlink(
    path.join(webRoot, 'node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await writeFile(
    path.join(root, 'entry.tsx'),
    entry
      .replace("import '@workspace/ui/globals.css'", '')
      .replace("from '@/features/dev/components/page'", "from './probe'"),
  )
  await writeFile(path.join(root, 'probe.tsx'), probe('before'))
  await writeFile(
    path.join(root, 'index.html'),
    `<div id='root'></div><script type='module'>
import.meta.hot.on('vite:beforeFullReload',()=>queueMicrotask(()=>console.debug('ROOT_CLOSED '+JSON.stringify({boot:performance.timeOrigin,children:document.getElementById('root').childElementCount}))));
</script><script type='module' src='/entry.tsx'></script>`,
  )
}

function optimizerGate() {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let held = false
  const plugin: Plugin = {
    name: 'renderer-test-stock-optimizer-gate',
    buildStart(options) {
      if (held || !JSON.stringify(options.input).includes('server.browser')) return
      held = true
      entered.resolve()
      return release.promise
    },
  }
  return { plugin, entered: entered.promise, release: release.resolve }
}

function observe(page: Page) {
  const errors: string[] = []
  const consoleErrors: string[] = []
  const failedResponses: number[] = []
  const closures: Observation[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(response.status())
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
    if (!message.text().startsWith('ROOT_CLOSED ')) return
    const row: unknown = JSON.parse(message.text().slice(12))
    if (typeof row !== 'object' || row === null || !('boot' in row) || !('children' in row)) return
    if (typeof row.boot === 'number' && typeof row.children === 'number')
      closures.push({ boot: row.boot, children: row.children })
  })
  return { errors, consoleErrors, failedResponses, closures }
}

function requireHealthy(observed: ReturnType<typeof observe>) {
  const problems = [...observed.errors, ...observed.consoleErrors]
  if (!problems.length && !observed.failedResponses.length) return
  throw createScriptError('The renderer reload test observed a browser failure', {
    internal: {
      pageErrorCount: observed.errors.length,
      consoleErrorCount: observed.consoleErrors.length,
      failedResponseCount: observed.failedResponses.length,
    },
  })
}

function requireDisposed(closures: readonly Observation[], boot: number) {
  if (closures.some((row) => row.boot === boot && row.children === 0)) return
  throw createScriptError('The old renderer remained mounted during a full reload', {
    internal: { observationCount: closures.length },
  })
}

async function runBoundary(server: ViteDevServer) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const observed = observe(page)
    const origin = `http://127.0.0.1:${server.config.server.port}`
    await page.goto(origin)
    await page.locator('[data-phase="before"] svg path').waitFor()
    const boot = await page.evaluate(() => performance.timeOrigin)
    requireHealthy(observed)
    return { page, observed, boot, browser }
  } catch (cause) {
    await browser.close()
    throw cause
  }
}

export async function rendererLifecycleControl() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fregat-renderer-'))
  const gate = optimizerGate()
  let server: ViteDevServer | undefined
  let browser: Awaited<ReturnType<typeof runBoundary>>['browser'] | undefined
  try {
    await prepare(root)
    server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, 'cache'),
      plugins: [react({ compiler: true }), phosphorImportPlugin()],
      resolve: {
        alias: { '@': path.join(webRoot, 'src') },
        dedupe: ['react', 'react-dom'],
      },
      optimizeDeps: {
        entries: [path.join(webRoot, 'src/main.tsx'), path.join(root, 'entry.tsx')],
        rolldownOptions: { plugins: [gate.plugin] },
      },
      server: {
        host: '127.0.0.1',
        port: await availablePort(),
        strictPort: true,
        fs: { allow: [root, checkoutRoot] },
      },
    })
    await server.listen()
    const running = await runBoundary(server)
    browser = running.browser
    await writeFile(path.join(root, 'probe.tsx'), probe('held', true))
    const failed = running.page.waitForEvent('pageerror').then((cause) => {
      throw cause
    })
    void failed.catch(() => undefined)
    await Promise.race([gate.entered, failed])
    await writeFile(path.join(root, 'probe.tsx'), probe('after', true))
    gate.release()
    await running.page.waitForFunction(
      (before) =>
        performance.timeOrigin !== before &&
        document.querySelector('[data-phase]')?.getAttribute('data-phase') === 'after',
      running.boot,
    )
    await running.page.locator('[data-phase="after"] svg path').waitFor()
    requireHealthy(running.observed)
    requireDisposed(running.observed.closures, running.boot)
    return { oldRootDisposed: true, newDocumentHealthy: true }
  } finally {
    gate.release()
    await browser?.close()
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
}
