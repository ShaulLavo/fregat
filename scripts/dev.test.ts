import path from 'node:path'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test, vi } from 'vitest'
import {
  directDevProcesses,
  resolveViteEntry,
  shouldUseDirectDev,
  superviseDirectProcesses,
} from './dev'

const root = path.resolve(import.meta.dirname, '..')

test.each([
  ['dev', ['desktop#dev', 'server#dev', 'web#dev']],
  ['dev:web', ['server#dev', 'web#dev']],
  ['dev:upstream', ['server#dev', 'web#dev']],
  ['dev:direct', ['server#dev', 'web#dev']],
])('%s starts only Fregat applications', (script, expected) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-dev-graph-'))
  const outputPath = path.join(directory, 'graph.json')
  const outputFile = openSync(outputPath, 'w')
  try {
    // Turbo's large JSON summary can exhaust the test runner's synchronous capture pipe.
    const result = Bun.spawnSync(['bun', 'run', script, '--dry=json'], {
      cwd: root,
      stdout: outputFile,
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const output = readFileSync(outputPath, 'utf8')
    const graph = JSON.parse(output.slice(output.indexOf('{')))
    expect(graph.tasks.map((task: { taskId: string }) => task.taskId).sort()).toEqual(expected)
  } finally {
    closeSync(outputFile)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('selects direct dev mode for --direct, wasm32, or missing turbo binary', () => {
  const present = () => true
  const missing = () => false
  expect(shouldUseDirectDev({ argv: [], arch: 'x64', exists: present })).toBe(false)
  expect(shouldUseDirectDev({ argv: ['--direct'], arch: 'x64', exists: present })).toBe(true)
  expect(shouldUseDirectDev({ argv: [], arch: 'wasm32', exists: present })).toBe(true)
  expect(shouldUseDirectDev({ argv: [], arch: 'x64', exists: missing })).toBe(true)
})

test('direct dev launches server and vite without turbo or desktop', () => {
  const viteEntry = resolveViteEntry(root)
  const processes = directDevProcesses(root, '/usr/bin/bun', viteEntry)
  expect(processes).toEqual([
    {
      taskId: 'server#dev',
      cwd: path.join(root, 'apps/server'),
      cmd: ['/usr/bin/bun', 'src/index.ts'],
    },
    {
      taskId: 'web#dev',
      cwd: path.join(root, 'apps/web'),
      cmd: ['/usr/bin/bun', viteEntry],
    },
  ])
})

test('superviseDirectProcesses escalates stubborn SIGTERM-trapping children on parent signal', async () => {
  const trapScript = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
  const supervisor = superviseDirectProcesses(
    [
      { taskId: 'server#dev', cwd: root, cmd: [process.execPath, '-e', trapScript] },
      { taskId: 'web#dev', cwd: root, cmd: [process.execPath, '-e', trapScript] },
    ],
    process.env,
    150,
  )
  await Bun.sleep(100)
  process.emit('SIGTERM', 'SIGTERM')
  await expect(supervisor).resolves.toBe(0)
})

test('superviseDirectProcesses stops already-started children if a later spawn fails', async () => {
  const realSpawn = Bun.spawn.bind(Bun)
  const spawned: ReturnType<typeof Bun.spawn>[] = []
  const spy = vi.spyOn(Bun, 'spawn').mockImplementation((...args: Parameters<typeof Bun.spawn>) => {
    const child = realSpawn(...args)
    spawned.push(child)
    return child
  })
  try {
    await expect(
      superviseDirectProcesses(
        [
          {
            taskId: 'server#dev',
            cwd: root,
            cmd: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
          },
          {
            taskId: 'web#dev',
            cwd: root,
            cmd: ['/definitely/missing/direct-dev-binary'],
          },
        ],
        process.env,
        150,
      ),
    ).rejects.toThrow()
    expect(spawned).toHaveLength(1)
    const [first] = spawned
    if (!first) throw new TypeError('Expected first child process')
    expect(first.exitCode ?? first.signalCode).not.toBeNull()
    expect(() => process.kill(first.pid, 0)).toThrow()
  } finally {
    spy.mockRestore()
  }
})

test('superviseDirectProcesses stops sibling children if a child exited promise rejects asynchronously', async () => {
  const realSpawn = Bun.spawn.bind(Bun)
  const spawned: ReturnType<typeof Bun.spawn>[] = []
  let callIndex = 0
  const spy = vi.spyOn(Bun, 'spawn').mockImplementation((...args: Parameters<typeof Bun.spawn>) => {
    callIndex += 1
    if (callIndex === 1) {
      const child = realSpawn(...args)
      spawned.push(child)
      return child
    }
    const failing = Promise.withResolvers<number>()
    setTimeout(() => failing.reject(new Error('simulated async startup failure')), 25)
    return {
      pid: 0,
      exitCode: null,
      signalCode: null,
      exited: failing.promise,
      kill() {},
    } as unknown as ReturnType<typeof Bun.spawn>
  })
  try {
    await expect(
      superviseDirectProcesses(
        [
          {
            taskId: 'server#dev',
            cwd: root,
            cmd: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
          },
          {
            taskId: 'web#dev',
            cwd: root,
            cmd: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
          },
        ],
        process.env,
        150,
      ),
    ).rejects.toThrow('simulated async startup failure')
    expect(spawned).toHaveLength(1)
    const [sibling] = spawned
    if (!sibling) throw new TypeError('Expected sibling child process')
    expect(sibling.exitCode ?? sibling.signalCode).not.toBeNull()
    expect(() => process.kill(sibling.pid, 0)).toThrow()
  } finally {
    spy.mockRestore()
  }
})
