import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function buildTask(packageName: string) {
  const result = Bun.spawnSync(
    ['bun', 'x', 'turbo', 'run', 'build', `--filter=${packageName}`, '--dry=json'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  const graph = JSON.parse(result.stdout.toString())
  return graph.tasks.find((task: { taskId: string }) => task.taskId === `${packageName}#build`)
}

test('the ghostty site builds after its library', () => {
  expect(buildTask('ghostty-webgpu-site').dependencies).toContain('ghostty-webgpu#build')
})

test('a library source change invalidates the ghostty site build cache', () => {
  const before = buildTask('ghostty-webgpu-site').hash
  const probe = path.join(root, 'ghostty-webgpu/src/turbo-cache-probe.ts')
  writeFileSync(probe, 'export const cacheProbe = true\n', { flag: 'wx' })
  try {
    expect(buildTask('ghostty-webgpu-site').hash).not.toBe(before)
  } finally {
    rmSync(probe)
  }
})

test('React hotkeys builds after the core hotkeys package', () => {
  expect(buildTask('@fregat/react-hotkeys').dependencies).toContain('@fregat/hotkeys#build')
})

test('a shared hotkeys compiler configuration change invalidates its build cache', () => {
  const before = buildTask('@fregat/hotkeys').hash
  const file = path.join(root, 'hotkeys/tsconfig.json')
  const source = readFileSync(file, 'utf8')
  try {
    writeFileSync(file, `${source}\n`)
    expect(buildTask('@fregat/hotkeys').hash).not.toBe(before)
  } finally {
    writeFileSync(file, source)
  }
})
