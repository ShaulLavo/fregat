import { readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

const DAY_MS = 86_400_000
// The writer names files by UTC day: `2026-09-26.jsonl`, `2026-09-26.3.jsonl`.
const LOG_FILE = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/u

/**
 * Deletes the log files of days before the last `days` UTC days, today included. `0` keeps
 * everything. Returns how many files went.
 */
export async function pruneExpiredLogs(dir: string, days: number, now = Date.now()) {
  if (days <= 0) return 0
  const oldestKept = utcDay(now - (days - 1) * DAY_MS)
  const names = await readdir(dir).catch(() => [])
  const expired = names.filter((name) => {
    const day = LOG_FILE.exec(name)?.[1]
    return day !== undefined && day < oldestKept
  })
  const results = await Promise.allSettled(expired.map((name) => unlink(path.join(dir, name))))
  return results.filter((result) => result.status === 'fulfilled').length
}

/** Runs the prune once per UTC day and again whenever the retention changes. */
export function createLogRetention(dir: string, readDays: () => number) {
  let prunedFor = ''
  return async (now = Date.now()) => {
    const days = readDays()
    const key = `${utcDay(now)}:${days}`
    if (key === prunedFor) return 0
    prunedFor = key
    return pruneExpiredLogs(dir, days, now)
  }
}

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}
