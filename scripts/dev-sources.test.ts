import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import { readDevSources, sourcePaths, writeDevTypeConfig } from './dev-sources'

const sourceTest = test.extend<{ web: string }>({
  web: async ({ task }, provide) => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), `platform-dev-sources-${task.id}-`)),
    )
    const root = path.join(directory, 'apps/web')
    writeFile(root, '.git', 'gitdir: ../repository/worktrees/fixture\n')
    writeFile(
      root,
      'package.json',
      JSON.stringify({ dependencies: { '@singapore-editor/core': '*' } }),
    )
    writeFile(
      root,
      'checkouts/singapore/packages/core/package.json',
      JSON.stringify({
        exports: { '.': { import: './dist/index.js' }, './document': './dist/public/document.js' },
      }),
    )
    writeFile(root, 'checkouts/singapore/packages/core/src/index.ts')
    writeFile(root, 'checkouts/singapore/packages/core/src/public/document.ts')
    writeFile(
      root,
      'checkouts/hotkeys/packages/hotkeys/package.json',
      JSON.stringify({ exports: { '.': { import: './dist/index.js' } } }),
    )
    writeFile(root, 'checkouts/hotkeys/packages/hotkeys/src/index.ts')
    writeFile(root, 'checkouts/ghostty-webgpu/package.json', '{}')
    for (const file of [
      'src/index.ts',
      'ghostty-vt.wasm',
      'bridge.wasm',
      'node_modules/@webgpu/types/dist/index.d.ts',
    ]) {
      writeFile(root, `checkouts/ghostty-webgpu/${file}`)
    }
    for (const [name, relative] of [
      ['@singapore-editor/core', 'checkouts/singapore/packages/core'],
      ['@fregat/hotkeys', 'checkouts/hotkeys/packages/hotkeys'],
      ['ghostty-webgpu', 'checkouts/ghostty-webgpu'],
    ]) {
      writeFile(root, `${relative.split('/packages/')[0]}/.git`, 'gitdir: ../../repository\n')
      const link = path.join(root, 'node_modules', name)
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(path.join(root, relative), link, 'junction')
    }
    const hotkeysGit = path.join(root, 'checkouts/hotkeys/.git')
    fs.unlinkSync(hotkeysGit)
    fs.mkdirSync(hotkeysGit)
    try {
      await provide(root)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  },
})

sourceTest(
  'maps nonliteral editor and Ghostty subpaths to source for runtime and types',
  ({ web }) => {
    const packages = readDevSources(web)
    const paths = sourcePaths(packages)
    expect(packages.map((pkg) => pkg.checkout)).toEqual([
      path.join(web, 'checkouts/singapore'),
      path.join(web, 'checkouts/hotkeys'),
      path.join(web, 'checkouts/ghostty-webgpu'),
    ])
    expect(paths['@fregat/hotkeys']).toEqual([
      path.join(web, 'checkouts/hotkeys/packages/hotkeys/src/index.ts'),
    ])
    expect(paths['@singapore-editor/core/document']).toEqual([
      path.join(web, 'checkouts/singapore/packages/core/src/public/document.ts'),
    ])
    expect(paths['ghostty-webgpu']).toEqual([
      path.join(web, 'checkouts/ghostty-webgpu/src/index.ts'),
    ])
    expect(paths['ghostty-webgpu/bridge.wasm']).toEqual([
      path.join(web, 'checkouts/ghostty-webgpu/bridge.wasm'),
    ])
    const configFile = writeDevTypeConfig(web, packages)
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    expect(config.compilerOptions.paths).toMatchObject(paths)
    const modified = fs.statSync(configFile).mtimeMs
    writeDevTypeConfig(web, packages)
    expect(fs.statSync(configFile).mtimeMs).toBe(modified)
  },
)

sourceTest('refuses a partial editor source checkout even when built exports exist', ({ web }) => {
  fs.unlinkSync(path.join(web, 'checkouts/singapore/packages/core/src/public/document.ts'))
  writeFile(web, 'checkouts/singapore/packages/core/dist/public/document.js')
  expect(() => readDevSources(web)).toThrow('Missing source for @singapore-editor/core/document')
})

sourceTest('identifies a missing workspace package and a missing generated asset', ({ web }) => {
  const wasm = path.join(web, 'checkouts/ghostty-webgpu/bridge.wasm')
  fs.unlinkSync(wasm)
  expect(() => readDevSources(web)).toThrow(wasm)
  fs.rmSync(path.join(web, 'node_modules/ghostty-webgpu'), { recursive: true })
  expect(() => readDevSources(web)).toThrow('Run bun install at the repository root.')
})

