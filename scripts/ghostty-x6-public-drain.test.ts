import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { acquireX6Drain, releaseX6Drain, type DrainReceipt } from './ghostty-x6-public-drain.ts'

let directory: string
let file: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ghostty-x6-drain-'))
  file = join(directory, 'drain.request')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('holds the actual driver PID and releases only its own unchanged request', () => {
  const receipt = acquireX6Drain(file)
  expect(receipt.pid).toBe(process.pid)
  expect(receipt.holder).toBe('x6-window')
  expect(readFileSync(file, 'utf8')).toBe(receipt.text)
  expect(receipt.text).toContain(`pid=${process.pid} since=`)
  expect(releaseX6Drain(receipt)).toBe('released')
  expect(releaseX6Drain(receipt)).toBe('absent')
})

it('fails exclusive acquisition without changing an existing live owner request', () => {
  const foreign = `pid=${process.pid} since=${new Date().toISOString()} holder=other-live-unit\n`
  writeFileSync(file, foreign)
  expect(() => acquireX6Drain(file)).toThrow()
  expect(readFileSync(file, 'utf8')).toBe(foreign)
})

it('preserves another request that replaced the original inode', () => {
  const receipt = acquireX6Drain(file)
  renameSync(file, join(directory, 'original-owned-request'))
  writeFileSync(file, 'another unit owns this file\n')
  expect(releaseX6Drain(receipt)).toBe('ownership-changed')
  expect(readFileSync(file, 'utf8')).toBe('another unit owns this file\n')
})

it('preserves changed content on the same inode', () => {
  const receipt = acquireX6Drain(file)
  writeFileSync(file, 'modified ownership\n')
  expect(releaseX6Drain(receipt)).toBe('ownership-changed')
  expect(readFileSync(file, 'utf8')).toBe('modified ownership\n')
})

async function childHold() {
  const script = join(directory, 'driver.ts')
  const helper = new URL('./ghostty-x6-public-drain.ts', import.meta.url).href
  writeFileSync(
    script,
    `import { acquireX6Drain, releaseX6Drain } from ${JSON.stringify(helper)}
const receipt = acquireX6Drain(process.argv[2]!)
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const)
  process.once(signal, () => { releaseX6Drain(receipt); process.exit(code) })
console.log(JSON.stringify(receipt))
setInterval(() => {}, 1_000)
`,
  )
  const child = spawn(process.execPath, [script, file], { stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })
  const exit = once(child, 'exit')
  const [line] = await once(lines, 'line')
  lines.close()
  return { child, exit, receipt: JSON.parse(line as string) as DrainReceipt }
}

it('cleans an admitted driver hold on normal termination without acquiring a real shared hold', async () => {
  const { child, exit, receipt } = await childHold()
  try {
    expect(receipt.pid).toBe(child.pid)
    expect(() => process.kill(receipt.pid, 0)).not.toThrow()
    child.kill('SIGTERM')
    const [code] = await exit
    expect(code).toBe(143)
    expect(existsSync(file)).toBe(false)
  } finally {
    child.kill('SIGKILL')
  }
})

it('allows the supervising unit to clean its captured own hold after uncatchable driver death', async () => {
  const { child, exit, receipt } = await childHold()
  try {
    expect(() => process.kill(receipt.pid, 0)).not.toThrow()
    child.kill('SIGKILL')
    await exit
    expect(() => process.kill(receipt.pid, 0)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(receipt.text)
    expect(releaseX6Drain(receipt)).toBe('released')
  } finally {
    child.kill('SIGKILL')
  }
})
