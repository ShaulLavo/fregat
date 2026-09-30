import { describe, expect, it } from 'vitest'

import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  insertIntoPieceTable,
} from '../public/document'
import { AutoCloseStore, characterAt, characterBefore } from './autoCloseStore'

const snapshotOf = (text: string) => createPieceTableSnapshot(text)

describe('characterAt / characterBefore', () => {
  it('reads the characters around an offset', () => {
    const snapshot = snapshotOf('ab')

    expect(characterAt(snapshot, 0)).toBe('a')
    expect(characterBefore(snapshot, 1)).toBe('a')
  })

  // readPieceTableTextRange throws out of range, which would fire on the first keystroke in a new file.
  it('is null at the document edges instead of throwing', () => {
    const snapshot = snapshotOf('')

    expect(characterAt(snapshot, 0)).toBeNull()
    expect(characterBefore(snapshot, 0)).toBeNull()
    expect(characterAt(snapshotOf('a'), 1)).toBeNull()
  })
})

describe('AutoCloseStore', () => {
  it('recognises a closer it tracked', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()

    store.track(snapshot, snapshot, 1, ')')

    expect(store.hasCloserAt(snapshot, 1, ')')).toBe(true)
  })

  it('does not recognise an untracked closer', () => {
    const snapshot = snapshotOf('()')

    expect(new AutoCloseStore().hasCloserAt(snapshot, 1, ')')).toBe(false)
  })

  it('does not answer for a different character or offset', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    expect(store.hasCloserAt(snapshot, 1, ']')).toBe(false)
    expect(store.hasCloserAt(snapshot, 0, ')')).toBe(false)
  })

  // The master invalidator: a snapshot this editor did not hand forward is not ours to trust.
  it('goes quiet on a snapshot it was never advanced onto', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    const foreign = insertIntoPieceTable(snapshot, 1, 'x')

    expect(store.hasCloserAt(foreign, 2, ')')).toBe(false)
  })

  it('follows the closer when text is typed inside the pair', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    const typed = insertIntoPieceTable(snapshot, 1, 'ab')
    store.advance(snapshot, typed)

    expect(characterAt(typed, 3)).toBe(')')
    expect(store.hasCloserAt(typed, 3, ')')).toBe(true)
    expect(store.hasCloserAt(typed, 1, ')')).toBe(false)
  })

  it('stops recognising a closer that was deleted', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    const deleted = applyBatchToPieceTable(snapshot, [{ from: 1, text: '', to: 2 }])
    store.advance(snapshot, deleted)

    expect(store.hasCloserAt(deleted, 1, ')')).toBe(false)
  })

  it('forgets a closer once it has been consumed', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    store.forget(snapshot, 1)

    expect(store.hasCloserAt(snapshot, 1, ')')).toBe(false)
  })

  it('clears everything on demand', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')

    store.clear()

    expect(store.hasCloserAt(snapshot, 1, ')')).toBe(false)
  })

  it('advancing a cleared store does not resurrect it', () => {
    const snapshot = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(snapshot, snapshot, 1, ')')
    store.clear()

    store.advance(snapshot, snapshot)

    expect(store.hasCloserAt(snapshot, 1, ')')).toBe(false)
  })

  it('preserves outer pairs across an owned nested insertion', () => {
    const outer = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(outer, outer, 1, ')')
    const nested = insertIntoPieceTable(outer, 1, '()')

    store.track(outer, nested, 2, ')')

    expect(store.hasCloserAt(nested, 2, ')')).toBe(true)
    expect(store.hasCloserAt(nested, 3, ')')).toBe(true)
  })

  it('drops outer pairs when the nested insertion starts from a foreign snapshot', () => {
    const outer = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(outer, outer, 1, ')')
    const foreign = insertIntoPieceTable(outer, 1, 'a')
    const nested = insertIntoPieceTable(foreign, 2, '()')

    store.track(foreign, nested, 3, ')')

    expect(store.hasCloserAt(nested, 3, ')')).toBe(true)
    expect(store.hasCloserAt(nested, 4, ')')).toBe(false)
  })

  it('cannot revive an outer pair by advancing from a foreign snapshot', () => {
    const outer = snapshotOf('()')
    const store = new AutoCloseStore()
    store.track(outer, outer, 1, ')')
    const foreign = insertIntoPieceTable(outer, 1, 'a')
    const typed = insertIntoPieceTable(foreign, 2, 'b')

    store.advance(foreign, typed)
    expect(store.hasCloserAt(typed, 3, ')')).toBe(false)
    const nested = insertIntoPieceTable(typed, 3, '()')
    store.track(typed, nested, 4, ')')

    expect(store.hasCloserAt(nested, 4, ')')).toBe(true)
    expect(store.hasCloserAt(nested, 5, ')')).toBe(false)
  })

  it('tracks several carets at once', () => {
    const snapshot = snapshotOf('() ()')
    const store = new AutoCloseStore()

    store.track(snapshot, snapshot, 1, ')')
    store.track(snapshot, snapshot, 4, ')')

    expect(store.hasCloserAt(snapshot, 1, ')')).toBe(true)
    expect(store.hasCloserAt(snapshot, 4, ')')).toBe(true)
  })
})
