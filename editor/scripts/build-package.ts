import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'

type PackageManifest = {
  readonly name: string
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly exports?: Record<string, ExportTarget>
}

type ExportTarget =
  | string
  | {
      readonly default?: string
      readonly import?: string
      readonly types?: string
    }

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const packageDir = path.resolve(Bun.argv[2] ?? '.')
const packageJsonPath = path.join(packageDir, 'package.json')
const sourceRoot = path.join(packageDir, 'src')
const distRoot = path.join(packageDir, 'dist')

const manifest = await readManifest()
const entries = entriesFromExports(manifest.exports)

if (Object.keys(entries).length === 0) {
  throw new Error(`${manifest.name} has no TypeScript package exports to build`)
}

await rm(distRoot, { recursive: true, force: true })
// CSS lands before the JS that imports it, so a watching dev server never sees
// a dist where index.js exists and its `import './style.css'` cannot resolve.
await copyCss()
await buildJavaScript()
await emitDeclarations()

async function readManifest(): Promise<PackageManifest> {
  const content = await readFile(packageJsonPath, 'utf8')
  return JSON.parse(content) as PackageManifest
}

function entriesFromExports(exportsField: PackageManifest['exports']): Record<string, string> {
  if (!exportsField) return {}

  const entries: Record<string, string> = {}
  for (const [exportPath, target] of Object.entries(exportsField)) {
    const source = sourceTarget(target)
    if (!source) continue
    if (!source.endsWith('.ts') && !source.endsWith('.tsx')) continue

    entries[entryName(exportPath, source)] = path.resolve(packageDir, source)
  }
  return entries
}

function sourceTarget(target: ExportTarget): string | null {
  if (typeof target === 'string') return sourceTargetFromRuntimeTarget(target)
  return sourceTargetFromRuntimeTarget(target.import ?? target.default ?? null)
}

function sourceTargetFromRuntimeTarget(target: string | null): string | null {
  if (!target) return null
  if (target.startsWith('./src/')) return target
  if (!target.startsWith('./dist/')) return target

  const source = target.replace(/^\.\/dist\//, './src/')
  if (!source.endsWith('.js')) return source

  const base = source.slice(0, -3)
  return existsSync(path.resolve(packageDir, `${base}.ts`)) ? `${base}.ts` : `${base}.tsx`
}

function entryName(exportPath: string, source: string): string {
  if (exportPath === '.') return 'index'

  const sourceName = source.replace(/^\.\/src\//, '').replace(/\.tsx?$/, '')
  return sourceName.replaceAll(path.sep, '/')
}

async function buildJavaScript(): Promise<void> {
  const workerReferences: string[] = []
  await build({
    assetsInclude: ['**/*.wasm'],
    // Relative, so an emitted worker URL resolves from the module that constructs it.
    base: './',
    build: {
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      emptyOutDir: false,
      lib: {
        entry: entries,
        formats: ['es'],
      },
      minify: false,
      outDir: distRoot,
      rollupOptions: {
        external: externalDependency,
        output: {
          assetFileNames: 'assets/[name][extname]',
          chunkFileNames: 'chunks/[name]-[hash].js',
          entryFileNames: '[name].js',
          preserveModules: true,
          preserveModulesRoot: sourceRoot,
        },
      },
      sourcemap: true,
      target: 'es2023',
    },
    configFile: false,
    logLevel: 'warn',
    plugins: [externalizeCssImports(), canonicalModuleWorkers(workerReferences)],
    publicDir: false,
    root: packageDir,
    worker: {
      format: 'es',
      rollupOptions: {
        external: [],
      },
    },
  })
  await assertWorkersAreCanonical(workerReferences)
}

function externalDependency(id: string, importer?: string): boolean {
  if (isSourceImport(id)) return false
  if (isWorkerImport(id, importer)) return false

  return externalPackageNames().has(packageNameFromSpecifier(id))
}

function isSourceImport(id: string): boolean {
  if (id.startsWith('.')) return true
  if (id.startsWith('/')) return true
  return id.includes('?')
}

function isWorkerImport(id: string, importer?: string): boolean {
  if (id.includes('?worker')) return false
  if (!importer) return false
  return importer.includes('.worker.')
}

function externalPackageNames(): ReadonlySet<string> {
  return new Set(
    Object.keys(manifest.dependencies ?? {}).concat(
      Object.keys(manifest.peerDependencies ?? {}),
      Object.keys(manifest.optionalDependencies ?? {}),
    ),
  )
}

function packageNameFromSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier

  const [scope, name] = specifier.split('/')
  return `${scope}/${name}`
}

function externalizeCssImports(): Plugin {
  return {
    name: 'singapore-externalize-css-imports',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith('.css')) return null
      if (!importer) return null

      const resolved = await this.resolve(id, importer)
      if (!resolved) return null

      return { id: resolved.id, external: true }
    },
  }
}

