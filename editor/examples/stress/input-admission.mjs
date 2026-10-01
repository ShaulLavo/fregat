import { readInputArtifact } from './input-artifacts.mjs'
import { pathToFileURL } from 'node:url'
import { inputScenarios, inputViewModes } from './input-results.mjs'

export const fullInputFixtures = Object.freeze(['ordinary', 'short-lines', 'long-line'])
const blockingMetrics = ['inputToApplied', 'dispatch', 'inputToFrame']
const advisoryMetrics = ['burstToPaintUpperBound']

/** The fixture/view/scenario groups a run measured, from its recorded workload. */
export function workloadGroups(run) {
  const unsupported = run.config.unsupportedFixtures ?? []
  const fixtures = fullInputFixtures.filter((id) => !unsupported.includes(id))
  return fixtures.flatMap((fixture) =>
    inputViewModes.flatMap((views) =>
      inputScenarios.map((scenario) => `${fixture}/${views}/${scenario}`),
    ),
  )
}

// Admission requires the exact metric shape and every dispatch group to fail.
// The full matrix has 36 groups (108 blocking, 36 advisory); smaller shapes remain partial.
export function admitDelayedControl(check, groups) {
  const reject = (reason) => ({ admitted: false, full: false, reason })
  if (check?.kind !== 'delayed-control') return reject('not a delayed-control check')
  if (new Set(groups).size !== groups.length) return reject('expected groups repeat')
  const byGroup = new Map()
  for (const metric of check.metrics ?? []) {
    const cut = metric.key.lastIndexOf('/')
    const group = metric.key.slice(0, cut)
    const name = metric.key.slice(cut + 1)
    const names = byGroup.get(group) ?? []
    names.push({ name, metric })
    byGroup.set(group, names)
  }
  const unexpected = [...byGroup.keys()].filter((group) => !groups.includes(group))
  if (unexpected.length) return reject(`unexpected groups: ${unexpected.join(', ')}`)
  for (const group of groups) {
    const entries = byGroup.get(group) ?? []
    const names = entries.map((entry) => entry.name).sort()
    const expected = [...blockingMetrics, ...advisoryMetrics].sort()
    if (JSON.stringify(names) !== JSON.stringify(expected))
      return reject(`group ${group} has metrics ${names.join(',') || 'none'}`)
    for (const { name, metric } of entries) {
      if (metric.blocking !== blockingMetrics.includes(name))
        return reject(`group ${group} ${name} has the wrong blocking flag`)
    }
    const dispatch = entries.find((entry) => entry.name === 'dispatch').metric
    if (dispatch.passed !== false) return reject(`dispatch group ${group} passed`)
  }
  const blocking = check.metrics.filter((metric) => metric.blocking).length
  const advisory = check.metrics.length - blocking
  const full =
    groups.length === fullInputFixtures.length * inputViewModes.length * inputScenarios.length
  return {
    admitted: true,
    full,
    reason: `${blocking} blocking, ${advisory} advisory`,
    blocking,
    advisory,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [checkPath, runPath] = process.argv.slice(2)
  const check = await readInputArtifact(checkPath)
  const run = await readInputArtifact(runPath)
  const verdict = admitDelayedControl(check, workloadGroups(run))
  console.log(JSON.stringify(verdict))
  if (!verdict.admitted || !verdict.full) process.exitCode = 1
}
