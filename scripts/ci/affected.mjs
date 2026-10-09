import assert from 'node:assert/strict'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const families = ['editor', 'ghostty-webgpu', 'hotkeys']
const generatedDocs = ['docs/settings-reference.md', 'docs/native-syntax-coverage.*']

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function matches(file, patterns) {
  const included = patterns.filter((pattern) => !pattern.startsWith('!'))
  const excluded = patterns.filter((pattern) => pattern.startsWith('!'))
  return (
    included.some((pattern) => new Bun.Glob(pattern).match(file)) &&
    !excluded.some((pattern) => new Bun.Glob(pattern.slice(1)).match(file))
  )
}

function inputPatterns(directory, inputs) {
  return (inputs ?? [])
    .filter((input) => input !== '$TURBO_DEFAULT$')
    .map((input) => {
      const excluded = input.startsWith('!')
      const value = excluded ? input.slice(1) : input
      const resolved = value.startsWith('$TURBO_ROOT$/')
        ? value.slice('$TURBO_ROOT$/'.length)
        : path.posix.join(directory, value)
      assert(!resolved.includes('$TURBO'), `Unsupported CI task input: ${input}`)
      return excluded ? `!${resolved}` : resolved
    })
}

function packageTasks(root, pkg, turbo) {
  const localFile = path.join(root, pkg.directory, 'turbo.json')
  const local = existsSync(localFile) ? readJson(localFile).tasks : {}
  const names = new Set(Object.keys(turbo.tasks).filter((name) => !name.includes('#')))
  for (const name of Object.keys(turbo.tasks)) {
    if (name.startsWith(`${pkg.name}#`)) names.add(name.split('#')[1])
  }
  for (const name of Object.keys(local)) names.add(name)
  return Array.from(names, (name) => {
    const definition = Object.assign(
      {},
      turbo.tasks[name],
      turbo.tasks[`${pkg.name}#${name}`],
      local[name],
    )
    return {
      name,
      inputs: inputPatterns(pkg.directory, definition.inputs),
      dependencies: definition.dependsOn ?? [],
    }
  })
}

export function readWorkspaceGraph(root) {
  const manifest = readJson(path.join(root, 'package.json'))
  const turbo = readJson(path.join(root, 'turbo.json'))
  const files = manifest.workspaces.packages.flatMap((pattern) =>
    Array.from(new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root })),
  )
  const packages = new Map(
    files.map((file) => {
      const pkg = readJson(path.join(root, file))
      assert(typeof pkg.name === 'string', `Workspace name missing: ${file}`)
      return [
        pkg.name,
        {
          name: pkg.name,
          directory: path.posix.dirname(file),
          scripts: pkg.scripts ?? {},
          manifest: pkg,
        },
      ]
    }),
  )
  assert(packages.size === files.length, 'Workspace names must be unique')
  for (const pkg of packages.values()) {
    const deps = Object.assign(
      {},
      pkg.manifest.dependencies,
      pkg.manifest.devDependencies,
      pkg.manifest.peerDependencies,
      pkg.manifest.optionalDependencies,
    )
    pkg.dependencies = new Set(Object.keys(deps).filter((name) => packages.has(name)))
    pkg.tasks = packageTasks(root, pkg, turbo)
  }
  const globalInputs = turbo.globalDependencies.concat([
    'package.json',
    'bun.lock',
    'bunfig.toml',
    '.npmrc',
    '.env*',
    'tsconfig*.json',
    'vitest*.{ts,mjs}',
    'patches/**',
    '.github/**',
    'scripts/**',
  ])
  return { root, packages, globalInputs, buildCommand: manifest.scripts['build:workspaces'] }
}

function explicitPackages(task) {
  return task.dependencies.filter((name) => name.includes('#')).map((name) => name.split('#')[0])
}

function owner(graph, file) {
  return Array.from(graph.packages.values())
    .filter((pkg) => file.startsWith(`${pkg.directory}/`))
    .sort((a, b) => b.directory.length - a.directory.length)[0]
}

function rootDocument(file) {
  return (
    file.startsWith('plans/') ||
    file.startsWith('docs/') ||
    (!file.includes('/') && file.endsWith('.md'))
  )
}

function productionDependencies(pkg) {
  return Array.from(pkg.dependencies).concat(
    pkg.tasks.filter((task) => task.name === 'build').flatMap(explicitPackages),
  )
}

function expandConsumers(graph, seeds) {
  const affected = new Set(seeds)
  for (const name of affected) {
    for (const pkg of graph.packages.values()) {
      if (productionDependencies(pkg).includes(name)) affected.add(pkg.name)
    }
  }
  return affected
}

