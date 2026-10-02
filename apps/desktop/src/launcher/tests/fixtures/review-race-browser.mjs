import {
  existsSync,
  symlinkSync,
  unlinkSync,
  appendFileSync,
  readFileSync,
  readlinkSync,
  writeSync,
} from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
const marker = process.argv[2]
appendFileSync(marker + '.pids', String(process.pid) + '\n')
const profile = process.argv
  .find((arg) => arg.startsWith('--user-data-dir='))
  .slice('--user-data-dir='.length)
const lock = path.join(profile, 'SingletonLock')
const app = process.argv.some((arg) => arg.startsWith('--app-id='))
if (!app && existsSync(marker + '.gate')) {
  await Bun.write(marker + '.spawned', '')
  while (!existsSync(marker + '.allow')) await Bun.sleep(5)
}
if (
  existsSync(lock) ||
  (() => {
    try {
      symlinkSync(`${hostname()}-${process.pid}`, lock)
      return false
    } catch {
      return true
    }
  })()
) {
  appendFileSync(
    marker + '.forwarded',
    JSON.stringify({
      app,
      args: process.argv,
      ownerPhase:
        existsSync(marker + '.installing') && !existsSync(marker + '.release')
          ? 'installing'
          : 'app',
    }) + '\n',
  )
  if (app) {
    const url = process.argv
      .find((arg) => arg.startsWith('--app-launch-url-for-shortcuts-menu-item='))
      .slice('--app-launch-url-for-shortcuts-menu-item='.length)
    if (existsSync(marker + '.installing') && !existsSync(marker + '.release'))
      appendFileSync(
        marker + '.targets',
        JSON.stringify({ targetId: `shortcut-${process.pid}`, type: 'page', url }) + '\n',
      )
    else appendFileSync(marker + '.deliveries', JSON.stringify(process.argv) + '\n')
  }
  process.exit(0)
}
const cleanup = () => {
  try {
    if (readlinkSync(lock) === `${hostname()}-${process.pid}`) unlinkSync(lock)
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})
if (app) {
  appendFileSync(marker + '.deliveries', JSON.stringify(process.argv) + '\n')
  await Bun.write(marker + '.app', String(process.pid))
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}
let buffered = ''
for await (const chunk of Bun.file(3).stream()) {
  buffered += new TextDecoder().decode(chunk)
  let end
  while ((end = buffered.indexOf('\0')) !== -1) {
    const msg = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    if (msg.method === 'PWA.getOsAppState') {
      await Bun.write(marker + '.installing', String(process.pid))
      while (!existsSync(marker + '.release')) await Bun.sleep(10)
    }
    let result = msg.method === 'Browser.getVersion' ? { product: 'Chrome/154.0.1' } : {}
    if (msg.method === 'Target.getTargets')
      result = {
        targetInfos: existsSync(marker + '.targets')
          ? readFileSync(marker + '.targets', 'utf8')
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line))
          : [],
      }
    writeSync(4, JSON.stringify({ id: msg.id, result }) + '\0')
  }
}
