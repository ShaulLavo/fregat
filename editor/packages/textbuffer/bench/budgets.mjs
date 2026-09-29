import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { loadAdapter } from './adapters.mjs'
import { makeFixtures, profiles } from './fixtures.mjs'
import { prepareProbes } from './probes.mjs'
import { createCounters, isStructuralCounter } from './profile-support.mjs'
import { benchRoot } from './support.mjs'
import { prepareState, runOperations, validate } from './worker.mjs'

// Structural counters are exact executed events in the instrumented build, so
// a ceiling per workload fails CI deterministically where a timing never can.
export const budgetsFile = path.join(benchRoot, 'budgets.json')

export function readBudgets() {
  return JSON.parse(readFileSync(budgetsFile, 'utf8'))
}

export function budgetFor(count, margin) {
  return Math.ceil(count * (1 + margin))
}

// One instrumented Singapore replay per workload, counting only the operation window.
export async function measureCounters(profileName, seed) {
  assert(profiles[profileName], `Unknown profile ${profileName}`)
  const temporary = mkdtempSync(path.join(benchRoot, '.cache', 'budgets-'))
  const previous = globalThis.__textbufferBenchCounters
  try {
    const probes = prepareProbes(temporary)
    const factory = await loadAdapter('singapore', probes.roots)
    const counters = createCounters()
    globalThis.__textbufferBenchCounters = counters
    const measured = {}
    for (const fixture of makeFixtures(profileName, seed)) {
      const context = fixture.mode === 'load' ? null : prepareState(factory, fixture)
      counters.start()
      const result = runOperations(factory, fixture, context)
      const counts = counters.stop()
      validate(factory, fixture, result)
      measured[fixture.name] = Object.fromEntries(
        Object.entries(counts).filter(([name]) => isStructuralCounter(name)),
      )
    }
    return measured
  } finally {
    globalThis.__textbufferBenchCounters = previous
    rmSync(temporary, { recursive: true, force: true })
  }
}

// A budget with no measured counter is stale: the probe moved or the function
// is gone, and a ceiling nothing can exceed proves nothing.
export function compareBudgets(budgets, measured) {
  const violations = []
  for (const [workload, ceilings] of Object.entries(budgets)) {
    const counts = measured[workload]
    if (!counts) {
      violations.push({ workload, counter: null, kind: 'missing-workload' })
      continue
    }
    for (const [counter, ceiling] of Object.entries(ceilings)) {
      const count = counts[counter]
      if (count === undefined) violations.push({ workload, counter, kind: 'stale', ceiling })
      else if (count > ceiling) violations.push({ workload, counter, kind: 'over', ceiling, count })
    }
  }
  for (const [workload, counts] of Object.entries(measured)) {
    for (const counter of Object.keys(counts)) {
      if (budgets[workload]?.[counter] === undefined)
        violations.push({ workload, counter, kind: 'unbudgeted', count: counts[counter] })
    }
  }
  return violations
}

export function formatViolation(violation) {
  const where = `${violation.workload} / ${violation.counter ?? '*'}`
  if (violation.kind === 'over')
    return `${where}: ${violation.count} exceeds budget ${violation.ceiling}`
  if (violation.kind === 'stale') return `${where}: budget ${violation.ceiling} has no counter`
  if (violation.kind === 'unbudgeted') return `${where}: counter ${violation.count} has no budget`
  return `${where}: workload missing from the fixture set`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      write: { type: 'boolean', default: false },
      margin: { type: 'string' },
      profile: { type: 'string' },
    },
  })
  const file = readBudgets()
  const margin = values.margin === undefined ? file.margin : Number(values.margin)
  assert(Number.isFinite(margin) && margin >= 0 && margin < 1, 'Invalid margin')
  const names = values.profile ? [values.profile] : Object.keys(file.profiles)
  let failed = false
  for (const profileName of names) {
    const measured = await measureCounters(profileName, file.seed)
    if (values.write) {
      file.profiles[profileName] = Object.fromEntries(
        Object.entries(measured).map(([workload, counts]) => [
          workload,
          Object.fromEntries(
            Object.entries(counts).map(([counter, count]) => [counter, budgetFor(count, margin)]),
          ),
        ]),
      )
      continue
    }
    const violations = compareBudgets(file.profiles[profileName] ?? {}, measured)
    for (const violation of violations) console.log(`${profileName}: ${formatViolation(violation)}`)
    if (violations.length) failed = true
    else console.log(`${profileName}: every structural counter is within budget`)
  }
  if (values.write) {
    file.margin = margin
    writeFileSync(budgetsFile, JSON.stringify(file, null, 2) + '\n')
    console.log(`Wrote ${budgetsFile} with a ${margin * 100}% margin over the measured counts`)
  }
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main()
