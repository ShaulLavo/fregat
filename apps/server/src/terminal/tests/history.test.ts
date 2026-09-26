import { afterEach, expect, it } from 'vitest'
import { closeTestApps, createTestDatabase } from '../../../test/server'
import { initializePlatformDatabase } from '../../db/initialize'
import { TerminalHistory } from '../history'

afterEach(closeTestApps)

it('stores the host cursor across a replay gap and scrollback clear', () => {
  const { db } = createTestDatabase()
  initializePlatformDatabase(db)
  const history = new TerminalHistory(db, 'gap')
  history.append(Buffer.from('before'), 6)
  history.append(Buffer.from('Output lost while the server was down.'), 1_000)
  history.append(Buffer.from('tail'), 1_004)
  expect(new TerminalHistory(db, 'gap').offset).toBe(1_004)
  history.clear({ keepOffset: true })
  const resumed = new TerminalHistory(db, 'gap')
  expect(resumed.values()).toEqual([])
  expect(resumed.offset).toBe(1_004)
})

it('starts a replacement stream at zero while retaining earlier scrollback', () => {
  const { db } = createTestDatabase()
  initializePlatformDatabase(db)
  const history = new TerminalHistory(db, 'replacement')
  history.append(Buffer.from('earlier output'), 1_000)
  history.setOffset(0)
  expect(new TerminalHistory(db, 'replacement').offset).toBe(0)
  expect(Buffer.concat(history.values()).toString()).toBe('earlier output')
  history.append(Buffer.from('new output'), 10)
  expect(new TerminalHistory(db, 'replacement').offset).toBe(10)
})
