import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KnipConfig } from 'knip'

type WorkspaceConfig = { entry: string[]; project: string[] }

// Entries outside each package's exports map: workers are loaded by URL, benches and type tests run
// directly.
const extraEntries: Record<string, string[]> = {
  editor: ['src/**/*.worker.ts', 'bench/**/*.ts', 'test/types/**/*.ts'],
  find: ['bench/**/*.ts'],
  minimap: ['src/**/*.worker.ts', 'bench/**/*.ts'],
  spellcheck: ['src/**/*.worker.ts', 'bench/**/*.ts'],
  'tree-sitter': ['src/**/*.worker.ts', 'bench/**/*.ts'],
  'typescript-lsp': ['src/**/*.worker.ts', 'bench/**/*.ts'],
}

// build-package.ts compiles src/X.ts(x) to dist/X.js, so each exports target names its source.
// Knip needs a tsconfig `outDir` to map these itself, and packages whose tests import sibling
// sources can't take one (TS infers rootDir from it).
function exportEntries(dir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const targets = new Set<string>()
  collectTargets(manifest.exports, targets)
  return [...targets].map((target) => {
    const base = target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '')
    return existsSync(join(dir, `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`
  })
}

function collectTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/') && value.endsWith('.js')) targets.add(value)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const nested of Object.values(value)) collectTargets(nested, targets)
}

function hasTypeScript(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).some((file) =>
    /\.tsx?$/.test(file),
  )
}

function packageWorkspace(name: string): WorkspaceConfig {
  const dir = join('packages', name)
  const project = ['src/**/*.{ts,tsx}']
  if (hasTypeScript(join(dir, 'test'))) project.push('test/**/*.{ts,tsx}')
  if (hasTypeScript(join(dir, 'bench'))) project.push('bench/**/*.ts')
  return { entry: [...exportEntries(dir), ...(extraEntries[name] ?? [])], project }
}

const packages = readdirSync('packages', { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join('packages', entry.name, 'package.json')),
  )
  .map((entry) => entry.name)

const config: KnipConfig = {
  ignore: ['**/*.d.css.ts'],
  // Real dependencies knip can't see statically:
  //   @tree-sitter-grammars/tree-sitter-markdown  grammar source compiled by build:markdown-wasm
  //   tree-sitter-cli                             the `tree-sitter` binary that script spawns
  //   @playwright/test                            required by @vitest/browser's playwright provider
  ignoreDependencies: [
    '@tree-sitter-grammars/tree-sitter-markdown',
    'tree-sitter-cli',
    '@playwright/test',
  ],
  // taskset (util-linux) pins CPU affinity in examples/stress/fallback-experiment.mjs.
  ignoreBinaries: ['taskset'],
  workspaces: {
    '.': {
      entry: ['scripts/*.{ts,mjs}'],
      project: ['scripts/**/*.{ts,mjs}'],
    },
    ...Object.fromEntries(packages.map((name) => [`packages/${name}`, packageWorkspace(name)])),
    // Top-level scripts run directly (`node x.mjs`). Knip reads only Vite's index.html, so each
    // other page's module script is listed: boundary, consumers, copies, first-paint, geometry.
    'examples/stress': {
      entry: [
        'index.html',
        'src/{boundary,consumers,copies,firstPaint,geometry}.ts',
        '*.mjs',
        'test/*.mjs',
      ],
      project: ['src/**/*.ts', '*.mjs'],
    },
    // jump-history.html loads src/jumpHistoryDemo.ts.
    'examples/app': {
      entry: ['index.html', 'src/jumpHistoryDemo.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
  },
}

export default config
