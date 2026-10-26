import fs from 'node:fs'
import path from 'node:path'
import { createScriptError } from './structured-errors.ts'

export type DevPackage = {
  readonly name: string
  readonly root: string
  // The checkout the package lives in. Its source imports grammars and wasm
  // from that checkout's own dependency store, outside the package root, and
  // Vite serves an asset import it may not read as the raw file.
  readonly checkout: string
  readonly entries: ReadonlyMap<string, string>
}

const sourceExtensions = ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']

export function readDevSources(webRoot: string): readonly DevPackage[] {
  const manifest = readManifest(path.join(webRoot, 'package.json'))
  const dependencies = objectField(manifest.dependencies, 'web dependencies')
  const editors = Object.keys(dependencies).filter((name) => name.startsWith('@singapore-editor/'))
  if (editors.length === 0) throw createScriptError('No editor dependencies found in the web app.')

  return editors
    .concat(['@fregat/hotkeys', 'ghostty-webgpu'])
    .flatMap((name) => readSourcePackage(webRoot, name))
}

export function sourceAliases(packages: readonly DevPackage[]) {
  return packages.flatMap((pkg) =>
    Array.from(pkg.entries, ([id, file]) => {
      const wildcard = id.endsWith('/*')
      const specifier = wildcard ? id.slice(0, -1) : id
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return {
        find: new RegExp(`^${escaped}${wildcard ? '([^?]+)' : '(?=\\?|$)'}`),
        replacement: wildcard ? file.slice(0, -1) + '$1' : file,
      }
    }),
  )
}

export function sourcePaths(packages: readonly DevPackage[]): Record<string, string[]> {
  return Object.fromEntries(
    packages.flatMap((pkg) => Array.from(pkg.entries, ([id, file]) => [id, [file]])),
  )
}

export function writeDevTypeConfig(webRoot: string, packages: readonly DevPackage[]): string {
  const ghostty = packages.find((pkg) => pkg.name === 'ghostty-webgpu')

  const file = path.join(webRoot, 'node_modules/.tmp/tsconfig.dev.json')
  const config = {
    extends: path.join(webRoot, 'tsconfig.app.json'),
    compilerOptions: {
      tsBuildInfoFile: path.join(webRoot, 'node_modules/.tmp/tsconfig.dev.tsbuildinfo'),
      // Workspace packages own unused-symbol checks; the normal build still checks ours.
      noUnusedLocals: false,
      noUnusedParameters: false,
      paths: {
        '@/*': [path.join(webRoot, 'src/*')],
        '@workspace/ui/*': [path.resolve(webRoot, '../../packages/ui/src/*')],
        ...sourcePaths(packages),
      },
    },
    files: ghostty
      ? [requiredFile(ghostty.root, 'node_modules/@webgpu/types/dist/index.d.ts')]
      : [],
  }
  const text = JSON.stringify(config, null, 2) + '\n'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text)
  return file
}

function packageRoot(webRoot: string, name: string): { root: string; linked: boolean } {
  const candidates = [webRoot, path.resolve(webRoot, '../..')]
  const linked = candidates
    .map((base) => path.join(base, 'node_modules', name))
    .find((candidate) => fs.existsSync(path.join(candidate, 'package.json')))
  if (!linked) throw createScriptError(`Missing ${name}. Run bun install at the repository root.`)

  return { root: fs.realpathSync(linked), linked: fs.lstatSync(linked).isSymbolicLink() }
}

function readSourcePackage(webRoot: string, name: string): readonly DevPackage[] {
  const packageLink = packageRoot(webRoot, name)
  if (!packageLink.linked) return []
  const { root } = packageLink
  const checkout = checkoutRoot(root)
  if (!checkout) return []
  if (name === '@fregat/hotkeys') return [readHotkeysPackage(root, checkout)]
  if (name === 'ghostty-webgpu') return [readGhosttyPackage(root, checkout)]
  return [readEditorPackage(root, name, checkout)]
}

function readEditorPackage(root: string, name: string, checkout: string): DevPackage {
  const manifest = readManifest(path.join(root, 'package.json'))
  const exports = objectField(manifest.exports, `${name} exports`)
  const entries = new Map<string, string>()
  for (const [subpath, value] of Object.entries(exports)) {
    const target = exportTarget(value, name)
    if (target === undefined) continue
    const id = subpath === '.' ? name : `${name}${subpath.slice(1)}`
    if (subpath.endsWith('/*')) {
      entries.set(id, editorSourcePattern(root, target, id))
      continue
    }
    entries.set(id, editorSourcePath(root, target, id))
  }
  if (!entries.has(name)) throw createScriptError(`Missing source entry for ${name}.`)

  return { name, root, checkout, entries }
}

function readHotkeysPackage(root: string, checkout: string): DevPackage {
  const name = '@fregat/hotkeys'
  const entries = new Map([[name, requiredFile(root, 'src/index.ts')]])
  return { name, root, checkout, entries }
}

function readGhosttyPackage(root: string, checkout: string): DevPackage {
  const name = 'ghostty-webgpu'
  const entries = new Map([
    [name, requiredFile(root, 'src/index.ts')],
    [`${name}/ghostty-vt.wasm`, requiredFile(root, 'ghostty-vt.wasm')],
    [`${name}/bridge.wasm`, requiredFile(root, 'bridge.wasm')],
  ])
  return { name, root, checkout, entries }
}

function checkoutRoot(root: string): string | undefined {
  let dir = root
  while (true) {
    // Installed caches can live inside the consumer's Git tree.
    if (['.bun', '.cache', 'cache', 'node_modules'].includes(path.basename(dir))) return undefined
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function editorSourcePath(root: string, target: string, id: string): string {
  if (!target.startsWith('./dist/'))
    throw createScriptError(`Cannot resolve ${id} to source from ${target}.`)

  const source = path.join(root, target.replace('./dist/', './src/'))
  if (!source.endsWith('.js')) return requiredFile(root, path.relative(root, source))

  const base = source.slice(0, -3)
  const file = sourceExtensions
    .map((extension) => base + extension)
    .find((candidate) => fs.existsSync(candidate))
  if (!file)
    throw createScriptError(
      `Missing source for ${id} at ${base}. Run bun install at the repository root to restore workspace packages.`,
    )

  return fs.realpathSync(file)
}

// `./dist/*.js` becomes `<root>/src/*`; tsconfig paths and Vite aliases
// both substitute the remainder.
function editorSourcePattern(root: string, target: string, id: string): string {
  if (!target.startsWith('./dist/') || !target.endsWith('/*.js'))
    throw createScriptError(`Cannot resolve ${id} to a source pattern from ${target}.`)

  return path.join(root, target.replace('./dist/', './src/').slice(0, -3))
}

function requiredFile(root: string, relative: string): string {
  const file = path.join(root, relative)
  if (!fs.existsSync(file))
    throw createScriptError(
      `Missing development input ${file}. Restore source files or build the package's generated assets.`,
    )

  return fs.realpathSync(file)
}

function exportTarget(value: unknown, name: string): string | undefined {
  if (typeof value === 'string') return value

  const conditions = objectField(value, `${name} export conditions`)
  const target = conditions.import ?? conditions.default
  if (typeof target === 'string') return target
  if (typeof conditions.bun === 'string') return undefined
  throw createScriptError(`Missing browser export target in ${name}.`)
}

function readManifest(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  return objectField(parsed, file)
}

function objectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createScriptError(`Invalid ${label}: expected an object.`)

  return Object.fromEntries(Object.entries(value))
}
