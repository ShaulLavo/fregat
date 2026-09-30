#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const writeMode = process.argv.includes('--write')

const config = {
  ignoredRoots: [
    '.git',
    '.turbo',
    '.desloppify',
    'coverage',
    'dist',
    'node_modules',
    'opensrc',
    'references',
  ],
  expectedPackageScripts: ['build', 'test', 'typecheck', 'lint', 'format', 'format:check'],
  sourceCycleScopes: [
    { name: 'editor', root: 'packages/editor/src' },
    { name: 'editor-virtualization', root: 'packages/editor/src/virtualization' },
    { name: 'lsp-core', root: 'packages/lsp/src' },
    { name: 'plugin-ui', root: 'packages/plugin-ui/src' },
    { name: 'lsp-plugin', root: 'packages/lsp-plugin/src' },
    { name: 'typescript-lsp', root: 'packages/typescript-lsp/src' },
  ],
  duplicateModuleGroups: [
    {
      name: 'lsp-plugin-vs-typescript-lsp',
      roots: ['packages/lsp-plugin/src', 'packages/typescript-lsp/src'],
    },
  ],
  productionSourceRoots: ['packages', 'examples'],
  publicApiPackageName: '@singapore-editor/core',
  baselineDir: 'docs/architecture/phase-0',
}

const baselineFiles = {
  health: `${config.baselineDir}/health-baseline.json`,
  publicApi: `${config.baselineDir}/core-public-api.json`,
  timers: `${config.baselineDir}/timer-usage.json`,
}

main()

function main() {
  const current = {
    health: collectHealthBaseline(),
    publicApi: collectPublicApiBaseline(),
    timers: collectTimerBaseline(readOptionalJson(baselineFiles.timers)),
  }

  if (writeMode) {
    writeJson(baselineFiles.health, current.health)
    writeJson(baselineFiles.publicApi, current.publicApi)
    writeJson(baselineFiles.timers, current.timers)
    printWriteSummary(current)
    return
  }

  const failures = [
    ...compareJsonBaseline('health baseline', baselineFiles.health, current.health),
    ...comparePublicApi(current.publicApi, readRequiredJson(baselineFiles.publicApi)),
    ...compareTimers(current.timers, readRequiredJson(baselineFiles.timers)),
  ]

  printCheckSummary(current)
  if (failures.length === 0) return

  console.error('')
  console.error('Architecture health check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('')
  console.error('Run `bun run health:write` only for intentional architecture baseline changes.')
  process.exitCode = 1
}

function collectHealthBaseline() {
  const packages = workspacePackages()
  const packageGraph = buildPackageGraph(packages)

  return {
    schemaVersion: 1,
    ignoredRoots: [...config.ignoredRoots].sort(),
    expectedPackageScripts: [...config.expectedPackageScripts],
    missingPackageScripts: missingPackageScripts(packages),
    packageCycles: stronglyConnectedComponents(packageGraph),
    sourceCycles: collectSourceCycles(),
    duplicateModules: collectDuplicateModules(),
  }
}

function collectPublicApiBaseline() {
  const packages = workspacePackages()
  const corePackage = packages.find((item) => item.name === config.publicApiPackageName)
  if (!corePackage) throw new Error(`Unable to find ${config.publicApiPackageName}`)

  const entrypoints = publicEntrypoints(corePackage)

  return {
    schemaVersion: 1,
    packageName: corePackage.name,
    packagePath: corePackage.dir,
    reviewPolicy:
      'Any new public export must be reviewed and this inventory updated in the same change.',
    entrypoints,
  }
}

function collectTimerBaseline(previous) {
  const previousTimers = previousTimerLookup(previous)

  return {
    schemaVersion: 1,
    reviewPolicy:
      'Production timers must name why they are scheduler-safe or why they remain legacy debt.',
    timers: timerUsages(previousTimers),
  }
}

function previousTimerLookup(previous) {
  return new Map((previous?.timers ?? []).map((entry) => [entry.id, entry]))
}

function workspacePackages() {
  const rootPackage = readJsonFile('package.json')
  const packageFiles = []

  for (const pattern of rootPackage.workspaces ?? []) {
    for (const packageFile of expandWorkspacePattern(pattern)) packageFiles.push(packageFile)
  }

  return packageFiles
    .map((packageFile) => {
      const packageJson = readJsonFile(packageFile)
      return {
        name: packageJson.name,
        dir: normalizePath(path.dirname(packageFile)),
        packageFile: normalizePath(packageFile),
        packageJson,
      }
    })
    .filter((item) => typeof item.name === 'string')
    .sort((left, right) => left.name.localeCompare(right.name))
}

function expandWorkspacePattern(pattern) {
  const starIndex = pattern.indexOf('*')
  if (starIndex === -1) return packageJsonIfExists(pattern)

  const prefix = pattern.slice(0, starIndex)
  const suffix = pattern.slice(starIndex + 1)
  const baseDir = path.join(repoRoot, prefix)
  if (!existsSync(baseDir)) return []

  const packageFiles = []
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const candidate = path.join(prefix, entry.name, suffix, 'package.json')
    packageFiles.push(...packageJsonIfExists(candidate))
  }

  return packageFiles
}

