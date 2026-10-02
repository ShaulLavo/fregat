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
    const output = buildNative(desktopDir)
    expect(output).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(output!)).toBe(true)
  },
)
