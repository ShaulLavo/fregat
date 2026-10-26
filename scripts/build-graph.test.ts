import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'

const repository = path.resolve(import.meta.dirname, '..')
const buildGraphSchema = v.object({
  tasks: v.array(
    v.object({
      taskId: v.string(),
      directory: v.string(),
      dependencies: v.array(v.string()),
    }),
  ),
})
const manifestSchema = v.object({ scripts: v.record(v.string(), v.string()) })

function buildTasks(args: string[]) {
  const result = Bun.spawnSync(['bun', 'x', 'turbo', 'run', 'build', ...args, '--dry=json'], {
    cwd: repository,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return v.parse(buildGraphSchema, JSON.parse(result.stdout.toString())).tasks
}

test('workspace builds contain only Fregat consumers', () => {
  const tasks = buildTasks([])
  expect(tasks.length).toBeGreaterThan(0)
  for (const task of tasks) {
    expect(task.directory).not.toMatch(/^packages\/(singapore|ghostty-webgpu|hotkeys)(\/|$)/)
    expect(task.taskId).not.toMatch(/^(@singapore-editor\/|@fregat\/|ghostty-webgpu)/)
    expect(task.dependencies).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(@singapore-editor\/|@fregat\/|ghostty-webgpu)/),
      ]),
    )
  }
})

test('consumer preparation builds UI without rebuilding installed releases', () => {
  const root = v.parse(
    manifestSchema,
    JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8')),
  )
  expect(root.scripts['build:workspaces']).toBe('turbo run build --filter=@workspace/ui')
  expect(buildTasks(['--filter=@workspace/ui']).map((task) => task.taskId)).toEqual([
    '@workspace/ui#build',
  ])
})