function packageJsonIfExists(candidate) {
  const absolute = path.join(repoRoot, candidate)
  if (!existsSync(absolute)) return []
  return [normalizePath(candidate)]
}

function buildPackageGraph(packages) {
  const names = new Set(packages.map((item) => item.name))
  const graph = new Map()

  for (const item of packages) {
    graph.set(item.name, packageDependencies(item.packageJson, names))
  }

  return graph
}

function packageDependencies(packageJson, workspaceNames) {
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  const dependencies = new Set()

  for (const section of sections) {
    for (const name of Object.keys(packageJson[section] ?? {})) {
      if (!workspaceNames.has(name)) continue
      dependencies.add(name)
    }
  }

  return [...dependencies].sort()
}

function missingPackageScripts(packages) {
  const missing = {}

  for (const item of packages) {
    const scripts = item.packageJson.scripts ?? {}
    const missingScripts = config.expectedPackageScripts.filter((script) => !scripts[script])
    if (missingScripts.length === 0) continue
    missing[item.name] = missingScripts
  }

  return sortObject(missing)
}

function collectSourceCycles() {
  const cycles = {}

  for (const scope of config.sourceCycleScopes) {
    cycles[scope.name] = sourceCyclesForScope(scope.root)
  }

  return sortObject(cycles)
}

function sourceCyclesForScope(root) {
  const files = sourceFiles(root)
  const fileSet = new Set(files.map((file) => path.resolve(repoRoot, file)))
  const graph = new Map()

  for (const file of files) {
    graph.set(file, relativeImportsForFile(file, fileSet, root))
  }

  return stronglyConnectedComponents(graph)
}

function relativeImportsForFile(file, fileSet, scopeRoot) {
  const content = readText(file)
  const imports = new Set()

  for (const specifier of importSpecifiers(content)) {
    if (!specifier.startsWith('.')) continue

    const resolved = resolveRelativeModule(file, specifier)
    if (!resolved) continue
    if (!fileSet.has(path.resolve(repoRoot, resolved))) continue
    if (!isWithin(resolved, scopeRoot)) continue
    imports.add(resolved)
  }

  return [...imports].sort()
}

function importSpecifiers(content) {
  const specifiers = []
  const importExportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  collectPatternMatches(importExportPattern, content, specifiers)
  collectPatternMatches(dynamicImportPattern, content, specifiers)
  return specifiers
}

function collectPatternMatches(pattern, content, output) {
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier) output.push(specifier)
  }
}

function resolveRelativeModule(fromFile, specifier) {
  const fromDirectory = path.dirname(path.join(repoRoot, fromFile))
  const base = path.resolve(fromDirectory, specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    if (!statSync(candidate).isFile()) continue
    return relativePath(candidate)
  }

  return null
}

function collectDuplicateModules() {
  const groups = {}

  for (const group of config.duplicateModuleGroups) {
    groups[group.name] = duplicateModulesForGroup(group)
  }

  return sortObject(groups)
}

function duplicateModulesForGroup(group) {
  const byModule = new Map()

  for (const root of group.roots) {
    for (const file of sourceFiles(root)) {
      const modulePath = normalizePath(
        path.relative(path.join(repoRoot, root), path.join(repoRoot, file)),
      )
      const entries = byModule.get(modulePath) ?? []
      entries.push(file)
      byModule.set(modulePath, entries)
    }
  }

  return [...byModule.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([modulePath, files]) => ({ modulePath, files: files.sort() }))
    .sort((left, right) => left.modulePath.localeCompare(right.modulePath))
}

