import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { launchWebview } from '../native-window'
import { expect, test } from 'vitest'
import { WebviewHost, pick } from '../webview-host'
import type { HostProcess } from '../native-helper'

function fakeHost() {
  const exit = Promise.withResolvers<{ code: number | null; signal: string | null }>()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const commands: string[] = []
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk) => commands.push(chunk))
  const finish = (code = 0) => {
    stdout.end()
    stderr.end()
    exit.resolve({ code, signal: null })
  }
  const process: HostProcess = {
    stdin,
    stdout,
    stderr,
    exited: exit.promise,
    kill: () => finish(1),
  }
  return { process, commands, stdout, finish }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('frames split and coalesced JSON lines, writes escaped eval, and records frame telemetry', async () => {
  const fake = fakeHost()
  const events: unknown[] = []
  const records: unknown[] = []
  let cleanup = 0
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    onEvent: (event) => events.push(event),
    recordOpen: (context) => records.push(context),
    cleanupOwnedWindow: () => {
      cleanup++
    },
  })
  fake.stdout.write('{"event":"rea')
  fake.stdout.write('dy"}\n{"event":"message","body":{"platformHostRaf":61}}\n')
  await host.ready
  host.evaluate('console.log("a\\nb")')
  expect(JSON.parse(fake.commands[0]!)).toEqual({ eval: 'console.log("a\\nb")' })
  await tick()
  expect(records).toEqual([
    { engine: process.platform === 'darwin' ? 'wkwebview' : 'webkitgtk', rafPerSecond: 61 },
  ])
  expect(host.capabilities.displayCapture).toBe(false)
  host.close()
  host.close()
  expect(fake.commands.filter((line) => line.includes('close'))).toHaveLength(1)
  fake.stdout.write('{"event":"closed"}\n')
  fake.finish()
  await host.exited
  expect(cleanup).toBe(1)
  expect(events).toHaveLength(3)
})

test('serializes picks and preserves cancellation and Unicode paths', async () => {
  const fake = fakeHost()
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    cleanupOwnedWindow: () => {},
  })
  fake.stdout.write('{"event":"ready"}\n')
  await host.ready
  const first = host.pick({ mode: 'folder' })
  const second = host.pick({ mode: 'file' })
  await tick()
  expect(fake.commands).toHaveLength(1)
  fake.stdout.write('{"event":"picked","paths":[]}\n')
  expect(await first).toEqual([])
  await tick()
  expect(fake.commands).toHaveLength(2)
  fake.stdout.write(`${JSON.stringify({ event: 'picked', paths: ['/資料/"file"\n.txt'] })}\n`)
  expect(await second).toEqual(['/資料/"file"\n.txt'])
  host.close()
  fake.finish()
  await host.exited
})

test('exit rejects outstanding and queued picks and cleans only this window', async () => {
  const fake = fakeHost()
  let cleanup = 0
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    cleanupOwnedWindow: () => {
      cleanup++
    },
  })
  fake.stdout.write('{"event":"ready"}\n')
  await host.ready
  const first = expect(host.pick({ mode: 'folder' })).rejects.toMatchObject({
    code: 'desktop.webview.HOST_FAILED',
  })
  const second = expect(host.pick({ mode: 'file' })).rejects.toMatchObject({
    code: 'desktop.webview.HOST_FAILED',
  })
  await tick()
  fake.finish(1)
  await expect(host.exited).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  await Promise.all([first, second])
  expect(cleanup).toBe(1)
})

test('malformed frames kill the host and reject startup with a structured error', async () => {
  const fake = fakeHost()
  let cleanup = 0
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    cleanupOwnedWindow: () => {
      cleanup++
    },
  })
  fake.stdout.write('{"event":"picked","paths":[7]}\n')
  await expect(host.ready).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  await expect(host.exited).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  expect(cleanup).toBe(1)
})

test('the standalone picker returns cancel without opening a webview', async () => {
  const fake = fakeHost()
  const args: unknown[] = []
  const result = pick({
    binary: '/host',
    options: { mode: 'folder' },
    spawn: (command) => {
      args.push(command)
      return fake.process
    },
  })
  fake.stdout.write('{"event":"picked","paths":[]}\n')
  fake.finish()
  expect(await result).toEqual([])
  expect(args).toEqual([['/host', 'pick', '{"mode":"folder"}']])
})

