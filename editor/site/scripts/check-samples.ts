import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const parser = unified().use(remarkParse).use(remarkMdx)
const packageMode = process.argv[2] === '--packages'
const sourceDirectory = packageMode
  ? undefined
  : (process.argv[2] ?? join(root, 'src/content/docs'))
const packageRoot = join(root, '../packages')
const modulePaths: Record<string, string[]> = {}
const temporary = await mkdtemp(join(root, '.samples-'))
const origins = new Map<string, string>()
const files: string[] = []

async function pages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && entry.name !== 'api') return pages(path)
      return entry.isFile() && /\.mdx?$/.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat()
}

async function packagePages(): Promise<string[]> {
  const readmes: string[] = []
  const entries = await readdir(packageRoot, { withFileTypes: true })
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = join(packageRoot, entry.name)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (manifest.private) continue
    readmes.push(join(directory, 'README.md'))
    addExports(manifest.name, manifest.exports, directory)
  }
  return readmes
}

function addExports(
  name: string,
  exports: Record<string, string | { types?: string }>,
  directory: string,
): void {
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target === 'string' || !target.types) continue
    const specifier = subpath === '.' ? name : `${name}${subpath.slice(1)}`
    modulePaths[specifier] = [join(directory, target.types)]
  }
}

try {
  const sources = packageMode ? await packagePages() : await pages(sourceDirectory!)
  for (const path of sources) {
    const tree = parser.parse(await readFile(path, 'utf8'))
    const snippets: { name: string; value: string }[] = []
    visit(tree, 'code', (node) => {
      if (!['ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript'].includes(node.lang ?? '')) return
      const suffix = ['js', 'jsx', 'javascript'].includes(node.lang ?? '') ? 'js' : 'ts'
      const extension = node.lang?.endsWith('x') ? `${suffix}x` : suffix
      const name = join(temporary, `snippet-${files.length + snippets.length}.${extension}`)
      origins.set(name, `${relative(root, path)}:${node.position?.start.line ?? 1}`)
      snippets.push({ name, value: `${node.value}\nexport {}\n` })
    })
    for (const snippet of snippets) {
      await writeFile(snippet.name, snippet.value)
      files.push(snippet.name)
    }
  }
  const options = {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: 'react-jsx',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    types: ['react'],
    ...(packageMode ? { paths: modulePaths } : {}),
  }
  async function check(name: string, examples: readonly string[], solid = false): Promise<void> {
    const config = join(temporary, `${name}.json`)
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          ...options,
          ...(solid ? { jsx: 'preserve', jsxImportSource: 'solid-js', types: [] } : {}),
        },
        files: examples,
      }),
    )
    const process = Bun.spawn([compiler, '--noEmit', '-p', config], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let output =
      (await new Response(process.stdout).text()) + (await new Response(process.stderr).text())
    for (const [file, origin] of origins) {
      output = output.replaceAll(relative(root, file), origin).replaceAll(file, origin)
    }
    if ((await process.exited) !== 0) {
      console.error(output)
      throw `Documentation samples failed in ${name}`
    }
  }
  const sampleCount = files.length
  if (packageMode) {
    const solid = files.filter((file) => origins.get(file)?.includes('/solid/README.md'))
    const other = files.filter((file) => !solid.includes(file))
    await check('packages', [join(root, 'src/env.d.ts'), ...other])
    await check('solid-package', [join(root, 'src/env.d.ts'), ...solid], true)
    console.log(`Checked ${sampleCount} package README samples across ${sources.length} packages.`)
  }
  if (!packageMode) {
    files.push(join(root, 'src/env.d.ts'))
    await check('docs', [
      ...files,
      ...['basic.ts', 'playground.ts', 'react.tsx'].map((file) => join(root, 'src/examples', file)),
    ])
    await check('solid', [join(root, 'src/env.d.ts'), join(root, 'src/examples/solid.tsx')], true)
    console.log(`Checked ${sampleCount} inline samples and 4 example files with TypeScript 7.`)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