function publicEntrypoints(packageInfo) {
  const exportsField = packageInfo.packageJson.exports ?? {}
  const entrypoints = []

  for (const [specifier, target] of Object.entries(exportsField)) {
    const source = entrypointSource(packageInfo, target)
    if (!source) continue

    entrypoints.push({
      specifier,
      source,
      exports: moduleExports(source),
    })
  }

  return entrypoints.sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/**
 * The source file an export condition stands for.
 *
 * A conditional export points at the build output, which carries no export list this can read — the
 * declarations there are generated from the source and the source is what a reviewer changes. An
 * entrypoint whose target resolves to nothing is skipped rather than guessed at, so a package that
 * publishes something this cannot map is visible as a missing entrypoint instead of an empty one.
 */
function entrypointSource(packageInfo, target) {
  const specified =
    typeof target === 'string'
      ? target
      : (target?.import ?? target?.default ?? target?.types ?? null)
  if (typeof specified !== 'string') return null

  const candidates =
    specified.endsWith('.ts') || specified.endsWith('.tsx')
      ? [specified]
      : [specified.replace(/^\.\/dist\//, './src/').replace(/\.(d\.ts|js)$/, '.ts')]

  for (const candidate of candidates) {
    const source = normalizePath(path.join(packageInfo.dir, candidate))
    if (existsSync(source)) return source
  }

  return null
}

function moduleExports(source) {
  const seen = new Set()
  const exports = collectModuleExports(source, seen)
  const unique = new Map()

  for (const item of exports) {
    unique.set(publicExportKey(item), item)
  }

  return [...unique.values()].sort(comparePublicExports)
}

function collectModuleExports(source, seen) {
  if (seen.has(source)) return []
  seen.add(source)

  const content = stripComments(readText(source))
  return [
    ...namedReExports(content, source),
    ...starReExports(content, source, seen),
    ...localExportLists(content, source),
    ...declarationExports(content, source),
    ...defaultExports(content, source),
  ]
}

function namedReExports(content, source) {
  const exports = []
  const pattern = /\bexport\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g

  for (const match of content.matchAll(pattern)) {
    const kind = match[1] ? 'type' : 'unknown'
    const target = resolveRelativeModule(source, match[3])
    const sourcePath = target ?? match[3]
    for (const name of exportSpecifierNames(match[2])) {
      exports.push({ name, kind, source: sourcePath, via: source })
    }
  }

  return exports
}

function starReExports(content, source, seen) {
  const exports = []
  const pattern = /\bexport\s+(type\s+)?\*\s+from\s+['"]([^'"]+)['"]/g

  for (const match of content.matchAll(pattern)) {
    const target = resolveRelativeModule(source, match[2])
    if (!target) {
      exports.push({
        name: '*',
        kind: match[1] ? 'type' : 'unknown',
        source: match[2],
        via: source,
      })
      continue
    }

    for (const item of collectModuleExports(target, seen)) {
      exports.push({ ...item, via: `${source} -> ${item.via}` })
    }
  }

  return exports
}

function localExportLists(content, source) {
  const exports = []
  const pattern = /\bexport\s+(type\s+)?\{([^{}]*?)\}(?!\s*from\b)/g

  for (const match of content.matchAll(pattern)) {
    const kind = match[1] ? 'type' : 'unknown'
    for (const name of exportSpecifierNames(match[2]))
      exports.push({ name, kind, source, via: source })
  }

  return exports
}

function declarationExports(content, source) {
  const exports = []
  const pattern =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g

  for (const match of content.matchAll(pattern)) {
    exports.push({ name: match[2], kind: exportDeclarationKind(match[1]), source, via: source })
  }

  return exports
}

function defaultExports(content, source) {
  if (!/\bexport\s+default\b/.test(content)) return []
  return [{ name: 'default', kind: 'unknown', source, via: source }]
}

function exportSpecifierNames(block) {
  return block
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^type\s+/, ''))
    .map(
      (item) =>
        item
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim() ?? '',
    )
    .filter(Boolean)
}

function exportDeclarationKind(kind) {
  if (kind === 'interface' || kind === 'type') return 'type'
  return 'value'
}

function timerUsages(previousTimers) {
  const timers = []
  const occurrences = new Map()

  for (const file of productionSourceFiles()) {
    const lines = readText(file).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      addTimersFromLine(timers, previousTimers, occurrences, file, index, line, lines)
    }
  }

  return timers.sort((left, right) => left.id.localeCompare(right.id))
}

