/**
 * First-load weight report. Builds the web app, then answers "which dependency
 * costs what" for the bytes a cold browser downloads before the first frame.
 *
 *   bun scripts/bundle-report.ts                 build `dist`, print the table
 *   bun scripts/bundle-report.ts --json=out.json also write the machine form
 *   bun scripts/bundle-report.ts --dir=<web dir> report an existing build
 *
 * `--dir` skips the build. Without `bundle-stats.json` beside that directory
 * the report has file totals but no per-package attribution.
 */
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  bundleStatsFile,
  GZIP_LEVEL,
  type BundleStats,
  type BundleStatsChunk,
} from './bundle-stats-plugin'

type Options = {
  readonly dir: string
  readonly build: boolean
  readonly json: string | null
}

type FirstLoadFile = {
  readonly fileName: string
  readonly kind: 'script' | 'stylesheet'
  readonly size: number
  readonly gzipSize: number
}

type PackageRow = {
  readonly name: string
  readonly versions: readonly string[]
  readonly firstLoadGzip: number
  readonly totalGzip: number
}

type PackageIdentity = {
  readonly name: string
  readonly version: string | null
}

type Report = {
  readonly dir: string
  readonly firstLoad: {
    readonly scriptGzip: number
    readonly stylesheetGzip: number
    readonly files: readonly FirstLoadFile[]
  }
  readonly build: {
    readonly chunkCount: number
    readonly chunkBytes: number
    readonly chunkGzip: number
  } | null
  readonly packages: readonly PackageRow[]
  readonly duplicatePackages: readonly {
    readonly name: string
    readonly versions: readonly string[]
  }[]
  readonly duplicateChunkNames: readonly {
    readonly name: string
    readonly files: readonly string[]
  }[]
}

const webRoot = path.resolve(import.meta.dirname, '..')
const NODE_MODULES_PACKAGE = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//gu

main()

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  if (options.build) runBuild()

  const report = buildReport(options.dir)
  printReport(report)
  if (!options.json) return
  fs.writeFileSync(options.json, JSON.stringify(report, null, 2) + '\n')
  console.log(`\nWrote ${options.json}`)
}

