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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRECTORIES = ['src', 'test', 'scripts']
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const CONFIG_FILE = /^(?:vitest|vite)\.config\.[cm]?[jt]s$|^tsconfig.*\.json$/
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

const turbo = JSON.parse(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))
const globalGlobs = (turbo.globalDependencies ?? []).map((pattern) => new Bun.Glob(pattern))
const workspaces = readWorkspaces()
const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
const violations = workspaces.flatMap(checkWorkspace)

if (violations.length > 0) {
  console.error(`${violations.length} read(s) a cached turbo task cannot see:`)
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(
    "Fix in turbo.json: add `<package>#build` to the reader's task dependsOn, add a root file to `globalDependencies`, or set the task to `cache: false`.",
  )
  process.exit(1)
}
console.log(`turbo inputs: ${workspaces.length} workspaces, every cross-package read is hashed`)

function readWorkspaces() {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  return manifest.workspaces.flatMap((pattern) => {
    const parent = path.join(repoRoot, pattern.replace(/\/\*$/, ''))
    return readdirSync(parent)
      .map((entry) => path.join(parent, entry))
      .filter((directory) => existsSync(path.join(directory, 'package.json')))
      .map((directory) => {
        const packageJson = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        const declared = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
          ...packageJson.peerDependencies,
        }
        const workspaceDependencies = Object.keys(declared)
        return { name: packageJson.name, directory, declared: workspaceDependencies }
      })
  })
}

// Which of the package's tasks load a file: tests only reach test files, tool configs reach
// their tool, and sources and scripts reach everything.
function readingTasks(workspace, file) {
  const relative = path.relative(workspace.directory, file)
  const name = path.basename(file)
  if (name === 'package.json') return ['build', 'test']
  if (name.startsWith('tsconfig')) return ['typecheck', 'test']
  if (name.startsWith('vitest.config')) return ['test']
  if (name.startsWith('vite.config')) return ['build', 'test']
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
    ...workspaceFiles(workspace.directory).flatMap((file) =>
      relativeReads(file, RELATIVE_LITERAL, 2, workspace.directory).map((target) => ({
        file,
        target,
      })),
    ),
    ...relativeReads(manifest, RELATIVE_ARGUMENT, 0, workspace.directory).map((target) => ({
      file: manifest,
      target,
    })),
  ]
  for (const { file, target } of reads) {
    if (isInside(workspace.directory, target)) continue
    const where = `${path.relative(repoRoot, file)} reads ${path.relative(repoRoot, target) || '.'}`
    if (NOT_READS.has(where)) continue
    if (isGlobalDependency(target)) continue
    const owner = workspaces.find((candidate) => isInside(candidate.directory, target))
    // A directory nothing can import is walked at run time, so only running code reads it.
    const tasks = isImportable(target)
      ? readingTasks(workspace, file)
      : readingTasks(workspace, file).filter((name) => name !== 'typecheck')
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
  const relative = path.relative(repoRoot, target)
  return (task(workspace, taskName).inputs ?? []).some((input) => {
    if (!input.startsWith('$TURBO_ROOT$/')) return false
    const pattern = input.slice('$TURBO_ROOT$/'.length)
    return new Bun.Glob(pattern).match(relative) || pattern.startsWith(`${relative}/`)
  })
}

function isGlobalDependency(target) {
  const relative = path.relative(repoRoot, target)
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

/**
 * Sources, tests, scripts and tool configs, plus every workspace file they import by relative
 * path (a test importing `../fallback-validation.mjs` reads what that module reads).
 */
function workspaceFiles(directory) {
  const configs = readdirSync(directory)
    .filter((entry) => CONFIG_FILE.test(entry))
    .map((entry) => path.join(directory, entry))
  const trees = SCANNED_DIRECTORIES.map((entry) => path.join(directory, entry)).filter(existsSync)
  const files = new Set([...configs, ...trees.flatMap(sourceFiles)])
  for (const file of files) {
    for (const target of relativeReads(file, RELATIVE_LITERAL, 2, directory)) {
      const imported = importedFile(target)
      if (imported && isInside(directory, imported)) files.add(imported)
    }
  }
  return [...files]
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
    return SOURCE_FILE.test(entry) || CONFIG_FILE.test(entry) ? [file] : []
  })
}

function isInside(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
