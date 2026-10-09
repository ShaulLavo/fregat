import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'
import { buildNative, copyNativeHost } from '../../../scripts/build-native'
import { observeNativeBuild } from './native-build-observation'

const supported = process.platform === 'linux'
const webkit =
  supported &&
  Bun.which('pkg-config') !== null &&
  Bun.spawnSync(['pkg-config', '--exists', 'webkit2gtk-4.1']).exitCode === 0
const compiler = Bun.which('zig') !== null
function skipReason() {
  if (!supported) return 'Linux host build requires Linux'
  if (!webkit) return 'webkit2gtk-4.1 development files are absent'
  return 'Zig 0.17 is absent'
}

test.skipIf(!webkit || !compiler)(
  `builds the Linux host (${webkit && compiler ? 'native dependencies present' : `skip reason: ${skipReason()}`})`,
  () => {
    const desktopDir = path.resolve(import.meta.dirname, '../../..')
    const output = buildNative(desktopDir)
    expect(output).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(output!)).toBe(true)
    for (const options of [
      [],
      ['--data-dir'],
      ['--data-dir', 'relative'],
      ['--unknown'],
      [
        '--data-dir',
        path.join(tmpdir(), 'unused-native-options'),
        '--data-dir',
        path.join(tmpdir(), 'unused-native-options'),
      ],
      ['--data-dir', path.join(tmpdir(), 'unused-native-options'), '--vibrancy', '--vibrancy'],
      ['--vibrancy', '--data-dir', 'relative'],
    ]) {
      const result = Bun.spawnSync([output!, 'http://127.0.0.1', 'unused-script', ...options], {
        env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' },
      })
      expect(result.exitCode).toBe(2)
      expect(result.stderr.toString()).toContain('Native window options invalid')
    }
  },
  60_000,
)

test.skipIf(!supported)('default native build reports missing compiler dependencies', () => {
  const script = path.resolve(import.meta.dirname, '../../../scripts/build-native.ts')
  const env = { ...process.env, PATH: '/nonexistent-native-build-tools' }
  const result = Bun.spawnSync([process.execPath, script], { env })
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain('desktop.native.BUILD_FAILED')
})

test('desktop entrypoints build the native host and launch the installed app', async () => {
  const desktop = path.resolve(import.meta.dirname, '../../..')
  const manifest = await Bun.file(path.join(desktop, 'package.json')).json()
  expect(manifest.scripts.dev).toBe(
    'bun run build:native && bun ../../scripts/run-with-env.ts bun src/launcher/index.ts --dev',
  )
  expect(manifest.scripts.build).toBe('bun run build:native')
  expect(manifest.scripts['build:native']).toBe('bun scripts/build-native.ts')
  const dev = await Bun.file(path.resolve(desktop, '../../scripts/desktop-dev.ts')).text()
  expect(dev).toContain("'apps/desktop', 'build:native'")
  expect(dev).toContain("'apps/desktop/src/launcher/index.ts', '--dev'")
})

const macCompiler = process.platform === 'darwin' && Bun.which('swiftc') !== null
const macSdk =
  macCompiler &&
  Bun.which('xcrun') !== null &&
  Bun.spawnSync(['xcrun', '--sdk', 'macosx', '--show-sdk-path']).exitCode === 0

test.skipIf(!macSdk)(
  `builds the macOS native host (${macSdk ? 'Xcode SDK present' : 'skip reason: Swift 6 and macOS SDK required'})`,
  () => {
    observeNativeBuild((phase) => {
      const desktopDir = path.resolve(import.meta.dirname, '../../..')
      phase('build', 'before')
      const host = buildNative(desktopDir)
      phase('build', 'after')
      expect(host).toBe(
        path.join(desktopDir, 'native/build/Fregat Dev.app/Contents/MacOS/platform-webview'),
      )
      expect(existsSync(host!)).toBe(true)
      const contents = path.dirname(path.dirname(host!))
      const plist = Bun.spawnSync([
        'plutil',
        '-extract',
        'CFBundleName',
        'raw',
        path.join(contents, 'Info.plist'),
      ])
      expect(plist.exitCode).toBe(0)
      expect(new TextDecoder().decode(plist.stdout).trim()).toBe('Fregat Dev')
      expect(existsSync(path.join(contents, 'Resources/Fregat.icns'))).toBe(true)
      expect(existsSync(path.join(contents, 'Frameworks/libswift_Concurrency.dylib'))).toBe(true)
      const relocation = mkdtempSync(path.join(tmpdir(), 'native-relocation-'))
      try {
        const directory = path.join(relocation, 'server', 'native')
        mkdirSync(directory, { recursive: true })
        const relocated = path.join(directory, 'platform-webview')
        copyNativeHost(host!, relocated)
        expect(
          existsSync(path.join(relocation, 'server/Frameworks/libswift_Concurrency.dylib')),
        ).toBe(true)
        const invalid = Bun.spawnSync([relocated, 'http://127.0.0.1', 'unused-script'])
        expect(invalid.exitCode).toBe(2)
        expect(invalid.stderr.toString()).toContain('Native window options invalid')
      } finally {
        rmSync(relocation, { recursive: true, force: true })
      }
    })
  },
  30_000,
)
