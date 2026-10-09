import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { isRecord } from '@workspace/utils/objects'
import { buildNative } from './build-native'

const requested = process.argv.indexOf('--evidence')
const location = requested < 0 ? undefined : process.argv[requested + 1]
assert(requested < 0 || location, 'Provide a directory after --evidence')
const directory = location ? path.resolve(location) : tmpdir()
mkdirSync(directory, { recursive: true })
const evidence = mkdtempSync(path.join(directory, 'fregat-native-'))
const built = buildNative()
assert(built, 'Native verification requires Linux or macOS')
const binary = built
const init = path.join(evidence, 'startup.js')
writeFileSync(init, 'globalThis.nativeVerification = "startup script";')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>Fregat native verification</title>
      <h1>Fregat native host</h1><input aria-label="Native typing" value="café">
      <script>addEventListener('load', () => webkit.messageHandlers.platformShell.postMessage({
        phase: 'loaded', startup: globalThis.nativeVerification,
        stored: localStorage.getItem('native-verification'), cookie: document.cookie
      }));</script>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    ),
})

class Probe {
  readonly child
  readonly events: Record<string, unknown>[] = []
  private readonly pending: Record<string, unknown>[] = []
  private changed = Promise.withResolvers<void>()
  private ended = false
  private readonly exited: Promise<number | null>
  private stderr = ''

  constructor(args: readonly string[]) {
    this.child = spawn(binary, args, { stdio: 'pipe' })
    this.exited = once(this.child, 'exit').then(([code]: unknown[]) => {
      assert(code === null || typeof code === 'number')
      return code
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString()
    })
    // Native stdout is a newline-delimited streaming transport.
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      const value: unknown = JSON.parse(line)
      assert(isRecord(value), 'Native event must be an object')
      this.events.push(value)
      this.pending.push(value)
      this.changed.resolve()
    })
    lines.on('close', () => {
      this.ended = true
      this.changed.resolve()
    })
  }

  send(command: Record<string, unknown>) {
    this.child.stdin.write(JSON.stringify(command) + '\n')
  }

  async event(kind: string, phase?: string) {
    const timeout = AbortSignal.timeout(20_000)
    while (!timeout.aborted) {
      const event = this.pending.shift()
      if (event) {
        if (event.event !== kind) continue
        if (phase && (!isRecord(event.body) || event.body.phase !== phase)) continue
        return event
      }
      assert(!this.ended, `Native host exited while waiting for ${kind}`)
      await Promise.race([this.changed.promise, once(timeout, 'abort')])
      this.changed = Promise.withResolvers<void>()
    }
    assert.fail(`Native host timed out waiting for ${kind}`)
  }

  async finish() {
    const timeout = AbortSignal.timeout(10_000)
    const code = await Promise.race([this.exited, once(timeout, 'abort').then(() => 'timeout')])
    assert.equal(code, 0, 'Native helper must exit successfully')
  }

  dispose(index: number) {
    if (this.child.exitCode === null) this.child.kill('SIGKILL')
    writeFileSync(path.join(evidence, `host-${index}.json`), JSON.stringify(this.events, null, 2))
    writeFileSync(path.join(evidence, `host-${index}.stderr.txt`), this.stderr)
  }
}

const owned: Probe[] = []
function helper(args: readonly string[]) {
  const host = new Probe(args)
  owned.push(host)
  return host
}

async function window(store: string) {
  const host = helper([
    server.url.origin,
    init,
    '--data-dir',
    path.join(evidence, store),
    '--vibrancy',
  ])
  await host.event('ready')
  const event = await host.event('message', 'loaded')
  assert(isRecord(event.body))
  assert.equal(event.body.startup, 'startup script')
  return { host, body: event.body }
}

try {
  const first = await window('state')
  assert.equal(first.body.stored, null)
  first.host.send({
    eval: `localStorage.setItem('native-verification', 'stored');
      document.cookie = 'native-verification=stored; max-age=3600';
      webkit.messageHandlers.platformShell.postMessage({ phase: 'evaluated', value: 'café "quoted"' });`,
  })
  const evaluated = await first.host.event('message', 'evaluated')
  assert(isRecord(evaluated.body))
  assert.equal(evaluated.body.value, 'café "quoted"')
  first.host.child.stdin.write('invalid JSON\n{"eval":42}\n')
  for (let attempt = 0; attempt < 2; attempt++) {
    first.host.send({ pick: { startingPath: evidence } })
    first.host.send({ cancelPick: true })
    await first.host.event('pickCancelled')
  }
  first.host.send({ close: true })
  await first.host.event('closed')
  await first.host.finish()

  const second = await window('state')
  assert.equal(second.body.stored, 'stored')
  assert.equal(typeof second.body.cookie, 'string')
  assert(String(second.body.cookie).includes('native-verification=stored'))
  second.host.child.stdin.end()
  await second.host.event('closed')
  await second.host.finish()

  const isolated = await window('other-state')
  assert.equal(isolated.body.stored, null)
  assert.equal(isolated.body.cookie, '')
  isolated.host.send({ close: true })
  await isolated.host.event('closed')
  await isolated.host.finish()

  const picker = helper(['pick', '{}'])
  picker.send({ cancelPick: true })
  await picker.event('pickCancelled')
  await picker.finish()

  const abandoned = helper(['pick', JSON.stringify({ startingPath: evidence })])
  abandoned.child.stdin.end()
  await abandoned.event('closed')
  await abandoned.finish()

  const message = path.join(evidence, 'message.txt')
  writeFileSync(message, 'Native helper verification')
  const dialog = helper(['message', message])
  dialog.child.stdin.end()
  await dialog.event('closed')
  await dialog.finish()
  writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify({ passed: true, hosts: owned.length }),
  )
  console.log(`Native host verification passed. Evidence: ${evidence}`)
} finally {
  owned.forEach((host, index) => host.dispose(index))
  await server.stop(true)
}