function addTimersFromLine(timers, previousTimers, occurrences, file, index, line, lines) {
  const pattern =
    /\b(setTimeout|setInterval|requestIdleCallback|requestAnimationFrame|queueMicrotask)\s*\(/g

  for (const match of line.matchAll(pattern)) {
    const api = match[1]
    const snippet = line.trim()
    const occurrence = nextOccurrence(occurrences, file, api, snippet)
    const id = timerId(file, api, snippet, occurrence)
    const previous = previousTimers.get(id)
    timers.push({
      id,
      api,
      file,
      line: index + 1,
      snippet,
      justification:
        inlineJustification(lines, index) ??
        previous?.justification ??
        'TODO: explain why this timer is scheduler-safe.',
    })
  }
}

function nextOccurrence(occurrences, file, api, snippet) {
  const key = `${file}\0${api}\0${snippet}`
  const occurrence = occurrences.get(key) ?? 0
  occurrences.set(key, occurrence + 1)
  return occurrence
}

function timerId(file, api, snippet, occurrence) {
  const hash = createHash('sha256')
    .update(`${file}\0${api}\0${snippet}\0${occurrence}`)
    .digest('hex')
    .slice(0, 10)
  return `${file}:${api}:${hash}`
}

function productionSourceFiles() {
  const files = []

  for (const root of config.productionSourceRoots) {
    for (const file of sourceFiles(root)) {
      if (!isProductionSource(file)) continue
      files.push(file)
    }
  }

  return files.sort()
}

function isProductionSource(file) {
  if (file.includes('/test/')) return false
  if (file.includes('/bench/')) return false
  if (file.endsWith('.test.ts')) return false
  if (file.endsWith('.test.tsx')) return false
  return true
}

function sourceFiles(root) {
  return walk(root)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .filter((file) => !file.endsWith('.d.ts'))
    .sort()
}

function walk(root) {
  const absoluteRoot = path.join(repoRoot, root)
  if (!existsSync(absoluteRoot)) return []

  const files = []
  walkDirectory(absoluteRoot, files)
  return files.map(relativePath).sort()
}

function walkDirectory(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const relative = relativePath(absolute)
    if (isIgnored(relative)) continue
    if (entry.isDirectory()) {
      walkDirectory(absolute, files)
      continue
    }
    if (!entry.isFile()) continue
    files.push(absolute)
  }
}

function isIgnored(relative) {
  const parts = normalizePath(relative).split('/')
  return parts.some((part) => config.ignoredRoots.includes(part))
}

function stronglyConnectedComponents(graph) {
  const state = {
    index: 0,
    stack: [],
    indices: new Map(),
    lowlinks: new Map(),
    onStack: new Set(),
    components: [],
  }

  for (const node of [...graph.keys()].sort()) {
    if (state.indices.has(node)) continue
    visitStrongComponent(node, graph, state)
  }

  return state.components
    .filter((component) => component.length > 1)
    .map((component) => component.sort())
    .sort(compareStringArrays)
}

function visitStrongComponent(node, graph, state) {
  state.indices.set(node, state.index)
  state.lowlinks.set(node, state.index)
  state.index += 1
  state.stack.push(node)
  state.onStack.add(node)

  for (const next of graph.get(node) ?? []) {
    updateStrongComponentLowlink(node, next, graph, state)
  }

  if (state.lowlinks.get(node) !== state.indices.get(node)) return
  popStrongComponent(node, state)
}

function updateStrongComponentLowlink(node, next, graph, state) {
  if (!state.indices.has(next)) {
    visitStrongComponent(next, graph, state)
    state.lowlinks.set(node, Math.min(state.lowlinks.get(node), state.lowlinks.get(next)))
    return
  }

  if (!state.onStack.has(next)) return
  state.lowlinks.set(node, Math.min(state.lowlinks.get(node), state.indices.get(next)))
}

function popStrongComponent(node, state) {
  const component = []

  while (state.stack.length > 0) {
    const current = state.stack.pop()
    state.onStack.delete(current)
    component.push(current)
    if (current === node) break
  }

  state.components.push(component)
}

function compareJsonBaseline(label, file, current) {
  const baseline = readRequiredJson(file)
  if (stableStringify(current) === stableStringify(baseline)) return []
  return [`${label} changed; update ${file} with review if intentional`]
}

function comparePublicApi(current, baseline) {
  const failures = []
  const currentKeys = publicApiKeys(current)
  const baselineKeys = publicApiKeys(baseline)

  for (const key of currentKeys) {
    if (baselineKeys.has(key)) continue
    failures.push(`new public API export requires review: ${key}`)
  }

  for (const key of baselineKeys) {
    if (currentKeys.has(key)) continue
    failures.push(`public API export removed from inventory: ${key}`)
  }

  return failures
}

function publicApiKeys(inventory) {
  const keys = new Set()

  for (const entrypoint of inventory.entrypoints ?? []) {
    for (const item of entrypoint.exports ?? []) {
      keys.add(`${entrypoint.specifier}:${item.kind}:${item.name}`)
    }
  }

  return keys
}

function compareTimers(current, baseline) {
  return [...timerIdFailures(current, baseline), ...timerJustificationFailures(current)]
}