test('missing host rejects startup and performs owned cleanup', async () => {
  let cleanup = 0
  const host = new WebviewHost({
    binary: '/nonexistent/platform-webview',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    cleanupOwnedWindow: () => {
      cleanup++
    },
  })
  await expect(host.ready).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  await expect(host.exited).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  expect(cleanup).toBe(1)
})

test('malformed standalone picker output terminates its process', async () => {
  const fake = fakeHost()
  const result = pick({ binary: '/host', options: { mode: 'file' }, spawn: () => fake.process })
  fake.stdout.write('invalid json\n')
  await expect(result).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
})

test('chooser timeout cancels only the chooser, drains late replies, and retains the app for the next pick', async () => {
  const fake = fakeHost()
  let cleanup = 0
  let exited = false
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    budget: { dialogMs: 20, stopGraceMs: 100 },
    cleanupOwnedWindow: () => {
      cleanup++
    },
  })
  void host.exited.then(
    () => {
      exited = true
    },
    () => {
      exited = true
    },
  )
  fake.process.stdin.on('data', (line) => {
    const command = JSON.parse(line)
    if (command.cancelPick) {
      fake.stdout.write('{"event":"picked","paths":["/late-selection"]}\n')
      fake.stdout.write('{"event":"pickCancelled"}\n')
    }
    if (command.pick?.mode === 'file')
      fake.stdout.write('{"event":"picked","paths":["/next-selection"]}\n')
  })
  fake.stdout.write('{"event":"ready"}\n')
  await host.ready
  const first = expect(host.pick({ mode: 'folder' })).rejects.toMatchObject({
    code: 'desktop.webview.PICKER_TIMEOUT',
    message: 'The file chooser closed after its time limit.',
    why: 'The file chooser did not receive a selection before the allowed interval ended.',
    fix: 'Open the file chooser again and select an entry before it closes.',
  })
  const second = host.pick({ mode: 'file' })
  await first
  expect(await second).toEqual(['/next-selection'])
  host.evaluate('document.title')
  expect(fake.commands.map((line) => JSON.parse(line))).toEqual([
    { pick: { mode: 'folder' } },
    { cancelPick: true },
    { pick: { mode: 'file' } },
    { eval: 'document.title' },
  ])
  expect(exited).toBe(false)
  expect(cleanup).toBe(0)
  const closing = host.close()
  fake.finish()
  await closing
  expect(cleanup).toBe(1)
})

test('unacknowledged chooser cancellation bounds a stalled host and rejects queued picks', async () => {
  const fake = fakeHost()
  const host = new WebviewHost({
    binary: '/host',
    url: 'http://localhost',
    initScriptPath: '/init',
    dataDir: '/fixture/state/desktop/webview',
    spawn: () => fake.process,
    budget: { dialogMs: 10, stopGraceMs: 10 },
    cleanupOwnedWindow: () => {},
  })
  fake.stdout.write('{"event":"ready"}\n')
  await host.ready
  const first = expect(host.pick({ mode: 'folder' })).rejects.toMatchObject({
    code: 'desktop.webview.HOST_FAILED',
  })
  const second = expect(host.pick({ mode: 'file' })).rejects.toMatchObject({
    code: 'desktop.webview.HOST_FAILED',
  })
  await expect(host.exited).rejects.toMatchObject({ code: 'desktop.webview.HOST_FAILED' })
  await Promise.all([first, second])
  expect(fake.commands.filter((line) => JSON.parse(line).cancelPick)).toHaveLength(1)
})

test('standalone native chooser timeout exposes selection guidance after reaping', async () => {
  const fake = fakeHost()
  await expect(
    pick({
      binary: '/host',
      options: { mode: 'folder' },
      spawn: () => fake.process,
      budget: { dialogMs: 10, stopGraceMs: 10 },
    }),
  ).rejects.toMatchObject({
    code: 'desktop.webview.PICKER_TIMEOUT',
    message: 'The file chooser closed after its time limit.',
    why: 'The file chooser did not receive a selection before the allowed interval ended.',
    fix: 'Open the file chooser again and select an entry before it closes.',
  })
  await expect(fake.process.exited).resolves.toMatchObject({ code: 1 })
})

