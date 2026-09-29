import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage } from './core-package.mjs'
import { fail } from './errors.mjs'

// E036 candidate 5: CPU the whole browser spends while a focused editor sits idle with its caret
// blinking, as the CSS steps() animation, as a JS interval toggling opacity, and not blinking.
const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    seconds: { type: 'string', default: '20' },
    rounds: { type: 'string', default: '3' },
    headed: { type: 'boolean', default: false },
    'core-directory': { type: 'string', default: resolve(root, '../../packages/editor') },
  },
})
if (!values.output) fail('--output is required')
const seconds = Number(values.seconds)
const rounds = Number(values.rounds)
const variants = ['css', 'interval', 'none']
const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }))

await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-e036-blink-')
const core = await loadCorePackage(values['core-directory'])
let server
const result = { seconds, rounds, headed: values.headed, samples: [] }
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: core.aliases },
    worker: { format: 'es' },
    build: { outDir: directory, rolldownOptions: { input: resolve(root, 'geometry.html') } },
  })
  server = await chromium.launchServer({
    headless: !values.headed,
    channel: values.headed ? undefined : 'chromium',
    env: { ...process.env, TMPDIR: directory },
  })
  const browser = await chromium.connect(server.wsEndpoint())
  result.browser = browser.version()
  for (let round = 0; round < rounds; round++)
    for (const variant of rotate(variants, round))
      result.samples.push(await sample(browser, server.process().pid, variant, round))
  result.gpu = await gpuFlags(server.process().pid)
  result.summary = summarize(result.samples)
  console.log(JSON.stringify(result.summary))
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
} finally {
  await server?.close()
  await rm(directory, { recursive: true, force: true })
}

/** The GPU process's GL/ANGLE flags, which say whether compositing ran on hardware. */
async function gpuFlags(rootPid) {
  for (const pid of (await processTicks(rootPid)).keys()) {
    if ((await processType(pid)) !== 'gpu-process') continue
    const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8')
    return cmdline.split('\0').filter((flag) => /gl|angle|gpu|vulkan|ozone/i.test(flag))
  }
  return null
}

function rotate(list, by) {
  return list.map((_, index) => list[(index + by) % list.length])
}

async function asset(route) {
  const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
  if (!path.startsWith(directory + sep)) return route.abort()
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  await route.fulfill({
    body: await readFile(path),
    contentType: types[extname(path)] ?? 'application/octet-stream',
  })
}

/** Chromium's `--type=` for a process, `browser` for the root. */
async function processType(pid) {
  const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
  return /--type=([\w-]+)/.exec(cmdline)?.[1] ?? 'browser'
}

/** CPU ticks of the browser process and every descendant, keyed by pid. */
async function processTicks(rootPid) {
  const children = new Map()
  const ticks = new Map()
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const stat = await readFile(`/proc/${entry}/stat`, 'utf8').catch(() => null)
    if (!stat) continue
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const parent = Number(fields[1])
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(Number(entry))
    ticks.set(Number(entry), Number(fields[11]) + Number(fields[12]))
  }
  const owned = new Map()
  const queue = [rootPid]
  while (queue.length) {
    const pid = queue.pop()
    if (ticks.has(pid)) owned.set(pid, ticks.get(pid))
    queue.push(...(children.get(pid) ?? []))
  }
  return owned
}

async function cpuSeconds(before, after) {
  const byType = {}
  let total = 0
  for (const [pid, value] of after) {
    const delta = (value - (before.get(pid) ?? 0)) / ticksPerSecond
    const type = await processType(pid)
    byType[type] = Math.round(((byType[type] ?? 0) + delta) * 100) / 100
    total += delta
  }
  return { total, byType }
}

async function sample(browser, rootPid, variant, round) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  try {
    await context.route('http://geometry.local/**', asset)
    const page = await context.newPage()
    await page.goto('http://geometry.local/geometry.html')
    await page.evaluate(() => __geometry.open('go-spaces', false))
    await page.evaluate(() => __geometry.settle())
    await page.mouse.click(300, 90)
    await page.evaluate((variant) => {
      if (variant === 'css') return
      const style = document.createElement('style')
      style.textContent = '.editor-virtualized-caret-layer { animation: none !important; }'
      document.head.append(style)
      if (variant === 'none') return
      const layer = document.querySelector('.editor-virtualized-caret-layer')
      let visible = true
      setInterval(() => {
        visible = !visible
        layer.style.opacity = visible ? '1' : '0'
      }, 500)
    }, variant)
    await page.mouse.move(990, 690)
    await page.waitForTimeout(2_000)
    const before = await processTicks(rootPid)
    await page.waitForTimeout(seconds * 1000)
    const after = await processTicks(rootPid)
    const { total, byType } = await cpuSeconds(before, after)
    const row = { variant, round, cpuSeconds: total, byType }
    console.log(JSON.stringify(row))
    return row
  } finally {
    await context.close()
  }
}

function summarize(samples) {
  return Object.fromEntries(
    variants.map((variant) => {
      const values = samples.filter((row) => row.variant === variant).map((row) => row.cpuSeconds)
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      return [variant, { meanCpuPercent: Math.round((mean / seconds) * 10000) / 100, values }]
    }),
  )
}
