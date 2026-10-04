import type { LiveCheckVerdict, ServerUpdateError, StagedRelease } from '@workspace/contracts'
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

import { updateErrors } from './structured-errors'

export type StagedReleaseRead =
  | { staged: StagedRelease; reason: null }
  | { staged: null; reason: 'no-root' | 'absent' | 'dangling' | 'same-as-running' }

// Written by scripts/deploy/live-check.mjs.
const liveCheckReportSchema = v.object({
  release: v.pipe(v.string(), v.nonEmpty()),
  status: v.picklist(['passed', 'failed']),
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  fresh: v.optional(v.array(v.string()), []),
})

/** Consumed once by the installed promotion step, and valid only for this staged release. */
export function approveRestart(root: string, staged: StagedRelease) {
  const destination = path.join(root, 'restart-approved.json')
  const temporary = `${destination}.${process.pid}`
  writeFileSync(temporary, JSON.stringify(staged), { mode: 0o600 })
  renameSync(temporary, destination)
}

/** `<root>/pending`, the release `install-release --server` staged, unless the server already runs it. */
export function readStagedRelease(
  root: string | null,
  serverRelease: string | null,
): StagedReleaseRead {
  if (!root) return { staged: null, reason: 'no-root' }

  const link = path.join(root, 'pending')
  const stagedAt = linkTime(link)
  if (!stagedAt) return { staged: null, reason: 'absent' }
  const target = realTarget(link)
  if (!target) return { staged: null, reason: 'dangling' }
  const release = path.basename(target)
  if (release === serverRelease) return { staged: null, reason: 'same-as-running' }

  return { staged: { release, stagedAt }, reason: null }
}

/** The post-restart live check of the served release, from `<root>/current/live-check.json`. */
export function readLiveCheck(root: string | null): LiveCheckVerdict | null {
  if (!root) return null

  const current = path.join(root, 'current')
  const report = v.safeParse(liveCheckReportSchema, readJson(path.join(current, 'live-check.json')))
  if (!report.success) return null

  const { release, status, checkedAt, fresh } = report.output
  if (release !== path.basename(realTarget(current) ?? '')) return null
  const error = status === 'failed' ? liveCheckError(release, fresh) : null
  return { release, status, at: new Date(checkedAt).toISOString(), error }
}

function liveCheckError(release: string, failures: readonly string[]): ServerUpdateError {
  const error = updateErrors.LIVE_CHECK_FAILED({
    ...(failures.length ? { why: failures.join('; ') } : {}),
    internal: { release, failedChecks: failures },
  })
  return {
    code: error.code ?? 'update.LIVE_CHECK_FAILED',
    message: error.message,
    ...(error.why ? { why: error.why } : {}),
    ...(error.fix ? { fix: error.fix } : {}),
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function linkTime(link: string) {
  try {
    return lstatSync(link).mtime.toISOString()
  } catch {
    return null
  }
}

function realTarget(link: string) {
  try {
    return realpathSync(link)
  } catch {
    return null
  }
}
