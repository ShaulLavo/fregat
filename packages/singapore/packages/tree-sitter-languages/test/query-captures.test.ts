import { expect, it } from 'vitest'
import { mapQueryCaptures } from '../src/query-captures'

it('maps capture references without rewriting strings, comments or prototype properties', () => {
  const source =
    '; @escape is private documentation\n((identifier) @constructor (#match? @constructor "@escape"))\n(escape_sequence) @escape'
  expect(mapQueryCaptures(source, { escape: 'string.escape' })).toBe(
    '; @escape is private documentation\n((identifier) @constructor (#match? @constructor "@escape"))\n(escape_sequence) @string.escape',
  )
})
