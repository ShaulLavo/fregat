import { existsSync } from 'node:fs'
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'vite'
import assert from 'node:assert/strict'

const root = import.meta.dirname
const repository = path.resolve(root, '../../..')
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'dist'))
const alias: { find: RegExp; replacement: string }[] = []
for (const family of ['editor/packages', 'hotkeys/packages', 'packages']) {
  for (const name of await readdir(path.join(repository, family))) {
    const directory = path.join(repository, family, name)
    const manifestPath = path.join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
      const runtime = typeof target === 'string' ? target : (target as { import?: string }).import
      if (!runtime?.startsWith('./dist/')) continue
      const exported = manifest.name + (entry === '.' ? '' : entry.slice(1))
      const pattern = exported
        .split('*')
        .map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(.+)')
      const find = new RegExp(`^${pattern}$`)
      let source = runtime.replace('./dist/', './src/')
      if (entry.includes('*')) {
        alias.push({
          find,
          replacement: path.join(directory, source.replace('*', '$1').replace(/\.js$/, '.ts')),
        })
        continue
      }
      if (source.endsWith('.js')) {
        const base = source.slice(0, -3)
        source = existsSync(path.join(directory, `${base}.ts`)) ? `${base}.ts` : `${base}.tsx`
      }
      if (!existsSync(path.join(directory, source))) continue
      alias.push({
        find,
        replacement: path.join(directory, source),
      })
    }
  }
}
alias.sort((a, b) => b.find.source.length - a.find.source.length)
await build({
  configFile: false,
  root,
  base: './',
  resolve: { alias },
  worker: {
    format: 'es',
    plugins: () => [{ name: 'workspace-source', config: () => ({ resolve: { alias } }) }],
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2023',
    rollupOptions: {
      input: path.join(root, 'src/editor.ts'),
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'editor.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
await copyFile(path.join(root, 'src/loader.js'), path.join(outDir, 'loader.js'))
await copyFile(path.join(root, 'index.html'), path.join(outDir, 'index.html'))
const assets = await readdir(path.join(outDir, 'assets'))
const css = assets.filter((name) => name.endsWith('.css'))
const entry = path.join(outDir, 'editor.js')
const script = await readFile(entry, 'utf8')
const result = script.replace(
  /\[(['"`])__EMBED_CSS__\1\]/,
  JSON.stringify(css.map((name) => `assets/${name}`)),
)
assert(
  !result.includes('__EMBED_CSS__'),
  'Extracted stylesheet names were written to the editor entry',
)
await writeFile(entry, result)
