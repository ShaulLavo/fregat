import { describe, expect, it } from 'vitest'
import { EDITOR_COMMANDS } from '../src/editor/commandCatalog'
import { readonlyDiffPack } from '../src/keymap/presets'

describe('editor command catalog', () => {
  it('declares every command once', () => {
    const ids = EDITOR_COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('gives every command a title', () => {
    expect(EDITOR_COMMANDS.filter((command) => command.title.trim() === '')).toEqual([])
  })
  it('keeps mutations outside the readonly diff pack', () => {
    const mutations = new Set(
      EDITOR_COMMANDS.filter((command) => command.mutates).map((command) => command.id),
    )
    for (const platform of ['linux', 'mac', 'windows'] as const)
      expect(
        readonlyDiffPack[platform].filter((binding) => mutations.has(binding.command)),
      ).toEqual([])
  })
})
