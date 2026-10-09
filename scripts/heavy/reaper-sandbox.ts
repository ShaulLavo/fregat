import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A filesystem and manager stand-in. No command reaches the user systemd manager. */
export function reaperSandbox(operation: string = '', watchdogLoaded = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'heavy-reaper-'))
  const sliceRoot = `heavyt${randomBytes(4).toString('hex')}`
  const state = path.join(root, 'state')
  const home = path.join(root, 'home')
  const proc = path.join(root, 'proc')
  const cgroups = path.join(root, 'cgroups')
  const bin = path.join(root, 'bin')
  const calls = path.join(root, 'calls')
  const gate = path.join(root, 'release')
  const preload = path.join(root, 'preload.ts')
  const children: {
    readonly child: ReturnType<typeof spawn>
    readonly done: Promise<number | null>
    readonly stderr: () => string
  }[] = []
  for (const dir of [state, home, path.join(proc, 'pressure'), cgroups, bin])
    mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(proc, 'meminfo'), 'MemAvailable: 0 kB\n')
  writeFileSync(path.join(proc, 'pressure', 'memory'), 'some avg10=0.00\n')
  writeFileSync(path.join(proc, 'loadavg'), '0 0 0 1/1 1\n')
  writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({
      'developer.heavyJobQuietHoldSeconds': 2,
      'developer.heavyJobStopGraceSeconds': 1,
    }),
  )
  writeFileSync(
    preload,
    `import fs from 'node:fs'
import { mock } from 'bun:test'
const redirect = file => typeof file === 'string' && file.startsWith('/sys/fs/cgroup/')
  ? ${JSON.stringify(cgroups)} + '/' + file.split('/').slice(7).join('/') : file
mock.module('node:fs', () => ({ ...fs,
  readFileSync: (file, ...args) => fs.readFileSync(redirect(file), ...args),
  readdirSync: (file, ...args) => fs.readdirSync(redirect(file), ...args),
}))
`,
  )
  writeFileSync(
    path.join(bin, 'systemctl'),
    `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const args = Bun.argv.slice(2)
const operation = args[1]
const slice = operation === 'show' ? args[2] : args.at(-1)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ operation, slice, pid: process.pid }) + '\\n')
if (operation === ${JSON.stringify(operation)}) {
  while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(20)
}
if (operation === 'show') console.log(${JSON.stringify(watchdogLoaded ? 'loaded' : 'not-found')})
if (operation === 'stop' && slice.endsWith('.slice')) writeFileSync(path.join(${JSON.stringify(cgroups)}, ${JSON.stringify(`${sliceRoot}.slice`)}, slice, 'cgroup.events'), 'populated 0\\n')
`,
    { mode: 0o755 },
  )

  function addSlice(id: string, ownerRoot = sliceRoot) {
    const slice = `${ownerRoot}-${id}.slice`
    const dir = path.join(cgroups, `${ownerRoot}.slice`, slice)
    mkdirSync(dir, { recursive: true })
    for (const [file, value] of Object.entries({
      'cgroup.events': 'populated 1\n',
      'memory.max': '1048576\n',
      'memory.current': '0\n',
      'memory.stat': 'anon 0\n',
    }))
      writeFileSync(path.join(dir, file), value)
    return slice
  }

  function start(quiet = true) {
    const child = spawn(
      process.execPath,
      [
        '--preload',
        preload,
        path.join(import.meta.dirname, 'run.ts'),
        '--state-dir',
        state,
        '--settings-home',
        home,
        '--proc',
        proc,
        '--slice-root',
        sliceRoot,
      ].concat(quiet ? ['--quiet'] : [], ['reaper', '--', 'true']),
      { env: { ...process.env, PATH: bin }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const done = new Promise<number | null>((resolve) => child.on('close', resolve))
    const job = { child, done, stderr: () => stderr }
    children.push(job)
    return job
  }

  const managerCalls = (): { operation: string; slice: string; pid: number }[] =>
    existsSync(calls)
      ? readFileSync(calls, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []

  const lifecycle = () => managerCalls().filter(({ slice }) => slice.endsWith('.slice'))

  function managerChildren() {
    return managerCalls().filter(({ pid }) => {
      try {
        return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
          .split('\0')
          .includes(path.join(bin, 'systemctl'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    })
  }

  async function cleanup() {
    writeFileSync(gate, '')
    for (const { child } of children) child.kill('SIGKILL')
    await Promise.all(children.map((job) => job.done))
    while (managerChildren().length) await new Promise((resolve) => setTimeout(resolve, 20))
    rmSync(root, { force: true, recursive: true })
  }

  return {
    addSlice,
    cgroups,
    cleanup,
    gate,
    lifecycle,
    managerCalls,
    managerChildren,
    root,
    sliceRoot,
    start,
    state,
  }
}
