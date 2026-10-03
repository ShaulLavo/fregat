import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import type { Entry } from './queue'
import { removeSandboxes, sandbox } from './sandbox'
import { turnQueue } from './turn'

afterEach(removeSandboxes)

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'unwritable and unremovable snapshots retain FIFO across late arrivals',
  () => {
    const box = sandbox()
    const file = path.join(box.state, 'quiet.turn')
    writeFileSync(file, '{"quietId":"aaaaaaaaaaaa"}')
    const entries: Entry[] = ['bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd'].map((id, index) => ({
      cwd: box.root,
      estimateBytes: 1,
      id,
      jobClass: 'light',
      label: id,
      pid: process.pid,
      quiet: index === 0,
      server: false,
      since: new Date().toISOString(),
      sliceRoot: box.sliceRoot,
    }))
    chmodSync(box.state, 0o500)
    try {
      const first = [entries[0]!, entries[1]!]
      const late = [entries[0]!, entries[2]!]
      expect(turnQueue(box.state, first, [], 0)).toBe(first)
      expect(turnQueue(box.state, late, [], 0)).toBe(late)
      expect(readFileSync(file, 'utf8')).toBe('{"quietId":"aaaaaaaaaaaa"}')
    } finally {
      chmodSync(box.state, 0o700)
    }
  },
)
