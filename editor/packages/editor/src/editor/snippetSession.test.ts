import { describe, expect, it } from 'vitest'

import { createPieceTableSnapshot, insertIntoPieceTable } from '../public/document'
import { SnippetSession } from './snippetSession'

const snapshotOf = (text: string) => createPieceTableSnapshot(text)

describe('SnippetSession', () => {
  it('is inactive until a snippet with several stops starts it', () => {
    const session = new SnippetSession()

    expect(session.active).toBe(false)
  })

  // One stop is where the caret already is; there is nothing to cycle through.
  it('ignores a snippet with a single stop', () => {
    const session = new SnippetSession()

    session.start(snapshotOf('fn(a)'), [{ end: 4, start: 3 }])

    expect(session.active).toBe(false)
  })

  it('cycles forward through the stops', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    expect(session.move(snapshot, 1)).toEqual({ end: 7, start: 6 })
  })

  it('cycles backward again', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    session.move(snapshot, 1)

    expect(session.move(snapshot, -1)).toEqual({ end: 4, start: 3 })
  })

  // Walking off the end ends the session, so the next Tab indents as usual.
  it('ends when moving past the last stop', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    session.move(snapshot, 1)

    expect(session.move(snapshot, 1)).toBeNull()
    expect(session.active).toBe(false)
  })

  it('carries later stops along when text is typed into an earlier one', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    const typed = insertIntoPieceTable(snapshot, 4, 'XX')
    session.advance(typed)

    expect(session.move(typed, 1)).toEqual({ end: 9, start: 8 })
  })

  it('goes quiet on a snapshot it was never advanced onto', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    const foreign = insertIntoPieceTable(snapshot, 0, 'x')

    expect(session.move(foreign, 1)).toBeNull()
    expect(session.active).toBe(false)
  })

  it('clears on demand', () => {
    const snapshot = snapshotOf('fn(a, b)')
    const session = new SnippetSession()
    session.start(snapshot, [
      { end: 4, start: 3 },
      { end: 7, start: 6 },
    ])

    session.clear()

    expect(session.active).toBe(false)
  })
})