test.each(['darwin', 'linux'] as const)(
  'reopening a %s window reuses its state-home data directory and retains only browsing data',
  async (platform) => {
    const stateHome = mkdtempSync(path.join(tmpdir(), 'native-window-storage-'))
    const dataDir = path.join(stateHome, 'desktop', 'webview')
    const scripts: string[] = []
    try {
      for (let launch = 0; launch < 2; launch++) {
        const fake = fakeHost()
        let argv: readonly string[] = []
        const options = {
          binary: '/host',
          url: 'http://localhost:3301/',
          stateHome,
          platform,
          vibrancy: true,
          budget: {
            dialogMs: 200,
            stopGraceMs: 20,
          },
          startup: {
            limitMs: 1e3,
            idleMs: 500,
          },
          spawn: (command: readonly string[]) => {
            argv = command
            fake.stdout.write('{"event":"ready"}\n')
            return fake.process
          },
          onOpen: () => {},
        }
        const window = await launchWebview(options)
        const script = argv[2]!
        scripts.push(script)
        const closing = window.close()
        fake.finish()
        await closing
        expect(argv).toEqual([
          '/host',
          'http://localhost:3301/',
          script,
          '--data-dir',
          dataDir,
          ...(platform === 'darwin' ? ['--vibrancy'] : []),
        ])
        expect(existsSync(script)).toBe(false)
        expect(existsSync(dataDir)).toBe(true)
        const marker = path.join(dataDir, 'stored-view-state')
        if (launch === 0) writeFileSync(marker, 'workspace')
        else expect(readFileSync(marker, 'utf8')).toBe('workspace')
      }
      expect(scripts[0]).not.toBe(scripts[1])
    } finally {
      rmSync(stateHome, { recursive: true, force: true })
    }
  },
)

test.each([
  { platform: 'darwin', vibrancy: true, accepts: true },
  { platform: 'darwin', vibrancy: false, accepts: false },
  { platform: 'linux', vibrancy: true, accepts: false },
] as const)(
  'surface opacity reaches only the transparent $platform host ($vibrancy)',
  async ({ platform, vibrancy, accepts }) => {
    const stateHome = mkdtempSync(path.join(tmpdir(), 'native-window-opacity-'))
    const fake = fakeHost()
    let token = ''
    const launched = await launchWebview({
      binary: '/host',
      url: 'http://localhost:3301/',
      stateHome,
      platform,
      vibrancy,
      budget: { dialogMs: 200, stopGraceMs: 20 },
      startup: { limitMs: 1000, idleMs: 500 },
      spawn: (args) => {
        const source = readFileSync(args[2]!, 'utf8')
        token = JSON.parse(source.match(/const token = (.*);/)![1]!)
        fake.stdout.write('{"event":"ready"}\n')
        return fake.process
      },
      onOpen: () => {},
    })
    const message = (body: Record<string, unknown>) =>
      fake.stdout.write(
        `${JSON.stringify({ event: 'message', body: { method: 'setSurfaceOpacity', origin: 'http://localhost:3301', token, ...body } })}\n`,
      )
    try {
      for (const opacity of [20, 80, 0, 100]) message({ opacity })
      message({ opacity: 20, token: 'foreign' })
      message({ opacity: 20, origin: 'http://foreign.test' })
      for (const opacity of [-1, 101, '20', true, null]) message({ opacity })
      await tick()
      expect(fake.commands.map((line) => JSON.parse(line))).toEqual(
        accepts
          ? [
              { surfaceOpacity: 20 },
              { surfaceOpacity: 80 },
              { surfaceOpacity: 0 },
              { surfaceOpacity: 100 },
            ]
          : [],
      )
    } finally {
      const closing = launched.close()
      fake.finish()
      await closing
      rmSync(stateHome, { recursive: true, force: true })
    }
  },
)
