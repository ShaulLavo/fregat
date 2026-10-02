import { closeSync, writeSync } from 'node:fs'

const mode = process.argv[2]
await Bun.write(process.argv[3], String(process.pid))
if (mode === 'handoff') {
  closeSync(4)
  await Bun.sleep(300)
  process.exit(0)
}
if (mode === 'exit-failure') process.exit(7)
// Busy work advances the process CPU counters, the way a cold start advances its fault and IO counters.
const busy = (ms) => {
  const until = performance.now() + ms
  while (performance.now() < until);
}
if (mode === 'cdp-progress') {
  setInterval(
    () =>
      writeSync(
        4,
        JSON.stringify({
          method: 'Target.targetCreated',
          params: { targetInfo: { type: 'worker', targetId: 'fixture' } },
        }) + '\0',
      ),
    50,
  )
  await Bun.sleep(30_000)
}
if (mode === 'progress-forever') while (true) busy(1000)
if (mode === 'slow-version') busy(6000)
if (mode === 'silent') {
  await Bun.sleep(30_000)
  process.exit(0)
}
let buffered = ''
for await (const chunk of Bun.file(3).stream()) {
  buffered += new TextDecoder().decode(chunk)
  let end = buffered.indexOf('\0')
  while (end !== -1) {
    const message = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    if (mode === 'exit-attach' && message.method === 'Target.setDiscoverTargets') process.exit(3)
    if (mode === 'slow-attach' && message.method === 'Target.setAutoAttach') busy(6000)
    if (mode.endsWith('-page') && message.method === 'Target.setAutoAttach')
      writeSync(
        4,
        JSON.stringify({
          method: 'Target.attachedToTarget',
          params: { sessionId: 'initial', targetInfo: { type: 'page' } },
        }) + '\0',
      )
    if (mode === 'slow-page' && message.method === 'Page.enable') busy(6000)
    if (mode === 'reject-page' && message.method === 'Page.enable') {
      writeSync(4, JSON.stringify({ id: message.id, error: { code: -1 } }) + '\0')
      end = buffered.indexOf('\0')
      continue
    }
    if (mode === 'silent-page' && message.method === 'Page.enable') {
      end = buffered.indexOf('\0')
      continue
    }
    const product = mode === 'old-version' ? 'Chrome/125.0.1' : 'Chrome/130.0.1'
    const result = message.method === 'Browser.getVersion' ? { product } : {}
    writeSync(4, JSON.stringify({ id: message.id, result }) + '\0')
    end = buffered.indexOf('\0')
  }
}
