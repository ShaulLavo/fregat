import { PUNCTUATION_CODE_MAP } from '@tanstack/hotkeys'
import { expect, test } from 'vitest'
import { buildKeymapTrie, trieStep } from './trie'
import type { KeymapBinding } from './types'

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
    const event = {
      key: 'k',
      code: 'KeyK',
      altKey: !!(mask & 1),
      ctrlKey: !!(mask & 2),
      metaKey: !!(mask & 4),
      shiftKey: !!(mask & 8),
    }
    expect(trieStep(trie, event)?.node.candidates[0]?.payload).toBe(mask)
  }
  expect(
    trieStep(trie, {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    })?.node.candidates.map((binding) => binding.payload),
  ).toEqual([2, 99])
})

test.each(Object.entries(PUNCTUATION_CODE_MAP))(
  'preserves TanStack physical punctuation fallback for %s',
  (code, key) => {
    const trie = buildKeymapTrie([{ chord: [{ key, ctrl: true }], payload: key }], 'linux')
    const event = {
      key: 'Dead',
      code,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    }
    expect(trieStep(trie, event)?.node.candidates[0]?.payload).toBe(key)
  },
)

test('preserves physical Quote fallback when a non-Latin layout prints another character', () => {
  const trie = buildKeymapTrie([{ chord: [{ key: "'", ctrl: true }], payload: 'quote' }], 'linux')
  expect(
    trieStep(trie, {
      key: 'ת',
      code: 'Quote',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    })?.node.candidates[0]?.payload,
  ).toBe('quote')
})
