import { afterEach, describe, expect, it } from 'vitest'
import { TerminalSession } from '../session.js'

const sessions: TerminalSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
})

async function createSession(): Promise<TerminalSession> {
  const session = await TerminalSession.create({
    appearance: {
      grid: { columns: 6, rows: 3, cellWidth: 10, cellHeight: 20, pixelRatio: 1 },
    },
  })
  sessions.push(session)
  return session
}

describe('native text measurement and live geometry', () => {
  it('uses native grapheme units and UTF16 ranges when mode2027 is enabled', async () => {
    const session = await createSession()
    session.write('\x1b[?2027h')
    const result = session.measureTexts(['👩‍💻中é✈️', ''])
    expect(result.geometry.graphemeClustering).toBe(true)
    expect(result.texts).toEqual([
      {
        cells: 7,
        units: [
          { start: 0, end: 5, cells: 2 },
          { start: 5, end: 6, cells: 2 },
          { start: 6, end: 8, cells: 1 },
          { start: 8, end: 10, cells: 2 },
        ],
      },
      { cells: 0, units: [] },
    ])
    expect(session.measure('👩‍💻中é✈️')).toBe(7)
  })

  it('switches to native codepoint printing units when mode2027 is disabled', async () => {
    const session = await createSession()
    session.write('\x1b[?2027l')
    expect(session.measureTexts(['👩‍💻é✈️']).texts[0]).toEqual({
      cells: 6,
      units: [
        { start: 0, end: 2, cells: 2 },
        { start: 2, end: 3, cells: 0 },
        { start: 3, end: 5, cells: 2 },
        { start: 5, end: 6, cells: 1 },
        { start: 6, end: 7, cells: 0 },
        { start: 7, end: 8, cells: 1 },
        { start: 8, end: 9, cells: 0 },
      ],
    })
  })

  it('reads the current native cursor, wrap modes and scroll state before a frame paints', async () => {
    const session = await createSession()
    session.write('abcdef')
    const first = session.geometry()
    expect(first).toMatchObject({
      columns: 6,
      rows: 3,
      cellWidth: 10,
      cellHeight: 20,
      cursor: { x: 5, y: 0, pendingWrap: true },
      autowrap: true,
      revision: session.revision,
    })
    session.write('\x1b[?7l\r\n\r\n\r\nX')
    const current = session.geometry()
    expect(current.autowrap).toBe(false)
    expect(current.cursor).toMatchObject({ x: 1, y: 2, pendingWrap: false })
    expect(current.scrollbar.total).toBeGreaterThan(first.scrollbar.total)
    expect(first.cursor).toMatchObject({ x: 5, y: 0, pendingWrap: true })
    expect(Object.isFrozen(current.cursor)).toBe(true)
    expect(Object.isFrozen(current.scrollbar)).toBe(true)
  })

  it('samples a colored prompt before reentrant observers write more output', async () => {
    const session = await createSession()
    let observed = false
    session.on('title', () => {
      observed = true
      session.write('later')
    })
    const origin = session.writeAndReadGeometry('\x1b[32m中> \x1b[0m\x1b]0;prompt\x07')
    expect(observed).toBe(true)
    expect(origin.cursor).toMatchObject({ x: 4, y: 0, pendingWrap: false })
    expect(origin.revision).toBeLessThan(session.revision)
    expect(session.geometry().cursor).not.toEqual(origin.cursor)
  })

  it('captures prompt geometry before a native protocol reply observer writes', async () => {
    const session = await createSession()
    let replies = 0
    session.on('data', () => {
      replies += 1
      session.write('next')
    })
    const origin = session.writeAndReadGeometry('> \x1b[6n')
    expect(replies).toBe(1)
    expect(origin.cursor).toMatchObject({ x: 2, y: 0, pendingWrap: false })
    expect(origin.revision).toBeLessThan(session.revision)
    expect(session.geometry().cursor).toMatchObject({ x: 5, y: 0, pendingWrap: true })
  })

  it('samples prompt wrapping and bottom scrolling as parsed native state', async () => {
    const session = await createSession()
    session.write('\x1b[3;5H')
    const origin = session.writeAndReadGeometry('\x1b[35m中> \x1b[0m')
    expect(origin.cursor).toMatchObject({ x: 2, y: 2, pendingWrap: false })
    expect(origin.scrollbar.total).toBe(4)
    expect(origin.revision).toBe(session.revision)
  })

  it('reports CSS cell metrics at a high-DPR native grid', async () => {
    const session = await createSession()
    session.resize({ cellWidth: 10, cellHeight: 20, pixelRatio: 2 })
    expect(session.geometry()).toMatchObject({ cellWidth: 10, cellHeight: 20 })
  })

  it('matches native UTF8 replacement of unpaired surrogates', async () => {
    const session = await createSession()
    expect(session.measureTexts(['\ud800']).texts[0]).toEqual({
      cells: 1,
      units: [{ start: 0, end: 1, cells: 1 }],
    })
  })

  it('validates plain measurement inputs without changing native state', async () => {
    const session = await createSession()
    const before = session.geometry()
    for (const text of ['\x1b[31mred', 'a\nb', '\t', '\x7f', '\x80']) {
      expect(() => session.measure(text)).toThrow('plain printable text')
    }
    expect(session.geometry()).toEqual(before)
    expect(session.measure('')).toBe(0)
    expect(session.measureTexts([]).texts).toEqual([])
    session.dispose()
    expect(() => session.geometry()).toThrow()
    expect(() => session.measure('a')).toThrow()
  })
})
