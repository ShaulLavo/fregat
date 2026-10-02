import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { cpus, platform, release, totalmem, arch } from 'node:os'
import { dirname, resolve, sep, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { externalReceipt } from './package-set.mjs'
import { recordModules, verifyRuntimeGraph } from './runtime-graph.mjs'
import { installInputWorkerProof } from './input-worker-proof.mjs'
import { fail } from './errors.mjs'
import { inputSourceIdentity } from './input-identity.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()

export async function inputExecutionReceipt(directory = root) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  const seeds = [
    ...new Set([
      ...Object.keys(manifest.devDependencies ?? {}),
      '@shikijs/langs',
      '@shikijs/themes',
    ]),
  ].map((name) => ({ from: directory, name }))
  return externalReceipt(dirname(directory), [basename(directory)], seeds, { includePeers: true })
}

export async function inputInstrument(launch = { runner: process.version }) {
  const receipt = await inputExecutionReceipt()
  const files = git(
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'examples/stress',
    'examples/app/tsconfig.json',
    'tsconfig.json',
  )
    .split('\n')
    .filter(
      (file) =>
        existsSync(resolve(repository, file)) &&
        !file.includes('/test/') &&
        !file.includes('/results/') &&
        /\.(?:[cm]?[jt]sx?|css|html|json)$/.test(file),
    )
    .sort()
  const sources = await Promise.all(
    files.map(async (path) => ({ path, bytes: await readFile(resolve(repository, path)) })),
  )
  return {
    ...inputSourceIdentity(sources, receipt.sha256, launch),
    receipt,
    files,
    sources,
    launch,
  }
}

async function captureInputBuildRoot(directory, sources) {
  const snapshot = resolve(dirname(directory), `${basename(directory)}-instrument`)
  await mkdir(snapshot)
  for (const source of sources) {
    const path = resolve(snapshot, source.path)
    if (!path.startsWith(snapshot + sep)) fail('Instrument source escapes its snapshot')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, source.bytes)
  }
  const buildRoot = resolve(snapshot, 'examples/stress')
  await symlink(resolve(root, 'node_modules'), resolve(buildRoot, 'node_modules'), 'dir')
  return buildRoot
}

export async function buildInputRuntime(packageSet, directory, fixtures, manifest, instrument) {
  const buildRoot = await captureInputBuildRoot(directory, instrument.sources)
  const modules = new Set()
  await build({
    root: buildRoot,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: packageSet.aliases },
    plugins: [recordModules(modules)],
    worker: { format: 'es', plugins: () => [recordModules(modules)] },
    build: { outDir: directory, emptyOutDir: true, sourcemap: 'hidden' },
  })
  const runtimeGraph = await verifyRuntimeGraph({
    ids: modules,
    outDir: directory,
    instrumentRoot: buildRoot,
    packageSetDirectory: packageSet.directory,
    receiptRoots: [...packageSet.manifest.external.packages, ...instrument.receipt.packages].map(
      (entry) => entry.root,
    ),
  })
  if (runtimeGraph.escaped.length)
    fail(`Bundled runtime code escapes frozen receipts: ${runtimeGraph.escaped.join(', ')}`)
  await mkdir(resolve(directory, 'frozen-fixtures'))
  for (const fixture of manifest.fixtures)
    await cp(
      resolve(fixtures, `${fixture.id}.txt`),
      resolve(directory, 'frozen-fixtures', `${fixture.id}.txt`),
    )
  return { packageSet, directory, runtimeGraph }
}

export function inputEnvironment(browser, runtime, instrument) {
  const set = runtime.packageSet
  return {
    commit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain')),
    instrumentHash: instrument.hash,
    measurementHash: instrument.measurementHash,
    validationHash: instrument.validationHash,
    instrumentExternal: instrument.receipt.sha256,
    sourceHash: createHash('sha256').update(instrument.hash).update(set.sourceHash).digest('hex'),
    packageSet: {
      manifest: set.manifest,
      sourceHash: set.sourceHash,
      buildHash: set.buildHash,
      externalHash: set.externalHash,
    },
    runtimeGraph: runtime.runtimeGraph,
    browser: { engine: 'chromium', version: browser.version(), headless: true },
    hardware: {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      architecture: arch(),
      platform: platform(),
      release: release(),
    },
    runtime: process.version,
  }
}

export async function inputPage(browser, runtime, consumers) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  try {
    await context.route('**/*', (route) => inputAsset(route, runtime.directory))
    const page = await context.newPage()
    if (consumers !== 'native') await page.addInitScript(installInputWorkerProof, null)
    page.setDefaultTimeout(30_000)
    await page.goto('http://localhost:4173/', { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(globalThis.__stress))
    await page.evaluate(() => document.fonts.ready)
    const cdp = await context.newCDPSession(page)
    return { page, context, cdp }
  } catch (error) {
    await context.close()
    throw error
  }
}

async function inputAsset(route, directory) {
  const url = new URL(route.request().url())
  const path = resolve(
    directory,
    '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
  )
  if (!path.startsWith(directory + sep)) return route.abort()
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
  }
  try {
    await route.fulfill({
      body: await readFile(path),
      contentType: types[extname(path)] ?? 'application/octet-stream',
    })
  } catch {
    await route.fulfill({ status: 404, body: `Missing benchmark asset: ${url.pathname}` })
  }
}

export async function inputMemory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  return {
    usedBytes: heap.usedSize,
    totalBytes: heap.totalSize,
    ...(await cdp.send('Memory.getDOMCounters')),
  }
}