function timerIdFailures(current, baseline) {
  const failures = []
  const currentIds = new Set((current.timers ?? []).map((item) => item.id))
  const baselineIds = new Set((baseline.timers ?? []).map((item) => item.id))

  for (const id of currentIds) {
    if (baselineIds.has(id)) continue
    failures.push(`new production timer requires scheduler justification: ${id}`)
  }

  for (const id of baselineIds) {
    if (currentIds.has(id)) continue
    failures.push(`timer baseline is stale: ${id}`)
  }

  return failures
}

function timerJustificationFailures(current) {
  const failures = []

  for (const timer of current.timers ?? []) {
    if (isValidJustification(timer.justification)) continue
    failures.push(`timer justification is missing: ${timer.id}`)
  }

  return failures
}

/**
 * The `@justification` a timer carries in the comment directly above it.
 *
 * Read from the source rather than from the baseline so it travels with the line it explains: a
 * baseline entry is keyed by a hash of the file, the API and the source text, so reformatting the
 * statement silently orphans its reason and the next writer sees a timer that never had one.
 */
function inlineJustification(lines, index) {
  const block = []
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const text = lines[cursor].trim()
    if (text.length === 0 && block.length === 0) continue
    if (!/^(\/\*\*?|\*\/?|\/\/)/.test(text)) break
    block.unshift(text)
  }
  if (block.length === 0) return null

  const collected = []
  let reading = false
  for (const raw of block) {
    const text = raw
      .replace(/^\/\*\*?|^\*\/|^\*|^\/\//, '')
      .replace(/\*\/$/, '')
      .trim()
    const opens = /^@justification\b/.test(text)
    // Any other tag ends it, so a reason is never silently extended by the tag written after it.
    if (reading && !opens && /^@\w+/.test(text)) break
    if (opens) {
      reading = true
      collected.push(text.replace(/^@justification\b:?/, '').trim())
      continue
    }
    if (reading) collected.push(text)
  }

  const justification = collected.join(' ').trim()
  return justification.length > 0 ? justification : null
}

function isValidJustification(value) {
  if (typeof value !== 'string') return false
  if (value.trim().length === 0) return false
  return !value.includes('TODO:')
}

function printWriteSummary(current) {
  console.log('Wrote architecture health baselines.')
  printSummary(current)
}

function printCheckSummary(current) {
  console.log('Architecture health scan complete.')
  printSummary(current)
}

function printSummary(current) {
  const sourceCycleScopes = Object.keys(current.health.sourceCycles)
  const sourceCycleCount = Object.values(current.health.sourceCycles).reduce(
    (total, cycles) => total + cycles.length,
    0,
  )

  console.log(
    `packages: ${Object.keys(current.health.missingPackageScripts).length} with missing expected scripts`,
  )
  console.log(`package cycles: ${current.health.packageCycles.length}`)
  console.log(
    `source cycle components: ${sourceCycleCount} across ${sourceCycleScopes.length} scopes`,
  )
  console.log(`public API entrypoints: ${current.publicApi.entrypoints.length}`)
  console.log(`production timers: ${current.timers.timers.length}`)
}

function readRequiredJson(file) {
  if (!existsSync(path.join(repoRoot, file))) {
    throw new Error(`Missing baseline ${file}; run bun run health:write`)
  }

  return readJsonFile(file)
}

function readOptionalJson(file) {
  if (!existsSync(path.join(repoRoot, file))) return null
  return readJsonFile(file)
}

function readJsonFile(file) {
  return JSON.parse(readText(file))
}

function readText(file) {
  return readFileSync(path.join(repoRoot, file), 'utf8')
}

function writeJson(file, value) {
  mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true })
  writeFileSync(path.join(repoRoot, file), `${stableStringify(value)}\n`)
}

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value), null, 2)
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return sortObject(value)
}

function sortObject(value) {
  const sorted = {}

  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key])
  }

  return sorted
}

function comparePublicExports(left, right) {
  return publicExportKey(left).localeCompare(publicExportKey(right))
}

function publicExportKey(item) {
  return `${item.kind}:${item.name}:${item.source}:${item.via}`
}

function compareStringArrays(left, right) {
  return left.join('\0').localeCompare(right.join('\0'))
}

function isWithin(file, root) {
  const relative = path.relative(path.join(repoRoot, root), path.join(repoRoot, file))
  if (relative === '') return true
  if (relative.startsWith('..')) return false
  return !path.isAbsolute(relative)
}

function normalizePath(file) {
  return file.split(path.sep).join('/')
}

function relativePath(file) {
  return normalizePath(path.relative(repoRoot, file))
}
