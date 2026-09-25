import type { LiveCheckVerdict, ServerUpdateError, StagedRelease } from '@workspace/contracts'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

import { updateErrors } from './structured-errors'

export type StagedReleaseRead =
  | { staged: StagedRelease; reason: null }
  | { staged: null; reason: 'no-root' | 'absent' | 'dangling' | 'same-as-running' }

// Written by scripts/deploy/live-check.mjs; reports without `status` predate the verdict.
const liveCheckReportSchema = v.object({
  release: v.pipe(v.string(), v.nonEmpty()),
  status: v.picklist(['passed', 'failed']),
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  fresh: v.optional(v.array(v.string()), []),
})

const buildConfigSchema = v.object({
  source: v.optional(v.nullable(v.string()), null),
  previousRelease: v.optional(v.nullable(v.string()), null),
})

/** `<root>/pending`, the release `deploy --server` staged, unless the server already runs it. */
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
  const error =
    status === 'failed' ? liveCheckError(release, fresh[0], readBuildConfig(current)) : null
  return { release, status, at: new Date(checkedAt).toISOString(), error }
}

function liveCheckError(
  release: string,
  failure: string | undefined,
  config: v.InferOutput<typeof buildConfigSchema> | null,
): ServerUpdateError {
  const previous = config?.previousRelease ? path.basename(config.previousRelease) : null
  const error = updateErrors.LIVE_CHECK_FAILED({
    release,
    ...(failure ? { why: failure } : {}),
    ...(config?.source && previous
      ? { fix: `Run bun run deploy --rollback in ${config.source} to return to ${previous}.` }
      : {}),
  })
  return {
    code: error.code ?? 'update.LIVE_CHECK_FAILED',
    message: error.message,
    ...(error.why ? { why: error.why } : {}),
    ...(error.fix ? { fix: error.fix } : {}),
  }
}

function readBuildConfig(current: string) {
  const config = v.safeParse(buildConfigSchema, readJson(path.join(current, 'build-config.json')))
  return config.success ? config.output : null
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
