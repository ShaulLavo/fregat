import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfig } from 'vite'
import { hashBenchmarkSource, loadCorePackage } from '../core-package.mjs'

let directory
let coreDirectory
const exports = {
  '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  './logging': { import: './dist/logging/index.js' },
  './logging/evlog': { default: './dist/logging/evlog.js' },
  './style.css': './dist/style.css',
}

async function put(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'editor-stress-core-test-'))
  coreDirectory = resolve(directory, 'packages/editor')
  await put(
    resolve(coreDirectory, 'package.json'),
    JSON.stringify({ name: '@singapore-editor/core', exports }),
  )
  await put(resolve(coreDirectory, 'src/index.ts'), 'export const selected = 1\n')
  for (const path of ['index.js', 'logging/index.js', 'logging/evlog.js', 'style.css'])
    await put(resolve(coreDirectory, 'dist', path), '')
})

afterEach(async () => {
  if (!directory) return
  await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('benchmark core package selection', () => {
  it('resolves every export through Vite with nested exports before their parents', async () => {
    const core = await loadCorePackage(coreDirectory)
    const config = await resolveConfig(
      { root: directory, configFile: false, envFile: false, resolve: { alias: core.aliases } },
      'build',
    )
    const resolveImport = config.createResolver()
    const expected = {
      '@singapore-editor/core': 'index.js',
      '@singapore-editor/core/logging': 'logging/index.js',
      '@singapore-editor/core/logging/evlog': 'logging/evlog.js',
      '@singapore-editor/core/style.css': 'style.css',
    }
    for (const [specifier, path] of Object.entries(expected))
      expect(await resolveImport(specifier)).toBe(resolve(coreDirectory, 'dist', path))
    expect(core.sourceDirectory).toBe(resolve(coreDirectory, 'src'))
    expect(core.aliases.map((alias) => alias.find)).toEqual([
      '@singapore-editor/core/logging/evlog',
      '@singapore-editor/core/style.css',
      '@singapore-editor/core/logging',
      '@singapore-editor/core',
    ])
  })

  it.each(['src', 'dist', 'package.json', 'dist/logging/evlog.js'])(
    'rejects missing %s before the benchmark',
    async (path) => {
      await rm(resolve(coreDirectory, path), { recursive: true, force: true })
      await expect(loadCorePackage(coreDirectory)).rejects.toThrow(/requires an existing/)
    },
  )

  it.each([
    ['another package', { name: '@singapore-editor/other', exports }],
    ['source export', { name: '@singapore-editor/core', exports: { '.': './src/index.ts' } }],
    [
      'escaping export',
      { name: '@singapore-editor/core', exports: { '.': './dist/../src/index.ts' } },
    ],
  ])('rejects %s', async (_label, manifest) => {
    await put(resolve(coreDirectory, 'package.json'), JSON.stringify(manifest))
    await expect(loadCorePackage(coreDirectory)).rejects.toThrow(/Core (package|export)/)
  })
})

describe('benchmark source identity', () => {
  it('keeps canonical paths and existing extensions, exclusions, ordering, and deduplication', async () => {
    const content = {
      'packages/editor/src/index.ts': 'export const selected = 1\n',
      'packages/editor/src/Z.ts': 'uppercase first',
      'packages/editor/src/a.test.ts': 'colocated tests were included',
      'packages/editor/src/a.ts': 'lowercase later',
      'packages/editor/src/a.css': 'css',
      'packages/editor/src/a.html': 'html',
      'packages/editor/bench/case.ts': 'non-src core files stay active',
      'packages/other/src/index.ts': 'other package',
      'examples/stress/run.mjs': 'runner',
    }
    const excluded = {
      'packages/editor/src/ignored.json': 'ignored extension',
      'packages/editor/src/test/case.ts': 'test directory',
      'examples/stress/test/case.mjs': 'runner tests',
      'examples/stress/results/example.mjs': 'saved results',
    }
    for (const [path, text] of Object.entries({ ...content, ...excluded }))
      await put(resolve(directory, path), text)
    const expected = createHash('sha256')
    for (const path of Object.keys(content).sort()) expected.update(path).update(content[path])
    const files = [...Object.keys(content), ...Object.keys(excluded), ...Object.keys(content)]
    const frozenSource = resolve(directory, 'frozen/src')
    await cp(resolve(coreDirectory, 'src'), frozenSource, { recursive: true })
    expect(await hashBenchmarkSource(directory, files, frozenSource)).toBe(expected.digest('hex'))
  })

  it('enumerates the selected source tree independently of active checkout files', async () => {
    const frozenSource = resolve(directory, 'frozen/src')
    await cp(resolve(coreDirectory, 'src'), frozenSource, { recursive: true })
    const files = ['packages/editor/src/index.ts', 'packages/other/src/index.ts']
    await put(resolve(directory, files[1]), 'other package')
    const original = await hashBenchmarkSource(directory, files, frozenSource)
    expect(await hashBenchmarkSource(directory, files, resolve(coreDirectory, 'src'))).toBe(
      original,
    )

    await rm(resolve(coreDirectory, 'src/index.ts'))
    await put(resolve(coreDirectory, 'src/active-only.ts'), 'active addition')
    files.push('packages/editor/src/active-only.ts')
    expect(await hashBenchmarkSource(directory, files, frozenSource)).toBe(original)
    expect(await hashBenchmarkSource(directory, files, resolve(coreDirectory, 'src'))).not.toBe(
      original,
    )

    await put(resolve(frozenSource, 'selected-only.ts'), 'frozen addition absent from git list')
    const selectedAddition = await hashBenchmarkSource(directory, files, frozenSource)
    expect(selectedAddition).not.toBe(original)
    await put(resolve(frozenSource, 'index.ts'), 'frozen edit')
    const selectedEdit = await hashBenchmarkSource(directory, files, frozenSource)
    expect(selectedEdit).not.toBe(selectedAddition)
    await put(resolve(directory, files[1]), 'other package edit')
    expect(await hashBenchmarkSource(directory, files, frozenSource)).not.toBe(selectedEdit)
  })
})
