#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parseSince, readLogs, type LogEvent } from '../agent/logs'

/**
 * Runtime log noise (AGENTS.md "Logs"). Warn and error lines are grouped by level, area, action
 * (or HTTP route) and error code. A group is noise when it passes its line budget, or when it
 * repeats without a ten-minute gap for over an hour. Checkpoint lines are skipped: a failed
 * scope's final line already carries the failure.
 */

const DAY_MS = 86_400_000
const DAILY_BUDGET = 50
const REPEAT_GAP_MS = 10 * 60_000
const SUSTAINED_MS = 60 * 60_000
const DEFAULT_ALLOW = resolve(import.meta.dirname, 'log-noise-allow.json')

export type NoiseGroup = {
  readonly key: string
  readonly count: number
  readonly first: string
  readonly last: string
  /** Longest run with no gap over ten minutes. */
  readonly longestRunMs: number
  readonly reasons: readonly string[]
  readonly allowed: string | null
  readonly sample: string
}

export type NoiseCensus = {
  readonly since: string
  readonly until: string
  readonly lines: number
  readonly budget: number
  readonly groups: readonly NoiseGroup[]
  /** Noisy groups the allow list does not excuse. */
  readonly failures: readonly NoiseGroup[]
  readonly allowProblems: readonly string[]
}

export type NoiseOptions = {
  readonly directory?: string
  readonly since: Date
  readonly until?: Date
  readonly allowFile?: string
}

export async function logNoiseCensus(options: NoiseOptions): Promise<NoiseCensus> {
  const until = options.until ?? new Date()
  const events = await readLogs({
    directory: options.directory,
    level: 'warn',
    since: options.since,
    until,
  })
  const budget = Math.round((DAILY_BUDGET * (until.getTime() - options.since.getTime())) / DAY_MS)
  const allow = readAllowList(options.allowFile ?? DEFAULT_ALLOW)
  const buckets = new Map<string, LogEvent[]>()
  for (const event of events) {
    if (event.checkpoint !== undefined) continue
    const key = groupKey(event)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(event)
    else buckets.set(key, [event])
  }

  const groups = [...buckets].map(([key, bucket]) => judge(key, bucket, budget, allow.entries))
  groups.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  return {
    since: options.since.toISOString(),
    until: until.toISOString(),
    lines: groups.reduce((total, group) => total + group.count, 0),
    budget,
    groups,
    failures: groups.filter((group) => group.reasons.length > 0 && group.allowed === null),
    allowProblems: allow.problems,
  }
}

/** `level area action code`, with `-` for a missing part and the route standing in for an HTTP action. */
export function groupKey(event: LogEvent) {
  const action = stringField(event.action) ?? httpRoute(event) ?? '-'
  return [event.level, stringField(event.area) ?? '-', action, errorCode(event) ?? '-'].join(' ')
}

function judge(key: string, bucket: readonly LogEvent[], budget: number, allow: AllowEntries) {
  const times = bucket.map((event) => Date.parse(event.timestamp)).sort((a, b) => a - b)
  const longestRunMs = longestRun(times)
  const reasons: string[] = []
  if (bucket.length > budget) reasons.push(`${bucket.length} lines, budget ${budget}`)
  if (longestRunMs > SUSTAINED_MS) reasons.push(`repeats for ${formatDuration(longestRunMs)}`)
  return {
    key,
    count: bucket.length,
    first: new Date(times[0]!).toISOString(),
    last: new Date(times.at(-1)!).toISOString(),
    longestRunMs,
    reasons,
    allowed: allow.get(key) ?? null,
    sample: sampleOf(bucket.at(-1)!),
  }
}

function longestRun(times: readonly number[]) {
  let start = times[0]!
  let previous = start
  let longest = 0
  for (const at of times) {
    if (at - previous > REPEAT_GAP_MS) start = at
    previous = at
    longest = Math.max(longest, at - start)
  }
  return longest
}

type AllowEntries = ReadonlyMap<string, string>

function readAllowList(file: string) {
  const entries = new Map<string, string>()
  const problems: string[] = []
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  for (const [key, reason] of Object.entries(parsed)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${key}: an allow entry needs a reason`)
      continue
    }
    entries.set(key, reason)
  }
  return { entries, problems }
}

function stringField(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null
}

const SAMPLE_FIELDS = ['status', 'exitCode', 'signal', 'closeCode', 'reason'] as const

function sampleOf(event: LogEvent) {
  const facts = SAMPLE_FIELDS.filter((field) => event[field] !== undefined).map(
    (field) => `${field}=${String(event[field])}`,
  )
  const message = errorMessage(event) ?? stringField(event.message) ?? ''
  return [event.timestamp, stringField(event.source) ?? '-', message, ...facts].join(' ')
}

function errorMessage(event: LogEvent) {
  const error = event.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return stringField(error.message)
  return null
}

function errorCode(event: LogEvent) {
  const error = event.error
  if (error && typeof error === 'object' && 'code' in error) return stringField(error.code)
  return stringField(event.code)
}

// Ids in a path would split one route into a group per resource.
function httpRoute(event: LogEvent) {
  const path = stringField(event.path)
  if (!path) return null
  const route = path
    .split('/')
    .map((segment) => (isIdSegment(segment) ? ':id' : segment))
    .join('/')
  return `${stringField(event.method) ?? 'HTTP'} ${route}`
}

function isIdSegment(segment: string) {
  if (/^\d+$/.test(segment)) return true
  if (/^[0-9a-f-]{8,}$/i.test(segment) && /\d/.test(segment)) return true
  return segment.length >= 12 && /\d/.test(segment) && /^[\w-]+$/.test(segment)
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function formatCensus(census: NoiseCensus, top: number) {
  const lines = [
    `log noise census: ${census.lines} warn/error lines, ${census.since} → ${census.until}`,
    `  budget per group: ${census.budget} lines; repeats without a 10m gap for over 1h`,
  ]
  const shown = census.groups.filter(
    (group, index) => index < top || census.failures.includes(group),
  )
  for (const group of shown) lines.push(...formatGroup(group))
  if (census.groups.length > shown.length)
    lines.push(`  … and ${census.groups.length - shown.length} quieter groups`)
  for (const problem of census.allowProblems) lines.push(`  allow-list  ${problem}`)
  return lines.join('\n')
}

function formatGroup(group: NoiseGroup) {
  const verdict = groupVerdict(group)
  return [
    `  ${String(group.count).padStart(6)}  ${group.key}${verdict}`,
    `          ${group.sample.slice(0, 220)}`,
  ]
}

function groupVerdict(group: NoiseGroup) {
  if (group.reasons.length === 0) return ''
  if (group.allowed !== null) return `  (allowed: ${group.allowed})`
  return `  NOISE: ${group.reasons.join('; ')}`
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      allow: { type: 'string' },
      check: { type: 'boolean', default: false },
      dir: { type: 'string' },
      json: { type: 'boolean', default: false },
      since: { type: 'string', default: '24h' },
      top: { type: 'string', default: '15' },
      until: { type: 'string' },
    },
  })
  const census = await logNoiseCensus({
    allowFile: values.allow,
    directory: values.dir ? resolve(values.dir) : undefined,
    since: parseSince(values.since),
    until: values.until ? new Date(values.until) : undefined,
  })
  console.log(
    values.json ? JSON.stringify(census, null, 2) : formatCensus(census, Number(values.top)),
  )
  const failed = census.failures.length > 0 || census.allowProblems.length > 0
  if (values.check && !values.json)
    console.log(failed ? 'gate: noisy log groups found' : 'gate: no log group is noise')
  if (values.check && failed) process.exit(1)
}