function changedOwners(graph, files) {
  const seeds = new Set()
  let global = false
  for (const file of files) {
    if (matches(file, graph.globalInputs) || matches(file, generatedDocs)) {
      global = true
      continue
    }
    if (rootDocument(file)) continue
    if (file.startsWith('apps/mac/')) continue
    if (file.endsWith('/package.json') && !existsSync(path.join(graph.root, file))) {
      global = true
      continue
    }
    const pkg = owner(graph, file)
    if (pkg) {
      seeds.add(pkg.name)
      continue
    }
    const family = families.find((name) => file.startsWith(`${name}/`))
    if (!family) {
      global = true
      continue
    }
    // A removed workspace no longer has a manifest to describe its former consumers.
    if (file.startsWith(`${family}/packages/`)) {
      global = true
      continue
    }
    for (const candidate of graph.packages.values()) {
      if (candidate.directory.startsWith(`${family}/`) || candidate.directory === family)
        seeds.add(candidate.name)
    }
  }
  return { seeds, global }
}

function inputReaders(graph, files, changed) {
  const checks = new Set()
  for (const pkg of graph.packages.values()) {
    for (const task of pkg.tasks) {
      const readsInput = files.some((file) => matches(file, task.inputs))
      const readsPackage = explicitPackages(task).some((name) => changed.has(name))
      if (!readsInput && !readsPackage) continue
      checks.add(pkg.name)
    }
  }
  return checks
}

export function selectAffected(graph, files, full = false) {
  const { seeds, global } = changedOwners(graph, files)
  for (const pkg of graph.packages.values()) {
    if (
      pkg.tasks.some(
        (task) => task.name === 'build' && files.some((file) => matches(file, task.inputs)),
      )
    )
      seeds.add(pkg.name)
  }
  const affected = full || global ? new Set(graph.packages.keys()) : expandConsumers(graph, seeds)
  // Check-only source readers do not change the package's produced code.
  const packages = Array.from(
    new Set(Array.from(affected).concat(Array.from(inputReaders(graph, files, affected)))),
  ).sort()
  const familyChanged = (family) =>
    Array.from(affected).some((name) => {
      const directory = graph.packages.get(name).directory
      if (directory === 'editor/site' || directory === 'ghostty-webgpu/site') return false
      return directory === family || directory.startsWith(`${family}/`)
    })
  const site = [
    'site',
    'singapore-editor-site',
    'ghostty-webgpu-site',
    '@singapore-editor/example-app',
  ].some((name) => affected.has(name))
  return {
    code: packages.length > 0 || files.some((file) => file.startsWith('apps/mac/')),
    packages,
    web: affected.has('web'),
    server: affected.has('server'),
    tui: affected.has('tui'),
    desktop: affected.has('desktop'),
    site,
    editor: familyChanged('editor'),
    ghostty: familyChanged('ghostty-webgpu') || affected.has('ghostty-webgpu-line-editor'),
    hotkeys: familyChanged('hotkeys'),
    docs: files.some(rootDocument),
    docs_files: files.filter(
      (file) => rootDocument(file) && existsSync(path.join(graph.root, file)),
    ),
  }
}

export function requiredLibraries(graph, targets) {
  assert(
    Array.isArray(targets) &&
      targets.every((name) => typeof name === 'string' && graph.packages.has(name)),
    'CI build targets must name existing workspaces',
  )
  const required = new Set(targets)
  for (const name of required) {
    const pkg = graph.packages.get(name)
    for (const dependency of productionDependencies(pkg).concat(
      pkg.tasks.flatMap(explicitPackages),
    ))
      required.add(dependency)
  }
  const filters = Array.from(
    graph.buildCommand.matchAll(/--filter=(?:'([^']+)'|"([^"]+)"|(\S+))/g),
    (match) => match[1] ?? match[2] ?? match[3],
  )
  assert(filters.length > 0, 'Workspace build command must declare producer filters')
  return Array.from(required)
    .filter((name) => {
      const pkg = graph.packages.get(name)
      assert(pkg, `CI prerequisite names an unknown workspace: ${name}`)
      return filters.some((filter) =>
        new Bun.Glob(filter).match(filter.startsWith('./') ? `./${pkg.directory}` : name),
      )
    })
    .sort()
}

function main() {
  const [mode, base, head] = process.argv.slice(2)
  assert(mode === 'full' || mode === 'changed', 'Usage: affected.mjs full|changed BASE HEAD')
  const graph = readWorkspaceGraph(process.cwd())
  assert(
    /^[a-f0-9]{40}$/.test(base ?? '') && /^[a-f0-9]{40}$/.test(head ?? ''),
    'CI selection requires base and head commit IDs',
  )
  const files = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
  const selection = selectAffected(graph, files, mode === 'full')
  console.log(JSON.stringify(selection, null, 2))
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(selection)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
      .join('')
    appendFileSync(process.env.GITHUB_OUTPUT, lines)
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Selected ${selection.packages.length}/${graph.packages.size} packages.\n\n${selection.packages.map((name) => `- \`${name}\``).join('\n')}\n`,
    )
}

if (import.meta.main) main()
