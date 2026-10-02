import { PassThrough } from 'node:stream'
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
  expect(records).toEqual([{ engine: 'webkitgtk', rafPerSecond: 61 }])
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
