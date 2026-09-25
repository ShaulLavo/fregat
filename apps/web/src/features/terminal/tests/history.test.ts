import { test, expect } from '../../../../test/fixtures'
import { onTestFinished } from 'vitest'
import { join } from 'node:path'
import { createOrchestrationFixture } from '../../../../../server/test/factories/orchestration'
import { createMetadataDatabase } from '../../../../../server/src/db/client'
import { migratePlatformDatabase } from '../../../../../server/src/db/migrations'
import { TerminalHistory } from '../../../../../server/src/terminal/history'

// SQLite is the persistence boundary; no simulated storage or PTY is involved here.
test('reopening the database retains raw bytes and clear affects only the selected owner', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const databasePath = join(fixture.root, 'metadata.sqlite')
  const history = new TerminalHistory(fixture.database, 'first')
  const bytes = Buffer.from([0xff, 0, 0xf0, 0x9f, 0x98, 0x80])
  history.append(bytes.subarray(0, 4))
  history.append(bytes.subarray(4))
  new TerminalHistory(fixture.database, 'second').append(Buffer.from('other owner'))
  const reopened = createMetadataDatabase({ databasePath })
  try {
    const restored = new TerminalHistory(reopened.db, 'first')
    expect(Buffer.concat(restored.values())).toEqual(bytes)
    restored.clear()
    expect(new TerminalHistory(reopened.db, 'first').values()).toEqual([])
    expect(Buffer.concat(new TerminalHistory(reopened.db, 'second').values()).toString()).toBe(
      'other owner',
    )
  } finally {
    reopened.close()
  }
})

test('retains the latest five thousand lines across append boundaries and database reload', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const history = new TerminalHistory(fixture.database, 'lines')
  const lines = Array.from({ length: 5_100 }, (_, index) => `line ${index}\n`)
  history.append(Buffer.from(lines.slice(0, 2_500).join('')))
  history.append(Buffer.from(lines.slice(2_500).join('')))
  const expected = lines.slice(-5_000).join('')
  expect(Buffer.concat(history.values()).toString()).toBe(expected)
  expect(Buffer.concat(new TerminalHistory(fixture.database, 'lines').values()).toString()).toBe(
    expected,
  )
  history.append(Buffer.from('partial last line'))
  expect(Buffer.concat(history.values()).toString()).toBe(
    lines.slice(-4_999).join('') + 'partial last line',
  )
})

test('a failed persistence transaction preserves the previously accepted replay', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const history = new TerminalHistory(fixture.database, 'failure')
  history.append(Buffer.from('accepted'))
  fixture.sqlite.run(
    "CREATE TRIGGER refuse_terminal_history BEFORE INSERT ON terminal_history_chunks BEGIN SELECT RAISE(ABORT, 'injected history failure'); END",
  )
  expect(() => history.append(Buffer.from('rejected'))).toThrow('injected history failure')
  expect(Buffer.concat(history.values()).toString()).toBe('accepted')
  expect(Buffer.concat(new TerminalHistory(fixture.database, 'failure').values()).toString()).toBe(
    'accepted',
  )
})

test('matches pinned terminal history for text split across byte and line boundaries', async () => {
  const { execFileSync } = await import('node:child_process')
  const reference = new URL('../../../../../../references/t3code', import.meta.url).pathname
  const source = execFileSync(
    'git',
    [
      '-C',
      reference,
      'show',
      '7445aa733ada33e45289e5aa5055f79142556513:apps/server/src/terminal/Manager.ts',
    ],
    { encoding: 'utf8' },
  )
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
  // The tests above cover disk durability; this matrix exercises trimming and decoding.
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  onTestFinished(() => database.close())
  migratePlatformDatabase(database.db)
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
