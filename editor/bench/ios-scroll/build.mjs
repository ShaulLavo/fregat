import { readFile, access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? resolve(root, 'dist'))
const alias = []
for (const folder of ['editor', 'textbuffer', 'gutters', '../../hotkeys/packages/hotkeys']) {
  const directory = resolve(root, '../../packages', folder)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  for (const [key, target] of Object.entries(manifest.exports)) {
    const runtime = typeof target === 'string' ? target : target.import
    if (!runtime?.startsWith('./dist/')) continue
    let source = runtime.replace('./dist/', './src/').replace(/\.js$/, '.ts')
    if (source.endsWith('.ts') && !source.includes('*')) {
      try {
        await access(resolve(directory, source))
      } catch {
        source += 'x'
      }
    }
    alias.push({
      find: new RegExp(
        '^' +
          (manifest.name + (key === '.' ? '' : key.slice(1)))
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace('\\*', '(.*)') +
          '$',
      ),
      replacement: resolve(directory, source.replace('*', '$1')),
    })
  }
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
await build({
  root,
  configFile: false,
  base: './',
  publicDir: false,
  resolve: { alias: alias.sort((a, b) => b.find.source.length - a.find.source.length) },
  define: { __PROBE_COMMIT__: JSON.stringify(commit) },
  plugins: [
    {
      name: 'probe-overscan',
      transform(code, id) {
        if (!id.endsWith('/virtualizedTextViewHelpers.ts')) return
        if (!code.includes('export const DEFAULT_OVERSCAN = 12'))
          throw new TypeError(
            'Review the probe overscan override against the current editor source',
          )
        return code.replace(
          'export const DEFAULT_OVERSCAN = 12',
          'export const DEFAULT_OVERSCAN = [12, 48, 120].find(value => value === Number(new URLSearchParams(location.search).get("overscan"))) ?? 12',
        )
      },
    },
  ],
  build: { outDir, emptyOutDir: true, target: 'es2022' },
})
await mkdir(outDir, { recursive: true })
await writeFile(
  resolve(outDir, 'build.json'),
  JSON.stringify({ commit, builtAt: new Date().toISOString(), overscanOverride: true }, null, 2),
)
await writeFile(resolve(outDir, 'server.mjs'), await readFile(resolve(root, 'server.mjs')))
console.log(outDir)
