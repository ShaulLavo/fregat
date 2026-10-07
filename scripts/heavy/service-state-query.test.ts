import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { recordEmptyServiceState, serviceState } from './service-state-query'
import { removeSandboxes, sandbox, userScopes } from './sandbox'

afterEach(removeSandboxes)

const queryAvailable = userScopes && Bun.which('systemctl') !== null
if (!queryAvailable) console.info('Service query controls require systemctl and a user manager.')

test.skipIf(!queryAvailable)(
  'actual absence remains not-found and a deliberate query failure remains empty',
  () => {
    const box = sandbox()
    const unit = `${box.sliceRoot}-absent_deadline.service`
    const file = path.join(box.root, 'query.jsonl')
    const fd = openSync(file, 'wx')
    const sink = (line: string) => writeSync(fd, line)
    try {
      expect(serviceState(unit, undefined, sink)).toBe('not-found')
      expect(readFileSync(file).byteLength).toBe(0)
      const env = {
        ...process.env,
        XDG_RUNTIME_DIR: box.root,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${box.root}/absent`,
      }
      const state = serviceState(unit, env, sink)
      expect(state).toBe('')
      expect(state).not.toBe('not-found')
      const line = readFileSync(file, 'utf8')
      expect(line).toContain('"status":1')
      expect(line).toContain('Failed to connect')
      expect(line).toContain('"text":""')
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    } finally {
      closeSync(fd)
    }
  },
)

test.skipIf(!queryAvailable)('failed receipt IO preserves the original empty query return', () => {
  const box = sandbox()
  const file = path.join(box.root, 'closed.jsonl')
  const fd = openSync(file, 'wx')
  closeSync(fd)
  const state = serviceState(
    `${box.sliceRoot}-absent_deadline.service`,
    {
      ...process.env,
      XDG_RUNTIME_DIR: box.root,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${box.root}/absent`,
    },
    (line) => writeSync(fd, line),
  )
  expect(state).toBe('')
  expect(readFileSync(file).byteLength).toBe(0)
})

test('genuine child output is bounded with explicit preview truncation and unchanged status', () => {
  const box = sandbox()
  const result = spawnSync(
    process.execPath,
    ['-e', 'process.stderr.write("🔥".repeat(1000)); process.exit(7)'],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(7)
  const file = path.join(box.root, 'bounded.jsonl')
  const fd = openSync(file, 'wx')
  try {
    recordEmptyServiceState('fixture'.repeat(1000), result, (line) => writeSync(fd, line))
    const line = readFileSync(file, 'utf8')
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    expect(line).toContain('"status":7')
    expect(line).toContain('"serviceTruncated":true')
    expect(line).toContain('"characters":2000,"truncated":true')
    expect(result.stderr.length).toBe(2000)
    expect(result.status).toBe(7)
  } finally {
    closeSync(fd)
  }
})
