import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { heavy, removeSandboxes, sandbox, userScopes, writeMachine } from './sandbox'

const checkout = path.resolve(import.meta.dirname, '../..')
const browserProvider = createRequire(path.join(checkout, 'apps/web/package.json')).resolve(
  '@vitest/browser-playwright',
)

afterEach(removeSandboxes)

function probe() {
  const box = sandbox()
  symlinkSync(path.join(checkout, 'node_modules'), path.join(box.root, 'node_modules'))
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
const browserImport = options.browser ? 'import { playwright } from ' + ${JSON.stringify(JSON.stringify(browserProvider))} + '\\n' : ''
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
