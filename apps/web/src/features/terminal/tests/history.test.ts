import { test, expect } from '../../../../test/fixtures'
import { onTestFinished } from 'vitest'
import { join } from 'node:path'
import { createOrchestrationFixture } from '../../../../../server/test/factories/orchestration'
import { createMetadataDatabase } from '../../../../../server/src/db/client'
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
