import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { buildNative } from '../../../scripts/build-native'

const supported = process.platform === 'linux'
const webkit =
  supported &&
  Bun.which('pkg-config') !== null &&
  Bun.spawnSync(['pkg-config', '--exists', 'webkit2gtk-4.1']).exitCode === 0
const compiler = Bun.which('cc') !== null
function skipReason() {
  if (!supported) return 'Linux host build requires Linux'
  if (!webkit) return 'webkit2gtk-4.1 development files are absent'
  return 'cc is absent'
}

test.skipIf(!webkit || !compiler)(
  `builds the Linux host (${webkit && compiler ? 'native dependencies present' : `skip reason: ${skipReason()}`})`,
  () => {
    const desktopDir = path.resolve(import.meta.dirname, '../../..')
    const output = buildNative(desktopDir, 'installed')
    expect(output).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(output!)).toBe(true)
  },
)

test.skipIf(!supported)(
  'default Electrobun native build needs no optional WebKit/compiler dependencies',
  () => {
    const script = path.resolve(import.meta.dirname, '../../../scripts/build-native.ts')
    const env = { ...process.env, PATH: '/nonexistent-native-build-tools' }
    const result = Bun.spawnSync([process.execPath, script], { env })
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe('')
    const installed = Bun.spawnSync([process.execPath, script, '--shell=installed'], { env })
    expect(installed.exitCode).not.toBe(0)
    expect(installed.stderr.toString()).toContain('desktop.native.BUILD_FAILED')
  },
)

test('default Electrobun and explicit installed-app entrypoints select their own native build', async () => {
  const desktop = path.resolve(import.meta.dirname, '../../..')
  const manifest = await Bun.file(path.join(desktop, 'package.json')).json()
  expect(manifest.scripts.dev).toBe(
    'bun run build:native && bun ../../scripts/run-with-env.ts electrobun dev',
  )
  expect(manifest.scripts.build).toBe('bun run build:native && electrobun build')
  expect(manifest.scripts['build:native']).toBe('bun scripts/build-native.ts')
  const dev = await Bun.file(path.resolve(desktop, '../../scripts/desktop-dev.ts')).text()
  expect(dev).toMatch(/'build:native',\s*'--shell=installed'/)
})

// NOT-PORTABLE: macOS case assumes Xcode clang and SDK without a prerequisite check.
test.skipIf(process.platform !== 'darwin')(
  'builds the macOS native host executable beside the retained Electrobun library',
  () => {
    const desktopDir = path.resolve(import.meta.dirname, '../../..')
    const host = buildNative(desktopDir, 'installed')
    expect(host).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(host!)).toBe(true)
    const library = buildNative(desktopDir, 'electrobun')
    expect(library).toBe(path.join(desktopDir, 'native/build/libVibrancy.dylib'))
    expect(existsSync(library!)).toBe(true)
  },
)
