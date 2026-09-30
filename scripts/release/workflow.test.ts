import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readWorkflow, type WorkflowJob } from './workflow.ts'
import assert from 'node:assert/strict'

const workflow = readWorkflow(
  await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'),
)

function runs(job: WorkflowJob, enabled: string | undefined, pending: string) {
  if (!job.if) return true
  const condition = job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  const evaluate = new Function('vars', 'needs', `return (${condition})`)
  return evaluate(
    { NPM_TRUSTED_PUBLISHING: enabled },
    { version: { outputs: { hasChangesets: pending } } },
  )
}

test('version preparation never receives OIDC permission or a publish command', () => {
  expect(workflow.permissions['id-token']).not.toBe('write')
  const versionJobs = Object.values(workflow.jobs).filter((job) =>
    job.steps.some((step) => step.with?.['version-script']),
  )
  expect(versionJobs).toHaveLength(1)
  const version = versionJobs[0]
  expect(version.permissions['id-token']).not.toBe('write')
  const action = version.steps.find((step) => step.with?.['version-script'])
  assert(action?.with)
  expect(action.with['publish-script']).toBeUndefined()
  expect(workflow.jobs.version.outputs.hasChangesets).toBe(
    '${{ steps.changesets.outputs.has-changesets }}',
  )
  expect(action.id).toBe('changesets')
})

test.each([
  [undefined, 'false', false],
  ['false', 'false', false],
  [undefined, 'true', false],
  ['false', 'true', false],
  ['true', 'true', false],
  ['true', '', false],
  ['true', 'false', true],
])(
  'OIDC publishing with switch %s and pending changesets %s runs=%s',
  (enabled, pending, expected) => {
    const publishingJobs = Object.values(workflow.jobs).filter(
      (job) => job.permissions?.['id-token'] === 'write',
    )
    expect(publishingJobs).toHaveLength(1)
    expect(runs(publishingJobs[0], enabled, pending)).toBe(expected)
    expect(publishingJobs[0].needs).toBe('version')
  },
)
