import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('every explicitly dispatched workflow accepts workflow_dispatch', () => {
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
  expect(targets).toContain('ci.yml')
  for (const target of targets)
    expect(readWorkflow(target).on, target).toHaveProperty('workflow_dispatch')
})

test('the parser updater dispatches the full CI verdict after publishing', () => {
  const workflow = readWorkflow('editor-tree-sitter-x.yml')
  const commands = workflow.jobs.publish!.steps.map((step) => step.run ?? '').join('\n')
  expect(commands).toContain('gh workflow run ci.yml --ref "$branch"')
  expect(readWorkflow('ci.yml').jobs.verdict!.needs).toContain('libraries')
})

test('the parser merge workflow reads trusted default-branch code', () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../.github/workflows/editor-parser-pin-merge.yml'),
    'utf8',
  )
  expect(source).toContain('workflow_run:')
  expect(source).toContain('ref: refs/heads/main')
  expect(source).toContain('persist-credentials: false')
})
