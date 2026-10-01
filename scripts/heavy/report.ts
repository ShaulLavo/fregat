#!/usr/bin/env bun
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'

import { parseSince, readLogs } from '../agent/logs'
import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptFailureText } from '../structured-errors'
import type { HeavyJobRecord } from './record'

const USAGE =
  'Usage: bun scripts/heavy/report.ts [--since 1d] [--until <time>] [--by command|label] [--sort peak|cpu|wall|jobs] [--top 20] [--log-dir <dir>] [--json]'
const GiB = 2 ** 30

type Row = {
  readonly key: string
  readonly jobs: number
  readonly failures: number
  readonly oomKills: number
  readonly peakMaxBytes: number
  readonly peakMedianBytes: number
  readonly cpuSeconds: number
  readonly wallSeconds: number
}

const groupings = {
  command: (record: HeavyJobRecord) => foldPaths(`${record.cwd}$ ${record.command.join(' ')}`),
  label: (record: HeavyJobRecord) => record.label,
}
const orders = {
  cpu: (row: Row) => row.cpuSeconds,
  jobs: (row: Row) => row.jobs,
  peak: (row: Row) => row.peakMaxBytes,
  wall: (row: Row) => row.wallSeconds,
}

try {
  await report()
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}

async function report() {
  const { values } = parseArgs({
    options: {
      by: { default: 'command', type: 'string' },
      json: { default: false, type: 'boolean' },
      'log-dir': { type: 'string' },
      since: { default: '1d', type: 'string' },
      sort: { default: 'peak', type: 'string' },
      top: { default: '20', type: 'string' },
      until: { type: 'string' },
    },
  })
  const by = values.by
  const sort = values.sort
  if (!Object.hasOwn(groupings, by) || !Object.hasOwn(orders, sort)) {
    throw createScriptError(USAGE)
  }
  const directory =
    values['log-dir'] ?? readHomeSetting(productionStateHome, 'developer.heavyJobLogDirectory')
  const records = (await readLogs({
    area: 'heavy-jobs',
    directory,
    since: parseSince(values.since),
    ...(values.until ? { until: parseSince(values.until) } : {}),
  })) as unknown as HeavyJobRecord[]

  const order = orders[sort as keyof typeof orders]
  const rows = summarize(records, groupings[by as keyof typeof groupings])
    .sort((left, right) => order(right) - order(left))
    .slice(0, Number(values.top))
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log(formatTable(rows, by))
}

function summarize(records: readonly HeavyJobRecord[], keyOf: (record: HeavyJobRecord) => string) {
  const groups = new Map<string, HeavyJobRecord[]>()
  for (const record of records) {
    const key = keyOf(record)
    const group = groups.get(key)
    if (group) group.push(record)
    else groups.set(key, [record])
  }
  return [...groups].map(([key, jobs]): Row => {
    const peaks = jobs.flatMap((job) => (job.memoryPeakBytes === null ? [] : [job.memoryPeakBytes]))
    return {
      cpuSeconds: total(jobs, (job) => job.cpuUsageUsec ?? 0) / 1e6,
      failures: jobs.filter((job) => job.exitCode !== 0).length,
      jobs: jobs.length,
      key,
      oomKills: total(jobs, (job) => job.oomKills ?? 0),
      peakMaxBytes: Math.max(0, ...peaks),
      peakMedianBytes: median(peaks),
      wallSeconds: total(jobs, (job) => job.wallMs) / 1e3,
    }
  })
}

function formatTable(rows: readonly Row[], by: string) {
  const header = ['peak max', 'peak p50', 'cpu s', 'wall s', 'cores', 'jobs', 'fail', 'oom', by]
  const lines = rows.map((row) => [
    `${(row.peakMaxBytes / GiB).toFixed(2)}G`,
    `${(row.peakMedianBytes / GiB).toFixed(2)}G`,
    row.cpuSeconds.toFixed(0),
    row.wallSeconds.toFixed(0),
    (row.wallSeconds ? row.cpuSeconds / row.wallSeconds : 0).toFixed(1),
    String(row.jobs),
    String(row.failures),
    String(row.oomKills),
    row.key,
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column]!.length)),
  )
  return [header, ...lines]
    .map((line) =>
      line
        .map((cell, column) => (column === line.length - 1 ? cell : cell.padStart(widths[column]!)))
        .join('  '),
    )
    .join('\n')
}

// Worktree and home paths differ per lane; folding them groups one command across lanes.
function foldPaths(text: string) {
  return text
    .replace(/\/work\/worktrees\/[^/\s]+\/[^/\s]+/g, '<worktree>')
    .replaceAll(homedir(), '~')
}

function total(jobs: readonly HeavyJobRecord[], field: (job: HeavyJobRecord) => number) {
  return jobs.reduce((sum, job) => sum + field(job), 0)
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}
