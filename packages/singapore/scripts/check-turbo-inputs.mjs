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
    return Array.from(manifests, (file) => {
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
  const pending = workspace.declared.filter((name) => byName.has(name)).concat(explicit)
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
  const { files, errors: found, projectReads } = workspaceFiles(workspace)
  const manifest = path.join(workspace.directory, 'package.json')
  const reads = projectReads.concat(
    [...files].flatMap(([file, tasks]) =>
      relativeReads(file, RELATIVE_LITERAL, 2, workspace.directory).map((target) => ({
        file,
        target,
        tasks: [...tasks],
      })),
    ),
    Object.entries(workspace.scripts).flatMap(([name, command]) => {
      const argumentsRead = Array.from(command.matchAll(RELATIVE_ARGUMENT), (match) =>
        readTarget(manifest, match[0], workspace.directory),
      ).filter(Boolean)
      const configsRead = scriptConfigs(workspace, name)
      return Array.from(new Set(argumentsRead.concat(configsRead)), (target) => ({
        file: manifest,
        target,
        tasks: [name],
      }))
    }),
  )
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

function scriptConfigs(workspace, script, errors = []) {
  const configs = new Set()
  const pending = [script]
  const seen = new Set()
  const context = { workspace, script, errors }
  while (pending.length > 0) {
    const name = pending.pop()
    if (seen.has(name)) continue
    seen.add(name)
    for (const tokens of scriptCommands(workspace.scripts[name] ?? '')) {
      const called = scriptCall(tokens, workspace.scripts)
      if (called) {
        pending.push(called)
        continue
      }
      const discovered = toolConfigs(context, tokens, toolIndex(tokens))
      for (const file of discovered) configs.add(file)
    }
  }
  return [...configs]
}

function scriptCommands(command) {
  const commands = [[]]
  const tokens = (command.match(SCRIPT_TOKEN) ?? []).map((token) =>
    token.replace(/(["'])(.*?)\1/g, '$2'),
  )
  for (const token of tokens) {
    if (/^[;&|]+$/.test(token)) commands.push([])
    else commands.at(-1).push(token)
  }
  return commands
}

function commandIndex(tokens) {
  let index = 0
  while (tokens[index] === 'env' || /^[\w]+=.*/.test(tokens[index] ?? '')) index++
  return index
}

function toolIndex(tokens) {
  let index = commandIndex(tokens)
  if (!['bun', 'bunx', 'npm', 'npx', 'pnpm', 'yarn'].includes(path.basename(tokens[index] ?? '')))
    return index
  index++
  while (tokens[index]?.startsWith('-')) index++
  if (['run', 'exec', 'x', 'dlx'].includes(tokens[index])) index++
  while (tokens[index]?.startsWith('-')) index++
  return index
}

function scriptCall(tokens, scripts) {
  const start = commandIndex(tokens)
  const manager = path.basename(tokens[start] ?? '')
  if (!['bun', 'npm', 'pnpm', 'yarn'].includes(manager)) return null
  const args = tokens.slice(start + 1).filter((token) => !token.startsWith('-'))
  if (args[0] === 'run') return Object.hasOwn(scripts, args[1]) ? args[1] : null
  if (
    manager !== 'bun' ||
    ['test', 'build', 'install', 'add', 'remove', 'x', 'exec', 'pm'].includes(args[0])
  )
    return null
  return Object.hasOwn(scripts, args[0]) ? args[0] : null
}

function unresolvedConfig(context, file, detail) {
  const { workspace, script, errors } = context
  errors.push(
    `${workspace.name}#${script}: ${path.relative(repoRoot, file)}: ${detail}. Resolve config usage with existing config paths and literal project arrays or local constants.`,
  )
}

function toolConfigs(context, tokens, index) {
  const tool = path.basename(tokens[index] ?? '')
  if (tool !== 'vitest' && tool !== 'vite') return []
  const { directory } = context.workspace
  const args = tokens.slice(index + 1)
  const flag = args.findIndex(
    (arg) => arg === '--config' || arg === '-c' || arg.startsWith('--config='),
  )
  if (flag === -1) return defaultConfigs(directory, tool)
  const config = args[flag].startsWith('--config=') ? args[flag].slice(9) : args[flag + 1]
  const file = path.resolve(directory, config ?? args[flag])
  if (config && SOURCE_FILE.test(file) && statSync(file, { throwIfNoEntry: false })?.isFile())
    return [file]
  unresolvedConfig(context, file, 'Selected config file could not be resolved')
  return []
}

function defaultConfigs(directory, tool) {
  const files = readdirSync(directory)
    .filter((entry) => entry.startsWith(`${tool}.config.`) && SOURCE_FILE.test(entry))
    .map((entry) => path.join(directory, entry))
  if (files.length === 0 && tool === 'vitest') return defaultConfigs(directory, 'vite')
  return files
}

function localBindings(source) {
  const bindings = new Map()
  for (const statement of source.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer)
        bindings.set(declaration.name.text, declaration.initializer)
    }
  }
  return bindings
}

function staticExpression(node, bindings, seen = new Set()) {
  if (!node) return null
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return staticExpression(node.expression, bindings, seen)
  if (!ts.isIdentifier(node)) return node
  if (seen.has(node.text)) return null
  seen.add(node.text)
  return staticExpression(bindings.get(node.text), bindings, seen)
}

function projectEntries(expression, bindings, context, file, seen = new Set()) {
  const node = staticExpression(expression, bindings)
  if (!node || !ts.isArrayLiteralExpression(node) || seen.has(node)) {
    unresolvedConfig(context, file, 'Vitest project array could not be resolved')
    return []
  }
  seen.add(node)
  const entries = node.elements.flatMap((element) =>
    ts.isSpreadElement(element)
      ? projectEntries(element.expression, bindings, context, file, seen)
      : [element],
  )
  seen.delete(node)
  return entries
}

function projectConfigs(context, file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const bindings = localBindings(source)
  const configs = []
  const visit = (node) => {
    const property = ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
    if (property && node.name.getText(source).replace(/["']/g, '') === 'projects') {
      const expression = ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer
      for (const element of projectEntries(expression, bindings, context, file)) {
        const pattern = projectPattern(element, source, bindings, context, file)
        if (pattern) configs.push(...resolveProject(pattern, context, file))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return configs
}

function projectPattern(element, source, bindings, context, file) {
  const node = staticExpression(element, bindings)
  if (node && ts.isStringLiteralLike(node)) return node.text
  if (!node || !ts.isObjectLiteralExpression(node)) {
    unresolvedConfig(context, file, 'Vitest project entry could not be resolved')
    return null
  }
  if (node.properties.some(ts.isSpreadAssignment))
    unresolvedConfig(context, file, 'Vitest inline project spread could not be resolved')
  const extension = node.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText(source).replace(/["']/g, '') === 'extends',
  )
  if (!extension) return null
  const expression = ts.isShorthandPropertyAssignment(extension)
    ? extension.name
    : extension.initializer
  const value = staticExpression(expression, bindings)
  if (value && ts.isStringLiteralLike(value)) return value.text
  if (value?.kind === ts.SyntaxKind.TrueKeyword || value?.kind === ts.SyntaxKind.FalseKeyword)
    return null
  unresolvedConfig(context, file, 'Vitest project extends path could not be resolved')
  return null
}

function resolveProject(pattern, context, file) {
  const matches = [
    ...new Bun.Glob(pattern).scanSync({
      cwd: context.workspace.directory,
      absolute: true,
      onlyFiles: false,
    }),
  ]
  if (matches.length === 0)
    unresolvedConfig(context, file, 'Vitest project path matched no files or directories')
  return matches.flatMap((match) =>
    statSync(match).isDirectory() ? defaultConfigs(match, 'vitest') : [match],
  )
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
  const errors = []
  const projectReads = []
  const pending = []
  for (const script of Object.keys(workspace.scripts)) {
    for (const config of scriptConfigs(workspace, script, errors))
      addFileTasks(files, pending, config, [script])
  }
  while (pending.length > 0) {
    const file = pending.pop()
    const tasks = files.get(file)
    const context = { workspace, script: [...tasks].join(', '), errors }
    const imports = relativeReads(file, RELATIVE_LITERAL, 2, directory)
      .map(importedFile)
      .filter(Boolean)
    const projects = projectConfigs(context, file)
    projectReads.push(...projects.map((target) => ({ file, target, tasks: [...tasks] })))
    for (const imported of imports.concat(projects)) addFileTasks(files, pending, imported, tasks)
  }
  const configFiles = new Set(files.keys())
  for (const file of configs.concat(trees.flatMap(sourceFiles))) {
    if (!configFiles.has(file)) addFileTasks(files, pending, file, readingTasks(workspace, file))
  }
  while (pending.length > 0) {
    const file = pending.pop()
    const tasks = files.get(file)
    const imports = relativeReads(file, RELATIVE_LITERAL, 2, directory)
      .map(importedFile)
      .filter(Boolean)
    for (const imported of imports) {
      if (isInside(directory, imported)) addFileTasks(files, pending, imported, tasks)
    }
  }
  return { files, errors: [...new Set(errors)], projectReads }
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
