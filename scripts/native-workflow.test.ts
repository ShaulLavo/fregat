import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('desktop bundle tests run after the workspace library build', () => {
  const steps = readWorkflow('macos-app.yml').jobs.bundle!.steps
  const build = steps.findIndex((step) => step.run === 'bun run build:workspaces')
  const tests = steps.findIndex((step) => step.run?.includes('bundle.test.ts'))
  expect(build).toBeGreaterThanOrEqual(0)
  expect(tests).toBeGreaterThan(build)
})
