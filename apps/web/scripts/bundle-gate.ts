/**
 * First-load gate (Plan 109 Phase 4). Builds through `bundle-report.ts` and compares first-load
 * script gzip, in total and per owner, against `first-load-pins.json`. A ratchet: the pins are the
 * last accepted build plus a margin, re-pinned with `--write --reason=…` when a growth is intended.
 *
 *   bun scripts/bundle-gate.ts                       build, compare, exit 1 on growth
 *   bun scripts/bundle-gate.ts --write --reason=…    build and re-pin
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OwnerRow } from './bundle-owners'

export const PINS_FILE = path.join(import.meta.dirname, 'first-load-pins.json')
/** Growth the total may take before the gate fails. */
const TOTAL_MARGIN = 0.01
/** Per owner: the larger of 5% or 2 KB gzip, so a tiny owner is not pinned to the byte. */
const OWNER_MARGIN = 0.05
const OWNER_FLOOR = 2_048

export type Pins = {
  readonly reading: 'disk'
  readonly scriptGzip: number
  readonly owners: Readonly<Record<string, number>>
  readonly history: readonly {
    readonly at: string
    readonly scriptGzip: number
    readonly reason: string
  }[]
}

export type GateReport = {
  readonly firstLoad: { readonly scriptGzip: number }
  readonly owners: readonly Pick<OwnerRow, 'owner' | 'firstLoadGzip'>[]
}

export type GateFailure = { readonly owner: string; readonly pinned: number; readonly now: number }

export type GateResult = {
  readonly total: { readonly pinned: number; readonly now: number; readonly limit: number }
  readonly failures: readonly GateFailure[]
  readonly passed: boolean
}

export function checkFirstLoad(report: GateReport, pins: Pins): GateResult {
  const limit = Math.round(pins.scriptGzip * (1 + TOTAL_MARGIN))
  const total = { pinned: pins.scriptGzip, now: report.firstLoad.scriptGzip, limit }
  const failures = report.owners.flatMap((row) => ownerGrowth(row, pins.owners[row.owner] ?? 0))
  const totalFailed = total.now > limit
  if (totalFailed && failures.length === 0)
    return {
      total,
      failures: [{ owner: '(total)', pinned: total.pinned, now: total.now }],
      passed: false,
    }

  return { total, failures, passed: !totalFailed && failures.length === 0 }
}

function ownerGrowth(
  row: Pick<OwnerRow, 'owner' | 'firstLoadGzip'>,
  pinned: number,
): GateFailure[] {
  const allowance = Math.max(pinned * OWNER_MARGIN, OWNER_FLOOR)
  if (row.firstLoadGzip <= pinned + allowance) return []
  return [{ owner: row.owner, pinned, now: row.firstLoadGzip }]
}

export function pinsFrom(
  report: GateReport,
  previous: Pins | null,
  reason: string,
  at: string,
): Pins {
  const owners = Object.fromEntries(
    report.owners
      .filter((row) => row.firstLoadGzip > 0)
      .map((row) => [row.owner, Math.round(row.firstLoadGzip)]),
  )
  const entry = { at, scriptGzip: report.firstLoad.scriptGzip, reason }
  return {
    reading: 'disk',
    scriptGzip: report.firstLoad.scriptGzip,
    owners,
    history: [...(previous?.history ?? []), entry],
  }
}

export function formatResult(result: GateResult) {
  const { total } = result
  const lines = [
    `first-load script gzip: ${total.now} (pinned ${total.pinned}, limit ${total.limit}, [disk])`,
  ]
  for (const failure of result.failures) {
    const delta = Math.round(failure.now - failure.pinned)
    lines.push(
      `  grew: ${failure.owner}  ${Math.round(failure.pinned)} -> ${Math.round(failure.now)} (+${delta})`,
    )
  }
  lines.push(
    result.passed
      ? 'gate: first load is within its pins'
      : 'gate: first load grew; see the owners above',
  )
  return lines.join('\n')
}

function buildReport(): GateReport {
  const json = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-gate-')), 'report.json')
  const result = Bun.spawnSync(
    [process.execPath, path.join(import.meta.dirname, 'bundle-report.ts'), `--json=${json}`],
    { cwd: path.join(import.meta.dirname, '..'), stdout: 'inherit', stderr: 'inherit' },
  )
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
  return JSON.parse(fs.readFileSync(json, 'utf8')) as GateReport
}

function readPins(): Pins | null {
  if (!fs.existsSync(PINS_FILE)) return null
  return JSON.parse(fs.readFileSync(PINS_FILE, 'utf8')) as Pins
}

if (import.meta.main) {
  const write = Bun.argv.includes('--write')
  const reason = Bun.argv.find((arg) => arg.startsWith('--reason='))?.slice('--reason='.length)
  const report = buildReport()
  const pins = readPins()
  if (write) {
    if (!reason) {
      console.error('--write needs --reason=<why first load changed>')
      process.exit(1)
    }
    fs.writeFileSync(
      PINS_FILE,
      `${JSON.stringify(pinsFrom(report, pins, reason, new Date().toISOString()), null, 2)}\n`,
    )
    console.log(`pinned first load at ${report.firstLoad.scriptGzip} gzip`)
    process.exit(0)
  }
  if (!pins) {
    console.error(`No pins at ${PINS_FILE}. Run with --write --reason=… once.`)
    process.exit(1)
  }
  const result = checkFirstLoad(report, pins)
  console.log(formatResult(result))
  process.exit(result.passed ? 0 : 1)
}
