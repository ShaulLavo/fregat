import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readDevSources, sourcePaths, writeDevTypeConfig } from './dev-sources'

const sourceTest = test.extend<{ web: string }>({
  web: async ({ task }, provide) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `platform-dev-sources-${task.id}-`))
    writeFile(
      root,
      'package.json',
      JSON.stringify({ dependencies: { '@singapore-editor/core': '*' } }),
    )
    writeFile(
      root,
      'node_modules/@singapore-editor/core/package.json',
      JSON.stringify({
        exports: { '.': { import: './dist/index.js' }, './document': './dist/public/document.js' },
      }),
    )
    writeFile(root, 'node_modules/@singapore-editor/core/src/index.ts')
    writeFile(root, 'node_modules/@singapore-editor/core/src/public/document.ts')
    writeFile(root, 'node_modules/ghostty-webgpu/package.json', '{}')
    for (const file of [
      'src/index.ts',
      'src/xterm/terminal.ts',
      'src/xterm/css/xterm.css',
      'ghostty-vt.wasm',
      'bridge.wasm',
      'node_modules/@webgpu/types/dist/index.d.ts',
    ]) {
      writeFile(root, `node_modules/ghostty-webgpu/${file}`)
    }
    try {
      await provide(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  },
})

sourceTest(
  'maps nonliteral editor and Ghostty subpaths to source for runtime and types',
  ({ web }) => {
    const packages = readDevSources(web)
    const paths = sourcePaths(packages)
    expect(paths['@singapore-editor/core/document']).toEqual([
      path.join(web, 'node_modules/@singapore-editor/core/src/public/document.ts'),
    ])
    expect(paths['ghostty-webgpu/xterm.css']).toEqual([
      path.join(web, 'node_modules/ghostty-webgpu/src/xterm/css/xterm.css'),
    ])
    expect(paths['ghostty-webgpu/bridge.wasm']).toEqual([
      path.join(web, 'node_modules/ghostty-webgpu/bridge.wasm'),
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
  fs.unlinkSync(path.join(web, 'node_modules/@singapore-editor/core/src/public/document.ts'))
  writeFile(web, 'node_modules/@singapore-editor/core/dist/public/document.js')
  expect(() => readDevSources(web)).toThrow('Missing source for @singapore-editor/core/document')
})

sourceTest('identifies a missing linked checkout and a missing generated asset', ({ web }) => {
  const wasm = path.join(web, 'node_modules/ghostty-webgpu/bridge.wasm')
  fs.unlinkSync(wasm)
  expect(() => readDevSources(web)).toThrow(wasm)
  fs.rmSync(path.join(web, 'node_modules/ghostty-webgpu'), { recursive: true })
  expect(() => readDevSources(web)).toThrow('Run bun link')
})

function writeFile(root: string, relative: string, content = '') {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
