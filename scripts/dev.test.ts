import path from 'node:path'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

test.each([
  ['dev', ['desktop#dev', 'server#dev', 'web#dev']],
  ['dev:web', ['server#dev', 'web#dev']],
  ['dev:upstream', ['server#dev', 'web#dev']],
])('%s starts only Fregat applications', (script, expected) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-dev-graph-'))
  const outputPath = path.join(directory, 'graph.json')
  const outputFile = openSync(outputPath, 'w')
  try {
    // Turbo's large JSON summary can exhaust the test runner's synchronous capture pipe.
    const result = Bun.spawnSync(['bun', 'run', script, '--dry=json'], {
      cwd: root,
      stdout: outputFile,
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const output = readFileSync(outputPath, 'utf8')
    const graph = JSON.parse(output.slice(output.indexOf('{')))
    expect(graph.tasks.map((task: { taskId: string }) => task.taskId).sort()).toEqual(expected)
  } finally {
    closeSync(outputFile)
    rmSync(directory, { recursive: true, force: true })
  }
})
