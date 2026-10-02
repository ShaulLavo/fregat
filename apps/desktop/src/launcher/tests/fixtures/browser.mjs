import { appendFileSync, symlinkSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'

const mode = process.argv[2]
await Bun.write(process.argv[3], String(process.pid))
const app = process.argv.some((arg) => arg.startsWith('--app-id='))
if (app) {
  await Bun.write(process.argv[3] + '.args', JSON.stringify(process.argv.slice(4)))
  if (mode === 'handoff') process.exit(0)
  const profile = process.argv
    .find((arg) => arg.startsWith('--user-data-dir='))
    .split('=')
    .slice(1)
    .join('=')
  symlinkSync(`${hostname()}-${process.pid}`, path.join(profile, 'SingletonLock'))
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
let installed = !['pwa-unknown', 'pwa-install-failed', 'pwa-verify-failed'].includes(mode)
let buffered = ''
for await (const chunk of Bun.file(3).stream()) {
  buffered += new TextDecoder().decode(chunk)
  let end = buffered.indexOf('\0')
  while (end !== -1) {
    const message = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    appendFileSync(process.argv[3] + '.requests', JSON.stringify(message) + '\n')
    if (message.method.startsWith('PWA.')) {
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
      } else if (message.method === 'PWA.install') installed = true
      else if (message.method === 'PWA.launch') {
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
