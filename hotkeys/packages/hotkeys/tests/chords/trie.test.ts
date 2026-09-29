import { expect, test } from 'vitest'
import { PUNCTUATION_CODE_MAP, buildKeymapTrie, createKeyInput, trieStep } from '../../src'
import type { KeymapBinding } from '../../src'

function stroke(key: string, code: string, mask: number, altGraph = false) {
  return createKeyInput({
    key,
    code,
    modifiers: {
      alt: !!(mask & 1),
      ctrl: !!(mask & 2),
      meta: !!(mask & 4),
      shift: !!(mask & 8),
      altGraph,
    },
  })
}

test('indexes each modifier combination independently without losing ordered terminals', () => {
  const bindings: KeymapBinding<number>[] = []
  for (let mask = 0; mask < 16; mask += 1) {
    bindings.push({
      chord: [
        {
          key: 'K',
          alt: !!(mask & 1),
          ctrl: !!(mask & 2),
          meta: !!(mask & 4),
          shift: !!(mask & 8),
        },
      ],
      payload: mask,
    })
  }
  bindings.push({ chord: [{ key: 'K', ctrl: true }], payload: 99 })
  const trie = buildKeymapTrie(bindings, 'linux')
  for (let mask = 0; mask < 16; mask += 1) {
    expect(trieStep(trie, stroke('k', 'KeyK', mask))?.node.candidates[0]?.payload).toBe(mask)
  }
  expect(
    trieStep(trie, stroke('k', 'KeyK', 2))?.node.candidates.map((binding) => binding.payload),
  ).toEqual([2, 99])
})

test.each(Object.entries(PUNCTUATION_CODE_MAP))(
  'preserves the physical punctuation fallback for %s',
  (code, key) => {
    const trie = buildKeymapTrie([{ chord: [{ key, ctrl: true }], payload: key }], 'linux')
    expect(trieStep(trie, stroke('Dead', code, 2))?.node.candidates[0]?.payload).toBe(key)
  },
)

test('preserves physical Quote fallback when a non-Latin layout prints another character', () => {
  const trie = buildKeymapTrie([{ chord: [{ key: "'", ctrl: true }], payload: 'quote' }], 'linux')
  expect(trieStep(trie, stroke('ת', 'Quote', 2))?.node.candidates[0]?.payload).toBe('quote')
})

test('a Latin layout owns its printed letters', () => {
  const trie = buildKeymapTrie([{ chord: ['Control+W'], payload: 'w' }], 'linux')
  expect(trieStep(trie, stroke('z', 'KeyW', 2))).toBeNull()
  expect(trieStep(trie, stroke('ц', 'KeyW', 2))?.node.candidates[0]?.payload).toBe('w')
})

test('AltGraph input matches the produced glyph, never a Control+Alt binding', () => {
  const trie = buildKeymapTrie(
    [
      { chord: ['Control+Alt+Q'], payload: 'ctrl-alt-q' },
      { chord: [{ key: '@' }], payload: 'at' },
    ],
    'windows',
  )
  expect(trieStep(trie, stroke('@', 'KeyQ', 3, true))?.node.candidates[0]?.payload).toBe('at')
  expect(trieStep(trie, stroke('q', 'KeyQ', 3))?.node.candidates[0]?.payload).toBe('ctrl-alt-q')
})

test('stores each stroke under its normalized label and counts descendants per prefix', () => {
  const trie = buildKeymapTrie(
    [
      { chord: ['Mod+K', 'Mod+C'], payload: 'comment' },
      { chord: ['Mod+K', 'Mod+U'], payload: 'uncomment' },
    ],
    'mac',
  )
  const edge = trieStep(trie, stroke('k', 'KeyK', 4))
  expect(edge?.keys).toBe('Mod+K')
  expect(edge?.node.candidates).toEqual([])
  expect(edge?.node.descendants.map((binding) => binding.payload)).toEqual(['comment', 'uncomment'])
})
