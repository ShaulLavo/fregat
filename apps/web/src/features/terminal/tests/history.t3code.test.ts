import { test, expect } from '../../../../test/fixtures'
import { onTestFinished } from 'vitest'
import { createMetadataDatabase } from '../../../../../server/src/db/client'
import { initializePlatformDatabase } from '../../../../../server/src/db/initialize'
import { TerminalHistory } from '../../../../../server/src/terminal/history'
import {
  pinnedT3codeSource,
  requireT3codeReference,
} from '../../../../../server/src/testing/t3code-reference'

test('matches pinned terminal history for text split across byte and line boundaries', async ({
  skip,
}) => {
  requireT3codeReference(skip)
  const source = pinnedT3codeSource('apps/server/src/terminal/Manager.ts')
  const classSource = source.slice(
    source.indexOf('export class BoundedTerminalHistory'),
    source.indexOf('\nfunction isCsiFinalByte'),
  )
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    'const DEFAULT_HISTORY_BYTE_LIMIT=8*1024*1024; const MAX_HISTORY_CHUNK_LENGTH=16*1024;\n' +
      classSource,
  )
  const upstream = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  )
  // First-party history tests cover disk durability; this matrix exercises trimming and decoding.
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  onTestFinished(() => database.close())
  initializePlatformDatabase(database.db)
  const inputs = [1, 4_999, 5_000, 5_001, 6_001].flatMap((count) =>
    ['plain\n', 'λ😀\r\n', '\n', 'unterminated'].map((text) => text.repeat(count)),
  )
  for (const [index, input] of inputs.entries()) {
    const expected = new upstream.BoundedTerminalHistory(5_000, '')
    const actual = new TerminalHistory(database.db, `oracle-${index}`)
    for (let offset = 0; offset < input.length; offset += 1_003)
      expected.append(input.slice(offset, offset + 1_003))
    const bytes = Buffer.from(input)
    for (let offset = 0; offset < bytes.length; offset += 997)
      actual.append(bytes.subarray(offset, offset + 997))
    expect(Buffer.concat(actual.values()).toString()).toBe(expected.value())
  }
  expect(inputs).toHaveLength(20)
})
