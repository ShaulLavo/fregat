import { readdirSync } from 'node:fs'
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
        [...(step.run ?? '').matchAll(/gh workflow run ([\w.-]+\.yml)/g)].map((match) => match[1]!),
      ),
    )
  })
  expect(targets).toContain('ci.yml')
  for (const target of targets) {
    expect(readWorkflow(target).on, target).toHaveProperty('workflow_dispatch')
  }
})

test('the parser updater dispatches the CI verdict that includes Editor checks', () => {
  const workflow = readWorkflow('editor-tree-sitter-x.yml')
  const commands = workflow.jobs.update!.steps.map((step) => step.run ?? '').join('\n')
  expect(commands).toContain('gh workflow run ci.yml --ref "$branch"')
  expect(readWorkflow('ci.yml').jobs.verdict!.needs).toContain('libraries')
})
