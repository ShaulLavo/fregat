import { serializeComposerMention } from '@workspace/contracts'
import { expect, test } from '../../../../../test/fixtures'

import { withActiveFileMention } from '@/features/chat/utils/active-file-mention'

test('appends the active file as a mention once, and not at all without a chip', () => {
  const mention = serializeComposerMention('src/a.ts')

  expect(withActiveFileMention('fix it', 'src/a.ts')).toBe(`fix it\n\n${mention}`)
  expect(withActiveFileMention(`look at ${mention}`, 'src/a.ts')).toBe(`look at ${mention}`)
  expect(withActiveFileMention('fix it', null)).toBe('fix it')
})