// Vite emits a library worker as `new URL("" + new URL(x, import.meta.url).href, …)` behind a
// vite-ignore, which a consumer's bundler reads as a plain asset. The canonical form gets bundled.
function canonicalModuleWorkers(workerReferences: string[]): Plugin {
  return {
    name: 'singapore-canonical-module-workers',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue

        output.code = output.code.replace(emittedWorkerPattern(), (_match, workerPath: string) => {
          const relativePath = explicitlyRelative(JSON.parse(workerPath) as string)
          workerReferences.push(`${output.fileName} -> ${relativePath}`)
          return `new Worker(new URL(${JSON.stringify(relativePath)}, import.meta.url), { type: "module" })`
        })
      }
    },
  }
}

function explicitlyRelative(workerPath: string): string {
  if (workerPath.startsWith('.')) return workerPath
  return `./${workerPath}`
}

function emittedWorkerPattern(): RegExp {
  return /new Worker\(\s*new URL\(\s*\/\* @vite-ignore \*\/\s*(?:"" \+ )?new URL\(("[^"]+"), import\.meta\.url\)\.href,\s*"" \+ import\.meta\.url\s*\),\s*\{\s*type: "module"\s*\}\s*\)/g
}

async function assertWorkersAreCanonical(workerReferences: readonly string[]): Promise<void> {
  const sources = await moduleWorkerSources(sourceRoot)
  if (sources.length === workerReferences.length) return

  throw new Error(
    `Every module worker must be emitted as new Worker(new URL(…, import.meta.url)).\nSource:\n${sources.join('\n')}\nEmitted:\n${workerReferences.join('\n')}`,
  )
}

async function moduleWorkerSources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const sources: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!isTypeScriptModule(entry.name)) continue
    if (isTestModule(entry.name)) continue

    const file = path.join(entry.parentPath, entry.name)
    const code = await readFile(file, 'utf8')
    for (const match of code.matchAll(workerConstructorPattern())) {
      sources.push(`${path.relative(packageDir, file)} -> ${match[1]}`)
    }
  }
  return sources.toSorted()
}

function isTypeScriptModule(name: string): boolean {
  if (name.endsWith('.ts')) return true
  return name.endsWith('.tsx')
}

function isTestModule(name: string): boolean {
  return /\.test\.tsx?$/.test(name)
}

function workerConstructorPattern(): RegExp {
  return /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"](\.\/[^'"]+\.worker\.ts)['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*,?\s*\}\s*\)/g
}

async function emitDeclarations(): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'singapore-dts-'))
  const tsconfigPath = path.join(tempDir, 'tsconfig.json')

  try {
    await writeFile(tsconfigPath, declarationTsconfig())
    await run(['bun', 'x', 'tsc', '-p', tsconfigPath], repositoryRoot)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function declarationTsconfig(): string {
  return JSON.stringify(
    {
      extends: path.join(repositoryRoot, 'tsconfig.json'),
      compilerOptions: {
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: true,
        // Packages with `.tsx` sources; the root config omits it because most have none.
        jsx: 'react-jsx',
        noEmit: false,
        outDir: distRoot,
        rootDir: sourceRoot,
      },
      include: [path.join(sourceRoot, '**/*')],
    },
    null,
    2,
  )
}

async function copyCss(): Promise<void> {
  await copyCssDirectory(sourceRoot)
}

async function copyCssDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await copyCssDirectory(source)
      continue
    }

    if (!entry.name.endsWith('.css')) continue

    const target = path.join(distRoot, path.relative(sourceRoot, source))
    await mkdir(path.dirname(target), { recursive: true })
    await cp(source, target)
  }
}

async function run(command: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    stdin: 'inherit',
    stderr: 'inherit',
    stdout: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode === 0) return

  throw new Error(`Command failed: ${command.join(' ')}`)
}
