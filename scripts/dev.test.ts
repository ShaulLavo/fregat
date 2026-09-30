import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

test.each([
  ['dev', ['desktop#dev', 'server#dev', 'web#dev']],
  ['dev:web', ['server#dev', 'web#dev']],
  ['dev:upstream', ['server#dev', 'web#dev']],
])('%s starts only Fregat applications', (script, expected) => {
  const result = Bun.spawnSync(['bun', 'run', script, '--dry=json'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const output = result.stdout.toString()
  const graph = JSON.parse(output.slice(output.indexOf('{')))
  expect(graph.tasks.map((task: { taskId: string }) => task.taskId).sort()).toEqual(expected)
})
