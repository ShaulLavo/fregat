import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('CI and every explicitly dispatched workflow accept workflow_dispatch', () => {
  const directory = path.resolve(import.meta.dirname, '../.github/workflows')
  const sources = readdirSync(directory).filter((file) => file.endsWith('.yml'))
  const targets = sources.flatMap((file) => {
    const workflow = readWorkflow(file)
    return Object.values(workflow.jobs).flatMap((job) =>
      job.steps.flatMap((step) =>
        Array.from(
          (step.run ?? '').matchAll(/gh workflow run ([\w.-]+\.yml)/g),
          (match) => match[1]!,
        ),
      ),
    )
  })
  for (const target of ['ci.yml'].concat(targets))
    expect(readWorkflow(target).on, target).toHaveProperty('workflow_dispatch')
})

test('manual CI keeps consumer builds and tests in the blocking verdict', () => {
  const workflow = readWorkflow('ci.yml')
  const plan = workflow.jobs.changes!.steps.find((step) => step.id === 'plan')
  expect(plan?.run).toContain('MODE=full')
  expect(workflow.jobs.verdict!.if).toBe('${{ always() }}')
  expect(workflow.jobs.verdict!.needs).toEqual(
    expect.arrayContaining([
      'changes',
      'lint',
      'workspace-builds',
      'typecheck',
      'test-scripts',
      'test-packages',
      'test-web',
      'test-server',
      'test-tui',
      'browser',
    ]),
  )
  expect(workflow.jobs['test-scripts']!.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ run: expect.stringContaining('bun run test:scripts') }),
    ]),
  )
})

test.each(['editor-tree-sitter-x.yml', 'editor-parser-pin-merge.yml'])(
  'standalone parser publishing has no consumer workflow %s',
  (file) => {
    expect(existsSync(path.resolve(import.meta.dirname, '../.github/workflows', file))).toBe(false)
  },
)
