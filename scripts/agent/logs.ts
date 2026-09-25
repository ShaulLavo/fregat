#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

export type LogEvent = Record<string, unknown> & {
  readonly timestamp: string
  readonly level: 'debug' | 'info' | 'warn' | 'error'
}

export type LogFilter = {
  readonly action?: string
  readonly area?: string
  readonly level?: LogEvent['level']
  readonly requestId?: string
  readonly since: Date
  readonly source?: string
  readonly until?: Date
}

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
// Per call: an `agent:browser` run points this at its own server's logs after import.
function logsDirectory() {
  return process.env.OBSERVABILITY_DIR
    ? resolve(process.env.OBSERVABILITY_DIR)
    : resolve(import.meta.dirname, '../../logs')
}

export async function readLogs(filter: LogFilter): Promise<LogEvent[]> {
  const until = filter.until ?? new Date()
  const files = await logFilesBetween(filter.since, until)
  const minimum = LEVELS.indexOf(filter.level ?? 'debug')
  const events: LogEvent[] = []
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      if (!line) continue
      const event = parseLine(line)
      if (!event) continue
      const at = Date.parse(event.timestamp)
      if (at < filter.since.getTime() || at > until.getTime()) continue
      if (LEVELS.indexOf(event.level) < minimum) continue
      if (filter.area && event.area !== filter.area) continue
      if (filter.source && event.source !== filter.source) continue
      if (filter.action && event.action !== filter.action) continue
      if (filter.requestId && event.requestId !== filter.requestId) continue
      events.push(event)
    }
  }
  return events
}

export function formatLogEvent(event: LogEvent): string {
  const { timestamp, level, source, area, action, message, requestId, durationMs, ...rest } = event
  const head = [timestamp, level.padEnd(5), source ?? '-', area ?? '-', action ?? message ?? '']
  const tail: string[] = []
  if (requestId) tail.push(`req=${requestId}`)
  if (durationMs !== undefined) tail.push(`${Math.round(Number(durationMs))}ms`)
  const extra = Object.entries(rest)
    .filter(([key]) => !['service', 'environment', 'pipeline'].includes(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}=${compact(value)}`)
  return [...head, ...tail, ...extra].join(' ')
}

export function parseSince(value: string): Date {
  const match = /^(\d+)([smhd])$/.exec(value)
  if (!match) return new Date(value)
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!]!
  return new Date(Date.now() - Number(match[1]) * unit)
}

// A day rolls into numbered continuations; the highest number is the newest.
async function logFilesBetween(since: Date, until: Date) {
  const days = new Set<string>()
  for (let at = dayStart(since); at <= until.getTime(); at += 86_400_000) {
    days.add(new Date(at).toISOString().slice(0, 10))
  }
  days.add(until.toISOString().slice(0, 10))
  const directory = logsDirectory()
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.jsonl'),
  )
  return names
    .filter((name) => days.has(name.slice(0, 10)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => join(directory, name))
}

function dayStart(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function parseLine(line: string): LogEvent | null {
  try {
    const parsed = JSON.parse(line)
    if (typeof parsed?.timestamp !== 'string' || typeof parsed?.level !== 'string') return null
    return parsed as LogEvent
  } catch {
    return null
  }
}

function compact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },
      area: { type: 'string' },
      follow: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      level: { type: 'string' },
      request: { type: 'string' },
      since: { type: 'string', default: '5m' },
      source: { type: 'string' },
      until: { type: 'string' },
    },
  })
  const filter: LogFilter = {
    action: values.action,
    area: values.area,
    level: values.level as LogEvent['level'] | undefined,
    requestId: values.request,
    since: parseSince(values.since),
    source: values.source,
    until: values.until ? parseSince(values.until) : undefined,
  }
  let cursor = filter.since
  const print = async () => {
    const events = await readLogs({ ...filter, since: cursor })
    for (const event of events)
      console.log(values.json ? JSON.stringify(event) : formatLogEvent(event))
    const last = events.at(-1)
    if (last) cursor = new Date(Date.parse(last.timestamp) + 1)
  }
  await print()
  if (values.follow) {
    setInterval(() => void print(), 1_000)
  }
}
