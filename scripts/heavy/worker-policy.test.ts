import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { heavy, removeSandboxes, sandbox, userScopes, writeMachine } from './sandbox'

const checkout = path.resolve(import.meta.dirname, '../..')
const browserProvider = createRequire(path.join(checkout, 'apps/web/package.json')).resolve(
  '@vitest/browser-playwright',
)

afterEach(removeSandboxes)

function probe(box = sandbox(), standalone = false) {
  if (!standalone)
    symlinkSync(path.join(checkout, 'node_modules'), path.join(box.root, 'node_modules'))
  const providerPath = standalone
    ? localResolution(box, '@vitest/browser-playwright')
    : browserProvider
  writeMachine(box, { availableMiB: 65536 })
  const result = path.join(box.root, 'result.json')
  const script = path.join(box.root, 'probe.mjs')
  writeFileSync(
    script,
    `import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createVitest, resolveConfig } from 'vitest/node'
const root = process.cwd()
const options = JSON.parse(process.argv[2])
const result = process.argv[3]
const mode = process.argv[4]
const browserImport = options.browser ? 'import { playwright } from ' + ${JSON.stringify(JSON.stringify(providerPath))} + '\\n' : ''
const provider = options.browser ? 'config.test.browser.provider = playwright()\\n' : ''
writeFileSync(root + '/vitest.config.mjs', browserImport + 'const config = ' + JSON.stringify({ test: options }) + '\\n' + provider + 'export default config')
const config = { root, config: root + '/vitest.config.mjs', watch: false }
if (mode === 'resolve') {
  const resolved = await resolveConfig(config)
  writeFileSync(result, JSON.stringify({ maxWorkers: resolved.test.maxWorkers }))
} else {
  const ready = root + '/ready'
  const release = root + '/release'
  mkdirSync(ready)
  mkdirSync(release)
  const vitest = await createVitest({ ...config, include: ['spec-*.test.mjs'], reporters: [] })
  const released = new Set()
  let peak = 0
  const controller = setInterval(() => {
    const running = readdirSync(ready)
    peak = Math.max(peak, running.length)
    const waiting = running.filter((file) => !released.has(file))
    const batchSize = Math.min(vitest.config.maxWorkers, 6 - released.size)
    if (!batchSize || waiting.length < batchSize) return
    for (const file of waiting) {
      released.add(file)
      writeFileSync(release + '/' + file, '')
    }
  }, 5)
  try {
    await vitest.start()
    writeFileSync(result, JSON.stringify({
      maxWorkers: vitest.config.maxWorkers, peak,
      files: vitest.state.getFiles().length, failed: vitest.state.getCountOfFailedTests()
    }))
  } finally {
    clearInterval(controller)
    await vitest.close()
  }
}
`,
  )
  return { box, result, script }
}

