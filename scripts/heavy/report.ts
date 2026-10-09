#!/usr/bin/env bun
import path from 'node:path'
import { parseArgs } from 'node:util'

import { parseSince, readLogs } from '../agent/logs'
import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptFailureText } from '../structured-errors'
import type { HeavyJobRecord } from './record'

const USAGE =
  'Usage: bun /work/platform-production/heavy/current/report.js [--since 1d] [--until <time>] [--by command|label|class] [--sort peak|cpu|wall|jobs] [--top 20] [--log-dir <dir>] [--json]'
const GiB = 2 ** 30

/** Usage sums and peaks cover measured jobs only; null means no job in the row was measured. */
type Row = {
  readonly key: string
  readonly jobs: number
  /** Jobs whose scope was killed before its totals were read. */
  readonly unmeasuredJobs: number
  readonly failures: number
  readonly oomKills: number | null
  readonly peakMaxBytes: number | null
  readonly peakMedianBytes: number | null
  readonly cpuSeconds: number | null
  readonly wallSeconds: number
}

type Group = { readonly id: string; readonly display: string }

const groupings = {
  // One repository's worktrees share `repo`; argv stays an array so its boundaries count.
  command: (record: HeavyJobRecord): Group => ({
    display: `${record.repo === null ? record.cwd : path.join(record.repo, record.subdir ?? '')}$ ${shellQuote(record.command)}`,
    id: JSON.stringify([
      record.repo,
      record.repo === null ? record.cwd : record.subdir,
      record.command,
    ]),
  }),
  class: (record: HeavyJobRecord): Group => {
    const name = record.class ?? `host ${record.host}`
    return { display: name, id: name }
  },
  label: (record: HeavyJobRecord): Group => ({ display: record.label, id: record.label }),
}
const orders = {
  cpu: (row: Row) => row.cpuSeconds ?? -1,
  jobs: (row: Row) => row.jobs,
  peak: (row: Row) => row.peakMaxBytes ?? -1,
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

function summarize(records: readonly HeavyJobRecord[], groupOf: (record: HeavyJobRecord) => Group) {
  const groups = new Map<string, { display: string; jobs: HeavyJobRecord[] }>()
  for (const record of records) {
    const { display, id } = groupOf(record)
    const group = groups.get(id)
    if (group) group.jobs.push(record)
    else groups.set(id, { display, jobs: [record] })
  }
  return Array.from(groups.values(), ({ display, jobs }): Row => {
    const peaks = measured(jobs, (job) => job.memoryPeakBytes)
    const cpu = measured(jobs, (job) => job.cpuUsageUsec)
    const ooms = measured(jobs, (job) => job.oomKills)
    return {
      cpuSeconds: cpu.length ? cpu.reduce(add, 0) / 1e6 : null,
      failures: jobs.filter((job) => job.exitCode !== 0).length,
      jobs: jobs.length,
      key: display,
      oomKills: ooms.length ? ooms.reduce(add, 0) : null,
      peakMaxBytes: peaks.length ? Math.max(...peaks) : null,
      peakMedianBytes: peaks.length ? median(peaks) : null,
      unmeasuredJobs: jobs.filter(
        (job) => job.memoryPeakBytes === null || job.cpuUsageUsec === null || job.oomKills === null,
      ).length,
      wallSeconds: jobs.reduce((total, job) => total + job.wallMs, 0) / 1e3,
    }
  })
}

// `?` is unknown; `≥` and `+` mark a total that leaves out unmeasured jobs.
function formatTable(rows: readonly Row[], by: string) {
  const header = [
    'peak max',
    'peak p50',
    'cpu s',
    'wall s',
    'cores',
    'jobs',
    'unmeasured',
    'fail',
    'oom',
    by,
  ]
  const lines = rows.map((row) => {
    const partial = row.unmeasuredJobs > 0
    const cores =
      row.cpuSeconds === null || !row.wallSeconds ? null : row.cpuSeconds / row.wallSeconds
    return [
      known(row.peakMaxBytes, (value) => `${partial ? '≥' : ''}${gib(value)}`),
      known(row.peakMedianBytes, gib),
      known(row.cpuSeconds, (value) => `${value.toFixed(0)}${partial ? '+' : ''}`),
      row.wallSeconds.toFixed(0),
      known(cores, (value) => value.toFixed(1)),
      String(row.jobs),
      String(row.unmeasuredJobs),
      String(row.failures),
      known(row.oomKills, (value) => `${value}${partial ? '+' : ''}`),
      row.key,
    ]
  })
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column]!.length)),
  )
  return [header]
    .concat(lines)
    .map((line) =>
      line
        .map((cell, column) => (column === line.length - 1 ? cell : cell.padStart(widths[column]!)))
        .join('  '),
    )
    .join('\n')
}

function known(value: number | null, format: (value: number) => string) {
  return value === null ? '?' : format(value)
}

function gib(bytes: number) {
  return `${(bytes / GiB).toFixed(2)}G`
}

function shellQuote(argv: readonly string[]) {
  return argv
    .map((argument) =>
      /^[\w@%+=:,./-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(' ')
}

function measured(jobs: readonly HeavyJobRecord[], field: (job: HeavyJobRecord) => number | null) {
  return jobs.flatMap((job) => {
    const value = field(job)
    return value === null ? [] : [value]
  })
}

function add(left: number, right: number) {
  return left + right
}

function median(values: number[]) {
  const sorted = values.sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}
