import { expect, test } from '../../../test/fixtures'

import { selectionPrompt } from '@/keymap/utils/selection-prompt'

test('quotes each selection under its path and one-based lines, fenced by extension', () => {
  expect(
    selectionPrompt('src/a.ts', [
      { startLine: 3, endLine: 3, text: 'const a = 1' },
      { startLine: 10, endLine: 12, text: 'if (a) {\n  b()\n}' },
    ]),
  ).toBe(
    [
      'About `src/a.ts`, line 3:',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      'About `src/a.ts`, lines 10–12:',
      '',
      '```ts',
      'if (a) {',
      '  b()',
      '}',
      '```',
    ].join('\n'),
  )
})

test('a fence inside the selection gets a longer outer fence, and a bare name gets no language', () => {
  expect(selectionPrompt('Makefile', [{ startLine: 1, endLine: 1, text: '```' }])).toBe(
    ['About `Makefile`, line 1:', '', '````', '```', '````'].join('\n'),
  )
})
