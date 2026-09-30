#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type PackageManifest = {
  name: string
  workspaces?: string[]
  scripts?: Record<string, string>
  exports?: Record<string, string | Record<string, string>>
} & Partial<
  Record<
    'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies',
    Record<string, string>
  >
>
type PackageInfo = { name: string; dir: string; packageFile: string; packageJson: PackageManifest }
type PublicExport = { name: string; kind: string; source: string; via: string }
type ApiInventory = {
  schemaVersion: number
  packageName: string
  packagePath: string
  reviewPolicy: string
  entrypoints: { specifier: string; source: string; exports: PublicExport[] }[]
}
type Timer = {
  id: string
  api: string
  file: string
  line: number
  snippet: string
  justification: string
}
type TimerInventory = { schemaVersion: number; reviewPolicy: string; timers: Timer[] }
type Graph = Map<string, string[]>
type StrongState = {
  index: number
  stack: string[]
  indices: Map<string, number>
  lowlinks: Map<string, number>
  onStack: Set<string>
  components: string[][]
}
type Health = ReturnType<typeof collectHealthBaseline>
type Baselines = { health: Health; publicApi: ApiInventory; timers: TimerInventory }

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
    timers: collectTimerBaseline(parseTimers(readOptionalJson(baselineFiles.timers))),
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
    ...comparePublicApi(current.publicApi, parseApi(readRequiredJson(baselineFiles.publicApi))),
    ...compareTimers(
      current.timers,
      parseTimers(readRequiredJson(baselineFiles.timers)) ?? {
        schemaVersion: 1,
        reviewPolicy: '',
        timers: [],
      },
    ),
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

function collectTimerBaseline(previous: TimerInventory | null) {
  const previousTimers = previousTimerLookup(previous)

  return {
    schemaVersion: 1,
    reviewPolicy:
      'Production timers must name why they are scheduler-safe or why they remain legacy debt.',
    timers: timerUsages(previousTimers),
  }
}

function previousTimerLookup(previous: TimerInventory | null) {
  return new Map((previous?.timers ?? []).map((entry) => [entry.id, entry]))
}

