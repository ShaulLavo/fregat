import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'

const root = path.resolve(import.meta.dirname, '..')

const buildGraphSchema = v.object({
  tasks: v.array(
    v.object({
      taskId: v.string(),
      directory: v.string(),
      dependencies: v.array(v.string()),
      hash: v.string(),
      resolvedTaskDefinition: v.object({
        outputs: v.array(v.string()),
        inputs: v.array(v.string()),
        cache: v.boolean(),
        env: v.array(v.string()),
      }),
    }),
  ),
})
const packageSchema = v.object({
  name: v.string(),
  scripts: v.optional(v.record(v.string(), v.string())),
  dependencies: v.optional(v.record(v.string(), v.string())),
})
const workspaceSchema = v.object({ workspaces: v.object({ packages: v.array(v.string()) }) })

function buildTasks(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return v.parse(buildGraphSchema, JSON.parse(result.stdout.toString())).tasks
}

function buildTask(packageName: string) {
  const task = buildTasks([
    'bun',
    'x',
    'turbo',
    'run',
    'build',
    `--filter=${packageName}`,
    '--dry=json',
  ]).find((task) => task.taskId === `${packageName}#build`)
  if (!task) expect.fail(`Missing build task for ${packageName}`)
  return task
}

function catalogConsumers() {
  const manifest = v.parse(
    workspaceSchema,
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
  )
  const packages = manifest.workspaces.packages.flatMap((pattern) => [
    ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root }),
  ])
  return packages
    .map((file) => v.parse(packageSchema, JSON.parse(readFileSync(path.join(root, file), 'utf8'))))
    .filter((pkg) => pkg.scripts?.build && pkg.dependencies?.['@fregat/hotkeys'] === 'catalog:')
}

function workspaceBuildTasks() {
  return buildTasks(['bun', 'x', 'turbo', 'run', 'build', '--dry=json'])
}

function dependsOn(
  tasks: ReturnType<typeof workspaceBuildTasks>,
  start: string,
  dependency: string,
): boolean {
  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  const pending = [start]
  const visited = new Set<string>()
  for (const id of pending) {
    if (id === dependency) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(byId.get(id)?.dependencies ?? []))
  }
  return false
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

test('a ghostty site environment file change invalidates its build cache', () => {
  const probe = path.join(root, 'ghostty-webgpu/site/.env.turbo-cache-probe')
  writeFileSync(probe, '# before\n', { flag: 'wx' })
  try {
    const before = buildTask('ghostty-webgpu-site').hash
    writeFileSync(probe, '# after\n')
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

test('workspace catalog consumers build after local hotkeys declarations', () => {
  const consumers = catalogConsumers()
  const tasks = workspaceBuildTasks()
  expect(consumers.length).toBeGreaterThan(0)
  for (const pkg of consumers)
    expect(dependsOn(tasks, `${pkg.name}#build`, '@fregat/hotkeys#build'), pkg.name).toBe(true)
})

test('a local hotkeys source change invalidates each catalog consumer build', () => {
  const consumers = new Set(catalogConsumers().map((pkg) => `${pkg.name}#build`))
  const before = new Map(
    workspaceBuildTasks()
      .filter((task) => consumers.has(task.taskId))
      .map((task) => [task.taskId, task.hash]),
  )
  const probe = path.join(root, 'hotkeys/packages/hotkeys/src/turbo-cache-probe.ts')
  writeFileSync(probe, 'export const cacheProbe = true\n', { flag: 'wx' })
  try {
    for (const task of workspaceBuildTasks().filter((task) => consumers.has(task.taskId)))
      expect(task.hash, task.taskId).not.toBe(before.get(task.taskId))
  } finally {
    rmSync(probe)
  }
})

test('catalog consumer ordering preserves resolved build cache fields', () => {
  const tasks = workspaceBuildTasks()
  const baseline = buildTask('@singapore-editor/textbuffer').resolvedTaskDefinition
  for (const pkg of catalogConsumers()) {
    const task = tasks.find((candidate) => candidate.taskId === `${pkg.name}#build`)
    if (!task) expect.fail(`Missing build task for ${pkg.name}`)
    const configPath = path.join(root, task.directory, 'turbo.json')
    const packageConfig = existsSync(configPath)
      ? v.parse(
          v.object({
            tasks: v.object({ build: v.object({ outputs: v.optional(v.array(v.string())) }) }),
          }),
          JSON.parse(readFileSync(configPath, 'utf8')),
        )
      : undefined
    expect(task.resolvedTaskDefinition, pkg.name).toEqual({
      ...baseline,
      outputs: packageConfig?.tasks.build.outputs ?? baseline.outputs,
    })
  }
})
