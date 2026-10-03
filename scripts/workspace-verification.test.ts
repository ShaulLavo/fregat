import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('CI shares each ref group and cancels only older PR runs', () => {
  const source = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  expect(Bun.YAML.parse(source)).toHaveProperty('concurrency', {
    group: 'ci-${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': "${{ startsWith(github.ref, 'refs/pull/') }}",
  })
})

test('the main CI verdict includes all reusable library checks', () => {
  const workflow = readWorkflow('ci.yml')
  expect(workflow.jobs.libraries!.uses).toBe('./.github/workflows/workspace-libraries.yml')
  expect(workflow.jobs.verdict!.needs).toContain('libraries')
  expect(readWorkflow('workspace-libraries.yml').on).toHaveProperty('workflow_call')
})

test('standalone checks cover every mirror family from an exact folder export', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.standalone!.steps
  expect(steps.find((step) => step.name === 'Export exact mirror folder')?.run).toContain(
    'git archive "HEAD:$FAMILY"',
  )
  expect(
    steps.find((step) => step.name === 'Install and verify standalone package graph')?.run,
  ).toBe(
    'bun install && bun run build && bun run typecheck && bun run lint && bun run format:check',
  )
})

test('CI verifies the family sites that the Pages workflow deploys', () => {
  const steps = readWorkflow('ci.yml').jobs.site!.steps
  expect(steps.map((step) => step.name)).toContain('Build Editor example')
  expect(steps.map((step) => step.name)).toContain('Build ghostty site')
})

test('canonical Editor CI checks the generated language catalog', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run).join('\n')).toContain(
    'bun run --cwd editor/packages/tree-sitter-languages languages:generate -- --check',
  )
})

test('canonical Editor CI includes architecture health', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run)).toContain('bun run --cwd editor health')
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

test('standalone Editor checks shared runtime identity and Markdown initialization', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.standalone!.steps
  const runtime = steps.find((step) => step.name === 'Check standalone tree-sitter runtime')
  expect(runtime?.if).toBe("${{ matrix.family == 'editor' }}")
  expect(runtime?.['working-directory']).toBe('${{ runner.temp }}/mirror')
  expect(runtime?.run).toBe('bun run --cwd packages/tree-sitter test:runtime')
})

test('standalone Editor also checks the exact clean hoisted graph', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.standalone!.steps
  const runtime = steps.find((step) => step.name === 'Check hoisted standalone tree-sitter runtime')
  expect(runtime?.if).toBe("${{ matrix.family == 'editor' }}")
  expect(runtime?.run).toContain('git archive HEAD:editor')
  expect(runtime?.run).toContain('bun install --linker=hoisted')
  expect(runtime?.run).toContain('bun run --cwd packages/tree-sitter test:runtime')
})

test('automatic bump branches include the matched Markdown source', () => {
  const steps = readWorkflow('editor-tree-sitter-x.yml').jobs.update!.steps
  const branch = steps.find((step) => step.name === 'Open a pull request')
  expect(branch?.run).toContain('branch="tree-sitter-x/$pin-$markdown"')
})
