import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { laneJobCommand, laneRunDirectory } from './lane-command'

const MiB = 2 ** 20
const checkout = path.resolve(import.meta.dirname, '../../..')
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

type Lane = {
  exitCode: number
  memoryPeakBytes: number | null
  oomKills: number | null
  slice: string
}

// The same shell the Pi runs, run here; the lane root's platform/ is this checkout.
function runLane(name: string, memoryMax: string, command: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'lane-command-'))
  roots.push(root)
  symlinkSync(checkout, path.join(root, 'platform'))
  const job = { root, name: `${name}-${process.pid}`, memoryMax, command }
  const status = spawnSync('bash', ['-c', laneJobCommand(job)], { stdio: 'pipe' }).status
  const lane = JSON.parse(
    readFileSync(path.join(laneRunDirectory(job), 'lane.json'), 'utf8'),
  ) as Lane
  return { status, lane }
}

// A bench case: its own scope, joined to the job's slice the way bench.ts joins it.
const caseScope = (mib: number) =>
  `systemd-run --user --scope --quiet --slice="$HEAVY_JOB_SLICE" bun -e 'Buffer.alloc(${mib} * 2 ** 20, 1)'`

describe.skipIf(!userScopes)('a lane job', () => {
  test('counts the memory of case scopes that join its slice', () => {
    const { status, lane } = runLane('counts', '1G', caseScope(300))
    expect(status).toBe(0)
    expect(lane.exitCode).toBe(0)
    expect(lane.memoryPeakBytes).toBeGreaterThanOrEqual(300 * MiB)
    expect(lane.slice).toMatch(/^lane_counts_\d+\.slice$/)
  })

  test('caps case scopes that join its slice', () => {
    const { status, lane } = runLane('caps', '200M', caseScope(400))
    expect(status).not.toBe(0)
    expect(lane.oomKills).toBeGreaterThanOrEqual(1)
    expect(lane.memoryPeakBytes).toBeLessThanOrEqual(200 * MiB)
  })

  test('passes data arguments through without shell interpretation', () => {
    const { lane } = runLane('quoting', '1G', 'true')
    expect(lane.exitCode).toBe(0)
    expect(
      laneJobCommand({ root: "/home/pi/a'b", name: 'n', memoryMax: '1G', command: 'true' }),
    ).toContain(`'/home/pi/a'\\''b/platform'`)
  })
})
