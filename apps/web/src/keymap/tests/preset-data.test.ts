import { createHash } from 'node:crypto'
import { expect, test } from '../../../test/fixtures'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { ours, zed, unmappedPresetBindings } from '@/keymap/presets/inventory'
import control from '@/keymap/tests/preset-control.json'
import { presetRuntimeSource } from '../../../scripts/generate-preset-runtime'
import { readFile } from 'node:fs/promises'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, canonical(field)]),
  )
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}

test('the full inventories retain the frozen pre-projection semantics', () => {
  expect(zed).toHaveLength(control.inventory.rows)
  expect(ours).toHaveLength(control.inventory.rows)
  expect(digest(zed)).toBe(control.inventory.zed)
  expect(digest(ours)).toBe(control.inventory.ours)
})

test('every preset, platform and shell-key mode keeps its exact binding objects and reports', () => {
  for (const platform of ['linux', 'mac', 'windows'] as const) {
    verifyPlatform(platform)
  }
})

function verifyPlatform(platform: 'linux' | 'mac' | 'windows') {
  for (const preset of ['ours', 'zed', 'vscode'] as const) {
    for (const shellKeys of [false, true]) verifyPreset(platform, preset, shellKeys)
  }
}

function verifyPreset(
  platform: Parameters<typeof defaultPlatformKeyBindings>[0],
  preset: Parameters<typeof defaultPlatformKeyBindings>[1],
  shellKeys: boolean,
) {
  const frozen = control.bindings.find(
    (row) => row.platform === platform && row.preset === preset && row.shellKeys === shellKeys,
  )
  const bindings = defaultPlatformKeyBindings(platform, preset, shellKeys)
  expect(bindings.length).toBe(frozen?.count)
  expect(digest(bindings)).toBe(frozen?.bindings)
  expect(digest(unmappedPresetBindings(platform ?? 'linux', preset ?? 'ours'))).toBe(
    frozen?.unmapped,
  )
}

test('the checked-in runtime projection matches the guarded authoritative inventory', async () => {
  const source = await readFile(new URL('../presets/runtime.ts', import.meta.url), 'utf8')
  expect(source).toBe(await presetRuntimeSource())
})
