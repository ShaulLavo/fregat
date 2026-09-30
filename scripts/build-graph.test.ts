import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function siteTask() {
  const result = Bun.spawnSync(
    ['bun', 'x', 'turbo', 'run', 'build', '--filter=ghostty-webgpu-site', '--dry=json'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const graph = JSON.parse(result.stdout.toString())
  return graph.tasks.find((task: { taskId: string }) => task.taskId === 'ghostty-webgpu-site#build')
}

test('the ghostty site builds after its library', () => {
  expect(siteTask().dependencies).toContain('ghostty-webgpu#build')
})

test('a library source change invalidates the ghostty site build cache', () => {
  const before = siteTask().hash
  const probe = path.join(root, 'ghostty-webgpu/src/turbo-cache-probe.ts')
  writeFileSync(probe, 'export const cacheProbe = true\n', { flag: 'wx' })
  try {
    expect(siteTask().hash).not.toBe(before)
  } finally {
    rmSync(probe)
  }
})
