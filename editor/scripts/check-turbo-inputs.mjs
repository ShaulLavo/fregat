#!/usr/bin/env bun

// CI replays a cached turbo task while its hash is unchanged. The hash covers the package's own
// files, the tasks it depends on and turbo.json's `globalDependencies`. So every file a task reads
// from another package must reach it through a declared dependency or a `<package>#build` in that
// task's dependsOn, and every file outside the workspaces must match `globalDependencies` or sit
// under a task with `cache: false`. This fails on a read none of those cover, so a cache hit
// cannot hide a change the task would have seen.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { workspacePatterns, workspaceRoot } from './workspace-root.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRECTORIES = ['src', 'test', 'scripts']
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const TSCONFIG_FILE = /^tsconfig.*\.json$/
const SCRIPT_TOKEN = /(?:[^\s"';&|]+|"[^"]*"|'[^']*')+|&&|\|\||[;&|]/g
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', 'coverage'])
const RESOLVED_SUFFIXES = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js']
// A quoted path from the file (`./`, `../`) or from the package directory (`${process.cwd()}/`),
// read up to its first interpolation: `../docs/e034-${name}.json.gz` reads from `../docs`.
const RELATIVE_LITERAL = /(['"`])((?:\.{1,2}\/|\$\{process\.cwd\(\)\}\/)[^'"`\n]*)\1/g
const CWD_PREFIX = '${process.cwd()}/'
const RELATIVE_ARGUMENT = /(?<=^|\s)\.{1,2}\/[^\s'"&|;]+/g
// Relative paths that are not reads, each with why.
const NOT_READS = new Set([
  // Vite's `server.fs.allow` root: it permits serving, the tests read nothing through it.
  'packages/tree-sitter/vitest.config.ts reads .',
  // The directory a capture runs in; the test only reaches the validation that fails before it.
  'examples/stress/fallback-experiment.mjs reads .',
])

const turboRoot = workspaceRoot
const turbo = JSON.parse(readFileSync(path.join(turboRoot, 'turbo.json'), 'utf8'))
const globalGlobs = (turbo.globalDependencies ?? []).map((pattern) => new Bun.Glob(pattern))
const workspaces = readWorkspaces()
const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
const violations = workspaces.flatMap(checkWorkspace)

if (violations.length > 0) {
  console.error(`${violations.length} read(s) a cached turbo task cannot see:`)
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(
    "Fix in turbo.json: declare the read in the task's `inputs`, add `<package>#build` to its `dependsOn`, or add a root file to `globalDependencies`.",
  )
  process.exit(1)
}
console.log(`turbo inputs: ${workspaces.length} workspaces, every cross-package read is hashed`)

function readWorkspaces() {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  return workspacePatterns(manifest.workspaces).flatMap((pattern) => {
    const manifests = new Bun.Glob(`${pattern}/package.json`).scanSync({
      cwd: repoRoot,
      absolute: true,
      onlyFiles: true,
    })
    return [...manifests].map((file) => {
      const directory = path.dirname(file)
      const packageJson = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
      const declared = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }
      const workspaceDependencies = Object.keys(declared)
      return {
        name: packageJson.name,
        directory,
        declared: workspaceDependencies,
        scripts: packageJson.scripts ?? {},
      }
    })
  })
}

function readingTasks(workspace, file) {
  const relative = path.relative(workspace.directory, file)
  const name = path.basename(file)
  if (name.startsWith('tsconfig')) return ['typecheck', 'test']
  if (relative.startsWith(`test${path.sep}`) || /\.(?:test|spec)\./.test(name)) {
    return ['typecheck', 'test']
  }
  return ['build', 'typecheck', 'test']
}

function task(workspace, name) {
  return turbo.tasks[`${workspace.name}#${name}`] ?? turbo.tasks[name] ?? {}
}

function hashedWorkspaces(workspace, taskName) {
  const explicit = (task(workspace, taskName).dependsOn ?? [])
    .map((entry) => entry.split('#')[0])
    .filter((name) => byName.has(name))
  const pending = [...workspace.declared.filter((name) => byName.has(name)), ...explicit]
  const seen = new Set([workspace.name])
  while (pending.length > 0) {
    const name = pending.pop()
    if (seen.has(name)) continue
    seen.add(name)
    pending.push(...byName.get(name).declared.filter((dependency) => byName.has(dependency)))
  }
  return seen
}

function checkWorkspace(workspace) {
  const found = []
  const manifest = path.join(workspace.directory, 'package.json')
  const reads = [
    ...[...workspaceFiles(workspace)].flatMap(([file, tasks]) =>
      relativeReads(file, RELATIVE_LITERAL, 2, workspace.directory).map((target) => ({
        file,
        target,
        tasks: [...tasks],
      })),
    ),
    ...Object.entries(workspace.scripts).flatMap(([name, command]) => {
      const argumentsRead = [...command.matchAll(RELATIVE_ARGUMENT)]
        .map((match) => readTarget(manifest, match[0], workspace.directory))
        .filter(Boolean)
      const configsRead = scriptConfigs(workspace, name)
      return [...new Set([...argumentsRead, ...configsRead])].map((target) => ({
        file: manifest,
        target,
        tasks: [name],
      }))
    }),
  ]
  for (const { file, target, tasks: reading } of reads) {
    if (isInside(workspace.directory, target)) continue
    const where = `${path.relative(repoRoot, file)} reads ${path.relative(repoRoot, target) || '.'}`
    if (NOT_READS.has(where)) continue
    if (isGlobalDependency(target)) continue
    const owner = workspaces.find((candidate) => isInside(candidate.directory, target))
    // A directory nothing can import is walked at run time, so only running code reads it.
    const tasks = isImportable(target) ? reading : reading.filter((name) => name !== 'typecheck')
    const cachedTasks = tasks.filter(
      (name) => task(workspace, name).cache !== false && !isDeclaredInput(workspace, name, target),
    )
    if (!owner && cachedTasks.length > 0) {
      found.push(`${where}: outside the workspaces, cached by ${cachedTasks.join(', ')}`)
      continue
    }
    const blind = cachedTasks.filter((name) => !hashedWorkspaces(workspace, name).has(owner?.name))
    if (owner && blind.length > 0)
      found.push(`${where}: ${owner.name} is not hashed by ${blind.join(', ')}`)
  }
  return found
}

function isImportable(target) {
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) return true
  return ['index.ts', 'index.js'].some((entry) => existsSync(path.join(target, entry)))
}

/** A `$TURBO_ROOT$/…` entry in the task's `inputs` inside what it reads. */
function isDeclaredInput(workspace, taskName, target) {
  const relative = path.relative(turboRoot, target)
  return (task(workspace, taskName).inputs ?? []).some((input) => {
    if (!input.startsWith('$TURBO_ROOT$/')) return false
    const pattern = input.slice('$TURBO_ROOT$/'.length)
    return new Bun.Glob(pattern).match(relative) || pattern.startsWith(`${relative}/`)
  })
}

function isGlobalDependency(target) {
  const relative = path.relative(turboRoot, target)
  return globalGlobs.some((glob) => glob.match(relative))
}

function relativeReads(file, pattern, group, packageDirectory) {
  const source = readFileSync(file, 'utf8')
  const reads = []
  for (const match of source.matchAll(pattern)) {
    const target = readTarget(file, match[group], packageDirectory)
    if (target) reads.push(target)
  }
  return reads
}

function readTarget(file, literal, packageDirectory) {
  const fromCwd = literal.startsWith(CWD_PREFIX)
  const relative = fromCwd ? literal.slice(CWD_PREFIX.length) : literal
  const base = fromCwd ? packageDirectory : path.dirname(file)
  const interpolated = relative.indexOf('${')
  const fixed = interpolated === -1 ? relative : relative.slice(0, interpolated)
  const target = path.resolve(base, fixed)
  if (RESOLVED_SUFFIXES.some((suffix) => existsSync(target + suffix))) return target
  // A partial name (`e034-${name}`): the directory it names a file in is what is read.
  if (interpolated === -1 || fixed.endsWith('/')) return null
  const directory = path.dirname(target)
  return existsSync(directory) ? directory : null
}

function scriptConfigs(workspace, script) {
  const configs = new Set()
  const pending = [script]
  const seen = new Set()
  while (pending.length > 0) {
    const name = pending.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const tokens = (workspace.scripts[name]?.match(SCRIPT_TOKEN) ?? []).map((token) =>
      token.replace(/(["'])(.*?)\1/g, '$2'),
    )
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (['bun', 'npm', 'pnpm', 'yarn'].includes(token) && tokens[index + 1] === 'run')
        pending.push(tokens[index + 2])
    }
    const discovered = tokens.flatMap((_, index) => toolConfigs(workspace.directory, tokens, index))
    for (const file of discovered) configs.add(file)
  }
  return [...configs].filter(existsSync)
}

function toolConfigs(directory, tokens, index) {
  const tool = path.basename(tokens[index])
  if (tool !== 'vitest' && tool !== 'vite') return []
  const end = tokens.findIndex((next, at) => at > index && /^[;&|]+$/.test(next))
  const args = tokens.slice(index + 1, end === -1 ? undefined : end)
  const flag = args.findIndex(
    (arg) => arg === '--config' || arg === '-c' || arg.startsWith('--config='),
  )
  if (flag === -1) return defaultConfigs(directory, tool)
  const config = args[flag].startsWith('--config=') ? args[flag].slice(9) : args[flag + 1]
  return config ? [path.resolve(directory, config)] : []
}

function defaultConfigs(directory, tool) {
  const files = readdirSync(directory)
    .filter((entry) => entry.startsWith(`${tool}.config.`) && SOURCE_FILE.test(entry))
    .map((entry) => path.join(directory, entry))
  if (files.length === 0 && tool === 'vitest') return defaultConfigs(directory, 'vite')
  return files
}

function projectConfigs(file, directory) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const configs = []
  const visit = (node) => {
    const elements = projectElements(node, source)
    for (const element of elements) {
      const pattern = projectPattern(element, source)
      if (!pattern) continue
      configs.push(
        ...new Bun.Glob(pattern).scanSync({ cwd: directory, absolute: true, onlyFiles: true }),
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return configs
}

function projectPattern(element, source) {
  if (ts.isStringLiteralLike(element)) return element.text
  if (!ts.isObjectLiteralExpression(element)) return null
  const extension = element.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(source).replace(/["']/g, '') === 'extends',
  )
  return extension && ts.isStringLiteralLike(extension.initializer)
    ? extension.initializer.text
    : null
}

function projectElements(node, source) {
  if (
    !ts.isPropertyAssignment(node) ||
    node.name.getText(source).replace(/["']/g, '') !== 'projects'
  )
    return []
  return ts.isArrayLiteralExpression(node.initializer) ? node.initializer.elements : []
}

function addFileTasks(files, pending, file, tasks) {
  const previous = files.get(file) ?? new Set()
  const size = previous.size
  for (const task of tasks) previous.add(task)
  if (previous.size === size) return
  files.set(file, previous)
  pending.push(file)
}

function workspaceFiles(workspace) {
  const { directory } = workspace
  const configs = readdirSync(directory)
    .filter((entry) => TSCONFIG_FILE.test(entry))
    .map((entry) => path.join(directory, entry))
  const trees = SCANNED_DIRECTORIES.map((entry) => path.join(directory, entry)).filter(existsSync)
  const files = new Map()
  const pending = []
  for (const script of Object.keys(workspace.scripts)) {
    for (const config of scriptConfigs(workspace, script))
      addFileTasks(files, pending, config, [script])
  }
  while (pending.length > 0) {
    const file = pending.pop()
    for (const project of projectConfigs(file, directory)) {
      if (isInside(directory, project)) addFileTasks(files, pending, project, files.get(file))
    }
  }
  const configFiles = new Set(files.keys())
  pending.push(...configFiles)
  for (const file of [...configs, ...trees.flatMap(sourceFiles)]) {
    if (!configFiles.has(file)) addFileTasks(files, pending, file, readingTasks(workspace, file))
  }
  while (pending.length > 0) {
    const file = pending.pop()
    const tasks = files.get(file)
    const imports = relativeReads(file, RELATIVE_LITERAL, 2, directory)
      .map(importedFile)
      .filter(Boolean)
    const projects = SOURCE_FILE.test(file) ? projectConfigs(file, directory) : []
    for (const imported of [...imports, ...projects]) {
      if (isInside(directory, imported)) addFileTasks(files, pending, imported, tasks)
    }
  }
  return files
}

function importedFile(target) {
  const file = RESOLVED_SUFFIXES.map((suffix) => target + suffix).find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  )
  return file && SOURCE_FILE.test(file) ? file : null
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) return []
    const file = path.join(directory, entry)
    if (statSync(file).isDirectory()) return sourceFiles(file)
    return SOURCE_FILE.test(entry) || TSCONFIG_FILE.test(entry) ? [file] : []
  })
}

function isInside(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
