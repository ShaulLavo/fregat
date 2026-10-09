import { expect, test } from 'vitest'
import { formatSessionTitleContext } from '../title-context'
import { titleMessages } from '../../../test/factories/title-context'
import { pinnedT3codeSource, requireT3codeReference } from '../../testing/t3code-reference'

test('matches actual pinned context algorithm for 144 bounded conversations', async ({ skip }) => {
  requireT3codeReference(skip)
  const source = pinnedT3codeSource('apps/server/src/textGeneration/ThreadTitleContext.ts')
  // This corpus has no citation links; citation validation has separate boundary cases below.
  const plainSource = source.replace(
    'import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";',
    'const assistantCitationsToPlainText = (text: string) => text;',
  )
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(plainSource)
  const upstream = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  )
  for (let count = 0; count < 24; count++) {
    for (const length of [0, 1, 100, 1_999, 2_001, 10_000]) {
      const input = titleMessages(count, length)
      expect(formatSessionTitleContext(input)).toEqual(upstream.formatThreadTitleContext(input))
    }
  }
})