sourceTest('leaves Bun-only editor exports out of browser aliases', ({ web }) => {
  const file = path.join(web, 'checkouts/singapore/packages/core/package.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  manifest.exports['./server'] = { types: './server/signaling.ts', bun: './server/signaling.ts' }
  fs.writeFileSync(file, JSON.stringify(manifest))
  const paths = sourcePaths(readDevSources(web))
  expect(paths['@singapore-editor/core']).toBeDefined()
  expect(paths['@singapore-editor/core/server']).toBeUndefined()
})

sourceTest.for(['isolated', 'hoisted'])(
  'restores installed exports after local source development with %s dependencies',
  (layout, { web }) => {
    const modules =
      layout === 'hoisted'
        ? path.resolve(web, '../../node_modules')
        : path.join(web, 'node_modules')
    if (layout === 'hoisted') fs.renameSync(path.join(web, 'node_modules'), modules)
    const local = readDevSources(web)
    expect(local.map((pkg) => pkg.name)).toEqual([
      '@singapore-editor/core',
      '@fregat/hotkeys',
      'ghostty-webgpu',
    ])
    expect(sourcePaths(local)['@fregat/hotkeys']).toEqual([
      path.join(web, 'checkouts/hotkeys/packages/hotkeys/src/index.ts'),
    ])
    writeDevTypeConfig(web, local)
    for (const name of ['@singapore-editor/core', '@fregat/hotkeys', 'ghostty-webgpu']) {
      const link = path.join(modules, name)
      fs.unlinkSync(link)
      writeFile(
        link,
        'package.json',
        JSON.stringify({
          exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        }),
      )
      writeFile(link, 'dist/index.js')
      writeFile(link, 'dist/index.d.ts')
      const require = createRequire(path.join(web, 'package.json'))
      expect(require.resolve(name)).toBe(path.join(link, 'dist/index.js'))
    }
    // A release may include source without selecting source development.
    writeFile(modules, '@singapore-editor/core/src/index.ts')
    fs.rmSync(path.join(web, 'checkouts'), { recursive: true })
    expect(readDevSources(web)).toEqual([])
    const configFile = writeDevTypeConfig(web, [])
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    expect(config.files).toEqual([])
    expect(Object.keys(config.compilerOptions.paths)).toEqual(['@/*', '@workspace/ui/*'])
  },
)

sourceTest('keeps an external installed cache on package exports', ({ web }) => {
  fs.unlinkSync(path.join(web, '.git'))
  for (const directory of ['singapore', 'hotkeys', 'ghostty-webgpu']) {
    fs.rmSync(path.join(web, 'checkouts', directory, '.git'), { recursive: true })
  }
  expect(readDevSources(web)).toEqual([])
})

sourceTest('ignores installed caches inside the consumer Git tree', ({ web }) => {
  const cache = path.join(web, '.bun/install/cache')
  const packages = [
    ['@singapore-editor/core', 'singapore', { exports: { '.': { import: './dist/index.js' } } }],
    ['@fregat/hotkeys', 'hotkeys', { exports: { '.': { import: './dist/index.js' } } }],
    ['ghostty-webgpu', 'ghostty', {}],
  ] as const
  for (const [name, directory, manifest] of packages) {
    const target = path.join(cache, directory)
    writeFile(target, 'package.json', JSON.stringify(manifest))
    writeFile(target, 'src/index.ts')
    if (name === 'ghostty-webgpu') {
      writeFile(target, 'ghostty-vt.wasm')
      writeFile(target, 'bridge.wasm')
    }
    const link = path.join(web, 'node_modules', name)
    fs.rmSync(link, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link, 'junction')
  }
  expect(readDevSources(web)).toEqual([])
})

sourceTest('maps a local editor alongside installed hotkeys and Ghostty packages', ({ web }) => {
  for (const name of ['@fregat/hotkeys', 'ghostty-webgpu']) {
    fs.unlinkSync(path.join(web, 'node_modules', name))
    writeFile(web, `node_modules/${name}/package.json`, '{}')
  }
  const packages = readDevSources(web)
  expect(packages.map((pkg) => pkg.name)).toEqual(['@singapore-editor/core'])
  expect(sourcePaths(packages)['@singapore-editor/core/document']).toBeDefined()
  const config = JSON.parse(fs.readFileSync(writeDevTypeConfig(web, packages), 'utf8'))
  expect(config.files).toEqual([])
})

function writeFile(root: string, relative: string, content = '') {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
