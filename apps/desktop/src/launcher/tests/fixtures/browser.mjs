import {
  appendFileSync,
  existsSync,
  readlinkSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'

const mode = process.argv[2]
await Bun.write(process.argv[3], String(process.pid))
const app = process.argv.some((arg) => arg.startsWith('--app-id='))
const race = mode.startsWith('race-')
const profile = process.argv
  .find((arg) => arg.startsWith('--user-data-dir='))
  ?.slice('--user-data-dir='.length)
const lock = profile && path.join(profile, 'SingletonLock')
const role = profile && path.join(profile, 'FixtureRole')
const identity = `${hostname()}-${process.pid}`
const cleanupLock = () => {
  try {
    if (readlinkSync(lock) !== identity) return
    unlinkSync(lock)
    if (race) unlinkSync(role)
  } catch {}
}
if (race) {
  appendFileSync(process.argv[3] + '.pids', String(process.pid) + '\n')
  try {
    const owner = readlinkSync(lock)
    process.kill(Number(owner.slice(hostname().length + 1)), 0)
    let target = 'controller'
    try {
      target = readFileSync(role, 'utf8')
    } catch {}
    appendFileSync(
      process.argv[3] + '.forwarded',
      JSON.stringify({ target, app, args: process.argv }) + '\n',
    )
    if (app && target === 'app')
      appendFileSync(process.argv[3] + '.deliveries', JSON.stringify(process.argv) + '\n')
    process.exit(0)
  } catch {
    try {
      unlinkSync(lock)
    } catch {}
  }
  symlinkSync(identity, lock)
  writeFileSync(role, app ? 'app' : 'controller')
  process.on('SIGTERM', () => {
    cleanupLock()
    process.exit(0)
  })
}
if (app) {
  await Bun.write(process.argv[3] + '.args', JSON.stringify(process.argv.slice(4)))
  if (mode === 'handoff') process.exit(0)
  if (!race) symlinkSync(identity, lock)
  if (race) appendFileSync(process.argv[3] + '.deliveries', JSON.stringify(process.argv) + '\n')
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}
await Bun.write(process.argv[3] + '.controller', String(process.pid))
if (mode === 'exit-failure') process.exit(7)
// Busy work advances the process CPU counters, the way a cold start advances its fault and IO counters.
const busy = (ms) => {
  const until = performance.now() + ms
  while (performance.now() < until);
}
if (mode === 'slow-version') busy(6000)
if (mode === 'silent') {
  await Bun.sleep(30_000)
  process.exit(0)
}
let installed = race
  ? existsSync(process.argv[3] + '.installed')
  : !['pwa-unknown', 'pwa-install-failed', 'pwa-verify-failed'].includes(mode)
let buffered = ''
for await (const chunk of Bun.file(3).stream()) {
  buffered += new TextDecoder().decode(chunk)
  let end = buffered.indexOf('\0')
  while (end !== -1) {
    const message = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    appendFileSync(process.argv[3] + '.requests', JSON.stringify(message) + '\n')
    if (message.method.startsWith('PWA.')) {
      if (mode === 'race-paused' && message.method === 'PWA.getOsAppState' && !installed) {
        await Bun.write(process.argv[3] + '.paused', 'ready')
        while (!existsSync(process.argv[3] + '.release')) await Bun.sleep(5)
      }
      if (mode === 'exit-install' && message.method === 'PWA.getOsAppState') process.exit(3)
      if (mode === 'slow-install' && message.method === 'PWA.getOsAppState') busy(6000)
      if (mode === 'silent-install' && message.method === 'PWA.getOsAppState') {
        end = buffered.indexOf('\0')
        continue
      }
      if (mode === 'reject-install' && message.method === 'PWA.getOsAppState') {
        writeSync(4, JSON.stringify({ id: message.id, error: { code: -1 } }) + '\0')
        end = buffered.indexOf('\0')
        continue
      }
      let result = {}
      let error
      if (mode === 'pwa-unavailable')
        error = { code: -32000, message: 'Webapps are not available in current profile.' }
      else if (mode === 'pwa-invalid-params')
        error = { code: -32602, message: 'Invalid manifest id containing private URL' }
      else if (mode === 'pwa-install-failed' && message.method === 'PWA.install')
        error = { code: -32600, message: 'Failed to install private URL' }
      else if (mode === 'pwa-verify-failed' && installed && message.method === 'PWA.getOsAppState')
        error = { code: -32600, message: 'Failed to launch private URL' }
      else if (mode === 'pwa-unsupported') error = { code: -32601, message: 'Method not found' }
      else if (mode === 'pwa-install-unsupported' && message.method === 'PWA.install')
        error = { code: -32601, message: 'Method not found' }
      else if (message.method === 'PWA.getOsAppState') {
        if (!installed || mode === 'pwa-install-unsupported')
          error = {
            code: -32602,
            message: 'Unknown web-app manifest id ' + message.params.manifestId,
          }
        else result = { badgeCount: 0, fileHandlers: [] }
      } else if (message.method === 'PWA.install') {
        installed = true
        if (race) await Bun.write(process.argv[3] + '.installed', 'yes')
      } else if (message.method === 'PWA.launch') {
        result = { targetId: 'installed-app' }
      }
      writeSync(
        4,
        JSON.stringify({ id: message.id, result: error ? undefined : result, error }) + '\0',
      )
      end = buffered.indexOf('\0')
      continue
    }
    const product = mode === 'old-version' ? 'Chrome/125.0.1' : 'Chrome/130.0.1'
    const result = message.method === 'Browser.getVersion' ? { product } : {}
    writeSync(4, JSON.stringify({ id: message.id, result }) + '\0')
    end = buffered.indexOf('\0')
  }
}

appendFileSync(
  process.argv[3] + '.requests',
  JSON.stringify({ method: 'fixture.pipeClosed' }) + '\n',
)

if (race) cleanupLock()