test.each([
  { label: 'serial', options: { fileParallelism: false }, workers: 1 },
  {
    label: 'serial with larger count',
    options: { fileParallelism: false, maxWorkers: 8 },
    workers: 1,
  },
  { label: 'parallel default', options: {}, workers: 4 },
  { label: 'parallel below ceiling', options: { maxWorkers: 2 }, workers: 2 },
  { label: 'parallel above ceiling', options: { maxWorkers: 8 }, workers: 4 },
  {
    label: 'browser serial',
    options: {
      browser: { enabled: true, instances: [{ browser: 'chromium' }] },
      fileParallelism: false,
    },
    workers: 1,
  },
])('Vitest resolves $label within the injected ceiling', async ({ options, workers }) => {
  const { box, result, script } = probe()
  const child = Bun.spawn(['node', script, JSON.stringify(options), result, 'resolve'], {
    cwd: box.root,
    env: { ...process.env, VITEST_MAX_WORKERS: '4' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, `${stdout}\n${stderr}`).toBe(0)
  expect(JSON.parse(readFileSync(result, 'utf8'))).toEqual({ maxWorkers: workers })
})

function writeSpecs(box: ReturnType<typeof sandbox>) {
  for (let index = 0; index < 6; index++) {
    writeFileSync(
      path.join(box.root, `spec-${index}.test.mjs`),
      `import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { test } from 'vitest'
test('holds a worker until its batch is ready', async () => {
  const ready = ${JSON.stringify(path.join(box.root, 'ready', String(index)))}
  const release = ${JSON.stringify(path.join(box.root, 'release', String(index)))}
  writeFileSync(ready, '')
  try {
    while (!existsSync(release)) await new Promise((resolve) => setTimeout(resolve, 5))
  } finally {
    rmSync(ready)
  }
})
`,
    )
  }
}

if (!userScopes) console.info('Worker concurrency proof requires systemd user scopes.')

describe.skipIf(!userScopes)('test-body concurrency through the heavy launcher', () => {
  test.each([
    {
      label: 'serial without worker env',
      options: { fileParallelism: false },
      workers: 1,
      unset: true,
    },
    {
      label: 'serial with worker env',
      options: { fileParallelism: false },
      workers: 1,
      unset: false,
    },
    { label: 'parallel with worker env', options: {}, workers: 4, unset: false },
  ])('$label', async ({ label, options, workers, unset }) => {
    const { box, result, script } = probe()
    writeSpecs(box)
    const env = { ...process.env }
    delete env.VITEST_MAX_WORKERS
    const command = ['node', script, JSON.stringify(options), result, 'run']
    if (unset) command.unshift('env', '-u', 'VITEST_MAX_WORKERS')
    const run = await heavy(box, label, command, { cwd: box.root, env, machine: true })
    expect(run.code, run.stderr).toBe(0)
    expect(existsSync(result), run.stderr).toBe(true)
    const observed = JSON.parse(readFileSync(result, 'utf8'))
    console.info(`${label}: ${JSON.stringify(observed)}`)
    expect(observed).toEqual({ maxWorkers: workers, peak: workers, files: 6, failed: 0 })
  })
})

function localResolution(box: ReturnType<typeof sandbox>, name: string) {
  // A separate process proves export resolution without the parent test runner's loader.
  const child = spawnSync('node', ['-p', `require.resolve(${JSON.stringify(name)})`], {
    cwd: box.root,
    env: { ...process.env, NODE_PATH: '' },
  })
  expect(child.status, child.stderr.toString()).toBe(0)
  return child.stdout.toString().trim()
}

async function exportedGhostty() {
  const box = sandbox()
  const files = spawnSync('git', ['ls-files', '-z', 'ghostty-webgpu'], { cwd: checkout })
  expect(files.status, files.stderr.toString()).toBe(0)
  for (const file of files.stdout.toString().split('\0').filter(Boolean)) {
    const destination = path.join(box.root, file.slice('ghostty-webgpu/'.length))
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(path.join(checkout, file), destination)
  }
  expect(existsSync(path.join(box.root, 'node_modules'))).toBe(false)
  const install = Bun.spawn(['bun', 'install', '--ignore-scripts'], {
    cwd: box.root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    install.exited,
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
  const installed = path.join(box.root, 'node_modules/vitest/package.json')
  expect(existsSync(installed)).toBe(true)
  const resolved = realpathSync(localResolution(box, 'vitest/package.json'))
  // Bun may store package link targets in its cache; the export must own the entry link.
  expect(resolved).toBe(realpathSync(installed))
  return box
}

test('an exact Ghostty export installs the serial policy without root dependencies', async () => {
  const box = await exportedGhostty()
  const result = path.join(box.root, 'browser-policy.json')
  const child = Bun.spawn(
    [
      'node',
      '--input-type=module',
      '-e',
      `
import { writeFileSync } from 'node:fs'
import { resolveConfig } from 'vitest/node'
const config = await resolveConfig({ root: process.cwd(), config: process.cwd() + '/vitest.browser.config.ts' })
writeFileSync(${JSON.stringify(result)}, JSON.stringify({
  maxWorkers: config.test.maxWorkers, fileParallelism: config.test.fileParallelism,
  browser: config.test.browser.enabled,
}))
`,
    ],
    {
      cwd: box.root,
      env: { ...process.env, VITEST_MAX_WORKERS: '4' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
  expect(JSON.parse(readFileSync(result, 'utf8'))).toEqual({
    maxWorkers: 1,
    fileParallelism: false,
    browser: true,
  })
})

describe.skipIf(!userScopes)('exact exported Ghostty test-body concurrency', () => {
  test.each([
    { label: 'export serial', options: { fileParallelism: false }, workers: 1 },
    { label: 'export parallel', options: {}, workers: 4 },
  ])('$label', async ({ label, options, workers }) => {
    const box = await exportedGhostty()
    const { result, script } = probe(box, true)
    writeSpecs(box)
    const env = { ...process.env }
    delete env.VITEST_MAX_WORKERS
    const run = await heavy(box, label, ['node', script, JSON.stringify(options), result, 'run'], {
      cwd: box.root,
      env,
      machine: true,
    })
    expect(run.code, run.stderr).toBe(0)
    const observed = JSON.parse(readFileSync(result, 'utf8'))
    console.info(`${label}: ${JSON.stringify(observed)}`)
    expect(observed).toEqual({ maxWorkers: workers, peak: workers, files: 6, failed: 0 })
  })
})