function parseOptions(args: readonly string[]): Options {
  let dir: string | null = null
  let json: string | null = null
  for (const arg of args) {
    if (arg.startsWith('--dir=')) dir = path.resolve(arg.slice('--dir='.length))
    else if (arg.startsWith('--json=')) json = path.resolve(arg.slice('--json='.length))
    else if (arg === '--json') json = path.join(webRoot, 'bundle-report.json')
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return { dir: dir ?? path.join(webRoot, 'dist'), build: dir === null, json }
}

function runBuild(): void {
  const result = Bun.spawnSync(['bun', '--env-file=../../.env', 'vite', 'build'], {
    cwd: webRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

function buildReport(dir: string): Report {
  const files = firstLoadFiles(dir)
  const stats = readStats(dir)
  const scriptGzip = sum(
    files.filter((file) => file.kind === 'script').map((file) => file.gzipSize),
  )
  const stylesheetGzip = sum(
    files.filter((file) => file.kind === 'stylesheet').map((file) => file.gzipSize),
  )
  if (!stats) {
    return {
      dir,
      firstLoad: { scriptGzip, stylesheetGzip, files },
      build: null,
      packages: [],
      duplicatePackages: [],
      duplicateChunkNames: [],
    }
  }

  const firstLoadNames = new Set(files.map((file) => file.fileName))
  const packages = attributePackages(stats.chunks, firstLoadNames)
  return {
    dir,
    firstLoad: { scriptGzip, stylesheetGzip, files },
    build: {
      chunkCount: stats.chunks.length,
      chunkBytes: sum(stats.chunks.map((chunk) => chunk.size)),
      chunkGzip: sum(stats.chunks.map((chunk) => chunk.gzipSize)),
    },
    packages,
    duplicatePackages: packages
      .filter((row) => row.versions.length > 1)
      .map((row) => ({ name: row.name, versions: row.versions })),
    duplicateChunkNames: duplicateChunkNames(stats.chunks),
  }
}

// What `index.html` names is what a cold browser fetches before the first
// frame: the entry script, every `modulepreload`, and the stylesheet.
function firstLoadFiles(dir: string): FirstLoadFile[] {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  const files: FirstLoadFile[] = []
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gu)) {
    const tag = match[1]
    const attributes = match[2] ?? ''
    const kind = firstLoadKind(tag ?? '', attributes)
    if (!kind) continue
    const href = attributeValue(attributes, tag === 'script' ? 'src' : 'href')
    if (!href) continue
    const fileName = assetPath(href)
    const bytes = fs.readFileSync(path.join(dir, fileName))
    files.push({
      fileName,
      kind,
      size: bytes.byteLength,
      gzipSize: gzipSync(bytes, { level: GZIP_LEVEL }).byteLength,
    })
  }
  return files
}

function firstLoadKind(tag: string, attributes: string): FirstLoadFile['kind'] | null {
  if (tag === 'script') return attributeValue(attributes, 'src') ? 'script' : null
  const rel = attributeValue(attributes, 'rel')
  if (rel === 'modulepreload') return 'script'
  if (rel === 'stylesheet') return 'stylesheet'
  return null
}

function attributeValue(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, 'u').exec(attributes)
  return match?.[1] ?? null
}

// Hrefs carry the deploy base (`/platform/assets/…`); the file lives at
// `<dir>/assets/…` regardless of base.
function assetPath(href: string): string {
  const index = href.indexOf('assets/')
  return index === -1 ? href.replace(/^\/+/u, '') : href.slice(index)
}

function readStats(dir: string): BundleStats | null {
  const file = bundleStatsFile(dir)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BundleStats
}

// A chunk's gzip bytes are split across its modules in proportion to their
// rendered length, then folded onto the package each module belongs to.
function attributePackages(
  chunks: readonly BundleStatsChunk[],
  firstLoadNames: ReadonlySet<string>,
): PackageRow[] {
  const resolver = createPackageResolver()
  const firstLoad = new Map<string, number>()
  const total = new Map<string, number>()
  const versions = new Map<string, Set<string>>()
  for (const chunk of chunks) {
    const rendered = sum(chunk.modules.map((module) => module.renderedLength))
    if (rendered === 0) continue
    const inFirstLoad = firstLoadNames.has(chunk.fileName)
    for (const module of chunk.modules) {
      const identity = resolver(module.id)
      const share = (module.renderedLength / rendered) * chunk.gzipSize
      total.set(identity.name, (total.get(identity.name) ?? 0) + share)
      if (inFirstLoad) firstLoad.set(identity.name, (firstLoad.get(identity.name) ?? 0) + share)
      if (identity.version) versionsFor(versions, identity.name).add(identity.version)
    }
  }
  return [...total.keys()]
    .map((name) => ({
      name,
      versions: [...(versions.get(name) ?? [])].sort(),
      firstLoadGzip: Math.round(firstLoad.get(name) ?? 0),
      totalGzip: Math.round(total.get(name) ?? 0),
    }))
    .sort((a, b) => b.firstLoadGzip - a.firstLoadGzip || b.totalGzip - a.totalGzip)
}

function versionsFor(versions: Map<string, Set<string>>, name: string): Set<string> {
  const existing = versions.get(name)
  if (existing) return existing
  const created = new Set<string>()
  versions.set(name, created)
  return created
}

function createPackageResolver(): (id: string) => PackageIdentity {
  const byDirectory = new Map<string, PackageIdentity>()
  return (rawId) => {
    if (rawId.startsWith('\0') || rawId.includes('virtual:')) {
      return { name: 'virtual', version: null }
    }
    const id = rawId.split('?')[0] ?? rawId
    const dependency = lastNodeModulesMatch(id)
    if (dependency) return cachedIdentity(byDirectory, dependency.dir, dependency.name)

    const packageDir = nearestPackageDir(path.dirname(id))
    if (!packageDir) return { name: 'app', version: null }
    return cachedIdentity(byDirectory, packageDir, null)
  }
}

function lastNodeModulesMatch(id: string): { readonly name: string; readonly dir: string } | null {
  let last: RegExpExecArray | null = null
  for (const match of id.matchAll(NODE_MODULES_PACKAGE)) last = match
  if (!last?.[1]) return null
  return { name: last[1], dir: id.slice(0, last.index + last[0].length - 1) }
}

function nearestPackageDir(start: string): string | null {
  let dir = start
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return null
}

function cachedIdentity(
  cache: Map<string, PackageIdentity>,
  dir: string,
  fallbackName: string | null,
): PackageIdentity {
  const cached = cache.get(dir)
  if (cached) return cached
  const manifest = readManifest(path.join(dir, 'package.json'))
  const name = manifest?.name ?? fallbackName ?? path.basename(dir)
  const identity = {
    name: name === 'web' ? 'app' : name,
    version: manifest?.version ?? null,
  }
  cache.set(dir, identity)
  return identity
}

function readManifest(file: string): { name?: string; version?: string } | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// `typescript-BydbNFcO.js` and `typescript-CkrWeWcv.js` are the same module
// emitted twice; the basename without its hash is what says so.
function duplicateChunkNames(chunks: readonly BundleStatsChunk[]) {
  const byName = new Map<string, string[]>()
  for (const chunk of chunks) {
    const base = path.basename(chunk.fileName).replace(/-[\w-]{8}\.js$/u, '')
    const files = byName.get(base) ?? []
    files.push(chunk.fileName)
    byName.set(base, files)
  }
  return [...byName]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => ({ name, files: files.sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name))
}

function printReport(report: Report): void {
  const { firstLoad, build } = report
  console.log(`Build: ${report.dir}`)
  console.log(
    `First-load JS: ${kb(firstLoad.scriptGzip)} gz across ${countOf(firstLoad.files, 'script')} files`,
  )
  console.log(`First-load CSS: ${kb(firstLoad.stylesheetGzip)} gz`)
  if (!build) {
    console.log('No bundle-stats.json beside this build; per-package attribution skipped.')
    return
  }
  console.log(
    `Whole build: ${build.chunkCount} chunks, ${mb(build.chunkBytes)} raw, ${kb(build.chunkGzip)} gz`,
  )
  console.log('\nPackage                                  First-load gz    Total gz  Versions')
  for (const row of report.packages.slice(0, 40)) {
    console.log(
      `${row.name.padEnd(40)} ${kb(row.firstLoadGzip).padStart(13)} ${kb(row.totalGzip).padStart(11)}  ${row.versions.join(', ')}`,
    )
  }
  printDuplicates(report)
}

function printDuplicates(report: Report): void {
  console.log('')
  if (report.duplicatePackages.length === 0)
    console.log('No package resolved at more than one version.')
  for (const duplicate of report.duplicatePackages) {
    console.log(`Duplicate package: ${duplicate.name} at ${duplicate.versions.join(' and ')}`)
  }
  console.log(`Duplicated chunk basenames: ${report.duplicateChunkNames.length}`)
  for (const duplicate of report.duplicateChunkNames.slice(0, 10)) {
    console.log(`  ${duplicate.name}: ${duplicate.files.join(', ')}`)
  }
}

function countOf(files: readonly FirstLoadFile[], kind: FirstLoadFile['kind']): number {
  return files.filter((file) => file.kind === kind).length
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
