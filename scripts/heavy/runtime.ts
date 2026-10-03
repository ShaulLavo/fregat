import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { unlessMissing, unlock, waitLock } from './lock'
import { live, type Entry } from './queue'
import type { JobDuringRun } from './record'

type Run = JobDuringRun & { readonly quiet: boolean }
type Journal = Record<string, JobDuringRun>

/** Launch and settlement share a short mutex, independent of asynchronous orphan admission. */
export function beginRun<T>(stateDir: string, entry: Entry, launch: () => T): T {
  return underLock(stateDir, () => {
    const owners = new Set(live(stateDir, 'jobs').map((job) => job.id))
    const active = readRuns(stateDir).filter((run) => {
      if (owners.has(run.id)) return true
      removeRun(stateDir, run.id)
      return false
    })
    const run: Run = {
      allowedCpus: entry.allowedCpus ?? [],
      class: entry.jobClass,
      cwd: entry.cwd,
      endedAt: null,
      id: entry.id,
      label: entry.label,
      pid: entry.pid,
      quiet: entry.quiet,
      server: entry.server,
      sliceRoot: entry.sliceRoot,
      startedAt: new Date().toISOString(),
    }
    try {
      writeJson(runFile(stateDir, run.id), run)
      if (run.quiet) {
        writeJson(
          journalFile(stateDir, run.id),
          Object.fromEntries(active.map((job) => [job.id, overlap(job)])),
        )
      }
      for (const measurement of active.filter((job) => job.quiet)) {
        const journal = readJournal(stateDir, measurement.id)
        journal[run.id] = overlap(run)
        writeJson(journalFile(stateDir, measurement.id), journal)
      }
      return launch()
    } catch (error) {
      for (const measurement of active.filter((job) => job.quiet)) {
        const journal = readJournal(stateDir, measurement.id)
        delete journal[run.id]
        writeJson(journalFile(stateDir, measurement.id), journal)
      }
      removeRun(stateDir, run.id)
      throw error
    }
  })
}

/** Finished overlaps stay in the measurement's journal after their live entries disappear. */
export function finishRun(stateDir: string, id: string): readonly JobDuringRun[] {
  return underLock(stateDir, () => {
    const active = readRuns(stateDir)
    if (!active.some((run) => run.id === id)) return []
    const endedAt = new Date().toISOString()
    for (const measurement of active.filter((run) => run.quiet && run.id !== id)) {
      const journal = readJournal(stateDir, measurement.id)
      if (!journal[id]) continue
      journal[id] = { ...journal[id], endedAt }
      writeJson(journalFile(stateDir, measurement.id), journal)
    }
    const jobs = Object.values(readJournal(stateDir, id)).toSorted(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
    )
    removeRun(stateDir, id)
    return jobs
  })
}

function overlap({ quiet: _quiet, ...job }: Run): JobDuringRun {
  return job
}

function underLock<T>(stateDir: string, action: () => T): T {
  const fd = waitLock(path.join(stateDir, 'runtime.lock'))
  try {
    return action()
  } finally {
    unlock(fd)
  }
}

function readRuns(stateDir: string): Run[] {
  const dir = path.join(stateDir, 'runs')
  return (unlessMissing(() => readdirSync(dir)) ?? [])
    .filter((name) => /^[0-9a-f]{12}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Run)
}

function readJournal(stateDir: string, id: string): Journal {
  const text = unlessMissing(() => readFileSync(journalFile(stateDir, id), 'utf8'))
  return text ? (JSON.parse(text) as Journal) : {}
}

function writeJson(file: string, value: Run | Journal) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(value))
  renameSync(`${file}.tmp`, file)
}

function runFile(stateDir: string, id: string) {
  return path.join(stateDir, 'runs', `${id}.json`)
}

function journalFile(stateDir: string, id: string) {
  return path.join(stateDir, 'measurements', `${id}.json`)
}

function removeRun(stateDir: string, id: string) {
  for (const file of [runFile(stateDir, id), journalFile(stateDir, id)]) {
    rmSync(file, { force: true })
    rmSync(`${file}.tmp`, { force: true })
  }
}
