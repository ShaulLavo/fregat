import { beforeAll, expect, test } from 'vitest'
import { micromark } from 'micromark'
import { gfmHtml } from 'micromark-extension-gfm'

import { MIXED_DELIMITER_SOURCES } from '../../../test/fixtures/mixed-delimiters'
import { canonicalMarkdownOutput, expectedOutput } from '../../../test/reference/oracle'
import { createRemarkProcessor } from '../processor'
import { initializeTreeSitterMarkdown, parseTreeSitterMarkdown } from '../tree-sitter-session'

const processor = createRemarkProcessor().freeze()
const options = {
  extensions: processor.data('micromarkExtensions'),
  htmlExtensions: [gfmHtml()],
}

beforeAll(async () => {
  await initializeTreeSitterMarkdown()
})

test.each(MIXED_DELIMITER_SOURCES)('%s matches the configured micromark renderer', (source) => {
  const expected = expectedOutput(micromark(source, options))
  for (const math of [false, true]) {
    const actual = parseTreeSitterMarkdown(source, { gfm: true, cjk: true, math })
    expect(canonicalMarkdownOutput(actual)).toEqual(expected)
  }
})