function workspacePackages() {
  const rootPackage = readPackageJson('package.json')
  const packageFiles = []

  for (const pattern of rootPackage.workspaces ?? []) {
    for (const packageFile of expandWorkspacePattern(pattern)) packageFiles.push(packageFile)
  }

  return packageFiles
    .map((packageFile) => {
      const packageJson = readPackageJson(packageFile)
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

function expandWorkspacePattern(pattern: string) {
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

function packageJsonIfExists(candidate: string) {
  const absolute = path.join(repoRoot, candidate)
  if (!existsSync(absolute)) return []
  return [normalizePath(candidate)]
}

function buildPackageGraph(packages: PackageInfo[]) {
  const names = new Set(packages.map((item) => item.name))
  const graph: Graph = new Map()

  for (const item of packages) {
    graph.set(item.name, packageDependencies(item.packageJson, names))
  }

  return graph
}

function packageDependencies(packageJson: PackageManifest, workspaceNames: Set<string>) {
  const sections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const
  const dependencies = new Set<string>()

  for (const section of sections) {
    for (const name of Object.keys(packageJson[section] ?? {})) {
      if (!workspaceNames.has(name)) continue
      dependencies.add(name)
    }
  }

  return [...dependencies].sort()
}

function missingPackageScripts(packages: PackageInfo[]) {
  const missing: Record<string, string[]> = {}

  for (const item of packages) {
    const scripts = item.packageJson.scripts ?? {}
    const missingScripts = config.expectedPackageScripts.filter((script) => !scripts[script])
    if (missingScripts.length === 0) continue
    missing[item.name] = missingScripts
  }

  return missing
}

function collectSourceCycles() {
  const cycles: Record<string, string[][]> = {}

  for (const scope of config.sourceCycleScopes) {
    cycles[scope.name] = sourceCyclesForScope(scope.root)
  }

  return cycles
}

function sourceCyclesForScope(root: string) {
  const files = sourceFiles(root)
  const fileSet = new Set(files.map((file) => path.resolve(repoRoot, file)))
  const graph: Graph = new Map()

  for (const file of files) {
    graph.set(file, relativeImportsForFile(file, fileSet, root))
  }

  return stronglyConnectedComponents(graph)
}

function relativeImportsForFile(file: string, fileSet: Set<string>, scopeRoot: string) {
  const content = readText(file)
  const imports = new Set<string>()

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

function importSpecifiers(content: string) {
  const specifiers: string[] = []
  const importExportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  collectPatternMatches(importExportPattern, content, specifiers)
  collectPatternMatches(dynamicImportPattern, content, specifiers)
  return specifiers
}

function collectPatternMatches(pattern: RegExp, content: string, output: string[]) {
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier) output.push(specifier)
  }
}

function resolveRelativeModule(fromFile: string, specifier: string) {
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
  const groups: Record<string, { modulePath: string; files: string[] }[]> = {}

  for (const group of config.duplicateModuleGroups) {
    groups[group.name] = duplicateModulesForGroup(group)
  }

  return groups
}

function duplicateModulesForGroup(group: { roots: string[] }) {
  const byModule = new Map<string, string[]>()

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

function publicEntrypoints(packageInfo: PackageInfo) {
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
function entrypointSource(packageInfo: PackageInfo, target: string | Record<string, string>) {
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

function moduleExports(source: string) {
  const seen = new Set<string>()
  const exports = collectModuleExports(source, seen)
  const unique = new Map<string, PublicExport>()

  for (const item of exports) {
    unique.set(publicExportKey(item), item)
  }

  return [...unique.values()].sort(comparePublicExports)
}

function collectModuleExports(source: string, seen: Set<string>): PublicExport[] {
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

function namedReExports(content: string, source: string) {
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

function starReExports(content: string, source: string, seen: Set<string>) {
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

function localExportLists(content: string, source: string) {
  const exports = []
  const pattern = /\bexport\s+(type\s+)?\{([^{}]*?)\}(?!\s*from\b)/g

  for (const match of content.matchAll(pattern)) {
    const kind = match[1] ? 'type' : 'unknown'
    for (const name of exportSpecifierNames(match[2]))
      exports.push({ name, kind, source, via: source })
  }

  return exports
}

function declarationExports(content: string, source: string) {
  const exports = []
  const pattern =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g

  for (const match of content.matchAll(pattern)) {
    exports.push({ name: match[2], kind: exportDeclarationKind(match[1]), source, via: source })
  }

  return exports
}

function defaultExports(content: string, source: string) {
  if (!/\bexport\s+default\b/.test(content)) return []
  return [{ name: 'default', kind: 'unknown', source, via: source }]
}

function exportSpecifierNames(block: string) {
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

function exportDeclarationKind(kind: string) {
  if (kind === 'interface' || kind === 'type') return 'type'
  return 'value'
}

function timerUsages(previousTimers: Map<string, Timer>) {
  const timers: Timer[] = []
  const occurrences = new Map()

  for (const file of productionSourceFiles()) {
    const lines = readText(file).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      addTimersFromLine(timers, previousTimers, occurrences, file, index, line, lines)
    }
  }

  return timers.sort((left, right) => left.id.localeCompare(right.id))
}

function addTimersFromLine(
  timers: Timer[],
  previousTimers: Map<string, Timer>,
  occurrences: Map<string, number>,
  file: string,
  index: number,
  line: string,
  lines: string[],
) {
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

function nextOccurrence(
  occurrences: Map<string, number>,
  file: string,
  api: string,
  snippet: string,
) {
  const key = `${file}\0${api}\0${snippet}`
  const occurrence = occurrences.get(key) ?? 0
  occurrences.set(key, occurrence + 1)
  return occurrence
}

function timerId(file: string, api: string, snippet: string, occurrence: number) {
  const hash = createHash('sha256')
    .update(`${file}\0${api}\0${snippet}\0${occurrence}`)
    .digest('hex')
    .slice(0, 10)
  return `${file}:${api}:${hash}`
}

function productionSourceFiles() {
  const files: string[] = []

  for (const root of config.productionSourceRoots) {
    for (const file of sourceFiles(root)) {
      if (!isProductionSource(file)) continue
      files.push(file)
    }
  }

  return files.sort()
}

function isProductionSource(file: string) {
  if (file.startsWith('examples/stress/') && !file.startsWith('examples/stress/src/')) return false
  if (file.includes('/test/')) return false
  if (file.includes('/bench/')) return false
  if (file.endsWith('.test.ts')) return false
  if (file.endsWith('.test.tsx')) return false
  return true
}

function sourceFiles(root: string) {
  return walk(root)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .filter((file) => !file.endsWith('.d.ts'))
    .sort()
}

function walk(root: string) {
  const absoluteRoot = path.join(repoRoot, root)
  if (!existsSync(absoluteRoot)) return []

  const files: string[] = []
  walkDirectory(absoluteRoot, files)
  return files.map(relativePath).sort()
}

function walkDirectory(directory: string, files: string[]) {
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

function isIgnored(relative: string) {
  const parts = normalizePath(relative).split('/')
  return parts.some((part) => config.ignoredRoots.includes(part))
}

function stronglyConnectedComponents(graph: Graph) {
  const state: StrongState = {
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

function visitStrongComponent(node: string, graph: Graph, state: StrongState) {
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

function updateStrongComponentLowlink(
  node: string,
  next: string,
  graph: Graph,
  state: StrongState,
) {
  if (!state.indices.has(next)) {
    visitStrongComponent(next, graph, state)
    state.lowlinks.set(node, Math.min(state.lowlinks.get(node)!, state.lowlinks.get(next)!))
    return
  }

  if (!state.onStack.has(next)) return
  state.lowlinks.set(node, Math.min(state.lowlinks.get(node)!, state.indices.get(next)!))
}

function popStrongComponent(node: string, state: StrongState) {
  const component = []

  while (state.stack.length > 0) {
    const current = state.stack.pop()!
    state.onStack.delete(current)
    component.push(current)
    if (current === node) break
  }

  state.components.push(component)
}

function compareJsonBaseline(label: string, file: string, current: unknown) {
  const baseline = readRequiredJson(file)
  if (stableStringify(current) === stableStringify(baseline)) return []
  return [`${label} changed; update ${file} with review if intentional`]
}

function comparePublicApi(current: ApiInventory, baseline: ApiInventory) {
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

function publicApiKeys(inventory: ApiInventory) {
  const keys = new Set()

  for (const entrypoint of inventory.entrypoints ?? []) {
    for (const item of entrypoint.exports ?? []) {
      keys.add(`${entrypoint.specifier}:${item.kind}:${item.name}`)
    }
  }

  return keys
}

function compareTimers(current: TimerInventory, baseline: TimerInventory) {
  return [...timerIdFailures(current, baseline), ...timerJustificationFailures(current)]
}

function timerIdFailures(current: TimerInventory, baseline: TimerInventory) {
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

function timerJustificationFailures(current: TimerInventory) {
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
function inlineJustification(lines: string[], index: number) {
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

function isValidJustification(value: unknown) {
  if (typeof value !== 'string') return false
  if (value.trim().length === 0) return false
  return !value.includes('TODO:')
}

function printWriteSummary(current: Baselines) {
  console.log('Wrote architecture health baselines.')
  printSummary(current)
}

function printCheckSummary(current: Baselines) {
  console.log('Architecture health scan complete.')
  printSummary(current)
}

function printSummary(current: Baselines) {
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

function readRequiredJson(file: string) {
  if (!existsSync(path.join(repoRoot, file))) {
    throw new Error(`Missing baseline ${file}; run bun run health:write`)
  }

  return readJsonFile(file)
}

function readOptionalJson(file: string) {
  if (!existsSync(path.join(repoRoot, file))) return null
  return readJsonFile(file)
}

function readJsonFile(file: string) {
  const value: unknown = JSON.parse(readText(file))
  return value
}

function readText(file: string) {
  return readFileSync(path.join(repoRoot, file), 'utf8')
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true })
  writeFileSync(path.join(repoRoot, file), `${stableStringify(value)}\n`)
}

function stripComments(content: string) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortJson(value), null, 2)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return sortObject(Object.fromEntries(Object.entries(value)))
}

function sortObject(value: Record<string, unknown>) {
  const sorted: Record<string, unknown> = {}

  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key])
  }

  return sorted
}

function comparePublicExports(left: PublicExport, right: PublicExport) {
  return publicExportKey(left).localeCompare(publicExportKey(right))
}

function publicExportKey(item: PublicExport) {
  return `${item.kind}:${item.name}:${item.source}:${item.via}`
}

function compareStringArrays(left: string[], right: string[]) {
  return left.join('\0').localeCompare(right.join('\0'))
}

function isWithin(file: string, root: string) {
  const relative = path.relative(path.join(repoRoot, root), path.join(repoRoot, file))
  if (relative === '') return true
  if (relative.startsWith('..')) return false
  return !path.isAbsolute(relative)
}

function normalizePath(file: string) {
  return file.split(path.sep).join('/')
}

function relativePath(file: string) {
  return normalizePath(path.relative(repoRoot, file))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected JSON string')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('Expected JSON array')
  return value.map(stringValue)
}
function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new TypeError('Expected JSON object')
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stringValue(entry)]))
}
function readPackageJson(file: string): PackageManifest {
  const value = readJsonFile(file)
  if (!isRecord(value)) throw new TypeError('Expected package manifest')
  const exports = value.exports
  if (exports !== undefined && !isRecord(exports)) throw new TypeError('Expected export map')
  return {
    name: stringValue(value.name),
    ...(value.workspaces === undefined ? {} : { workspaces: strings(value.workspaces) }),
    ...(value.scripts === undefined ? {} : { scripts: stringRecord(value.scripts) }),
    ...(exports === undefined
      ? {}
      : {
          exports: Object.fromEntries(
            Object.entries(exports).map(([key, target]) => [
              key,
              typeof target === 'string' ? target : stringRecord(target),
            ]),
          ),
        }),
    ...Object.fromEntries(
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, stringRecord(value[key])]),
    ),
  }
}
function parseTimers(value: unknown): TimerInventory | null {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.timers))
    throw new TypeError('Expected timer inventory')
  return {
    schemaVersion: Number(value.schemaVersion),
    reviewPolicy: stringValue(value.reviewPolicy),
    timers: value.timers.map(parseTimer),
  }
}
function parseTimer(value: unknown): Timer {
  if (!isRecord(value) || typeof value.line !== 'number')
    throw new TypeError('Expected timer entry')
  return {
    id: stringValue(value.id),
    api: stringValue(value.api),
    file: stringValue(value.file),
    line: value.line,
    snippet: stringValue(value.snippet),
    justification: stringValue(value.justification),
  }
}
function parseApi(value: unknown): ApiInventory {
  if (!isRecord(value) || !Array.isArray(value.entrypoints))
    throw new TypeError('Expected API inventory')
  return {
    schemaVersion: Number(value.schemaVersion),
    packageName: stringValue(value.packageName),
    packagePath: stringValue(value.packagePath),
    reviewPolicy: stringValue(value.reviewPolicy),
    entrypoints: value.entrypoints.map(parseEntrypoint),
  }
}
function parseEntrypoint(value: unknown): ApiInventory['entrypoints'][number] {
  if (!isRecord(value) || !Array.isArray(value.exports))
    throw new TypeError('Expected API entrypoint')
  return {
    specifier: stringValue(value.specifier),
    source: stringValue(value.source),
    exports: value.exports.map(parseExport),
  }
}
function parseExport(value: unknown): PublicExport {
  if (!isRecord(value)) throw new TypeError('Expected API export')
  return {
    name: stringValue(value.name),
    kind: stringValue(value.kind),
    source: stringValue(value.source),
    via: stringValue(value.via),
  }
}
