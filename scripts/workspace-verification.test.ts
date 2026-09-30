import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('canonical Editor CI checks the generated language catalog', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run).join('\n')).toContain(
    'bun run --cwd editor/packages/tree-sitter-languages languages:generate -- --check',
  )
})

test('canonical ghostty CI runs the standalone verification contract', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  expect(steps.map((step) => step.run)).toContain('bun run --cwd ghostty-webgpu verify')
})

test('canonical ghostty CI checks the host package when native artifacts are assembled', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  const classifier = steps.find((step) => step.id === 'native-state')
  expect(classifier?.run).toContain('verify-config-resolver-artifacts.ts --state either')
  expect(classifier?.run).toContain('echo "state=$state" >> "$GITHUB_OUTPUT"')
  const host = steps.find((step) => step.run === 'bun run --cwd ghostty-webgpu test:package:host')
  expect(host?.if).toBe("${{ steps.native-state.outputs.state == 'assembled' }}")
})
