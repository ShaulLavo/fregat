import { expect, test } from 'vitest'
import * as packs from '../src/keymap/presets'
import * as keymap from '@singapore-editor/core/keymap'

test('the public keymap entry exposes named data and command metadata', () => {
  expect(keymap.markdownPack).toEqual(packs.markdownPack)
  expect(keymap.vscodeEditingPack).toEqual(packs.vscodeEditingPack)
  expect(keymap.defaultEditorPacks).not.toContainEqual(keymap.markdownPack)
  expect(keymap).not.toHaveProperty('createKeymapRuntime')
  expect(keymap).not.toHaveProperty('buildKeymapTrie')
})
for (const [name, pack] of Object.entries(packs)) {
  if (!pack || typeof pack !== 'object' || !('linux' in pack)) continue
  test(`${name} carries an explicit predicate for every row`, () => {
    for (const platform of ['linux', 'mac', 'windows'] as const)
      expect(pack[platform].every((binding) => Boolean(binding.context))).toBe(true)
    expect(pack).toMatchSnapshot(name)
  })
}
