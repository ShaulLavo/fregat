import { describe, expect, it, vi } from 'vitest'
import { carryMergeConflicts } from '../src/mergeConflicts'
import {
  createMergeConflictDocumentText,
  parseMergeConflicts as parseMergeConflictSource,
  resolveMergeConflict as resolveMergeConflictSource,
  type MergeConflictRegion,
  type MergeConflictResolution,
} from '../src/editor'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import { createDocumentSession } from '../src/public/document'

describe('merge conflict document text', () => {
  it('wraps only a one-line replacement', () => {
    expect(
      createMergeConflictDocumentText({
        localPath: '/path/file.ts',
        localText: ['one', 'two', 'three', ''].join('\n'),
        remotePath: '/path/file.ts',
        remoteText: ['one', 'TWO', 'three', ''].join('\n'),
      }),
    ).toBe(
      [
        'one',
        '<<<<<<< Local: /path/file.ts',
        'two',
        '=======',
        'TWO',
        '>>>>>>> Remote: /path/file.ts',
        'three',
        '',
      ].join('\n'),
    )
  })

  it('creates an empty local side for remote insertions', () => {
    expect(
      createMergeConflictDocumentText({
        localPath: '/path/file.ts',
        localText: ['one', 'three', ''].join('\n'),
        remotePath: '/path/file.ts',
        remoteText: ['one', 'two', 'three', ''].join('\n'),
      }),
    ).toBe(
      [
        'one',
        '<<<<<<< Local: /path/file.ts',
        '=======',
        'two',
        '>>>>>>> Remote: /path/file.ts',
        'three',
        '',
      ].join('\n'),
    )
  })

  it('creates an empty remote side for remote line deletions', () => {
    expect(
      createMergeConflictDocumentText({
        localPath: '/path/file.ts',
        localText: ['one', 'two', 'three', ''].join('\n'),
        remotePath: '/path/file.ts',
        remoteText: ['one', 'three', ''].join('\n'),
      }),
    ).toBe(
      [
        'one',
        '<<<<<<< Local: /path/file.ts',
        'two',
        '=======',
        '>>>>>>> Remote: /path/file.ts',
        'three',
        '',
      ].join('\n'),
    )
  })

  it('creates a whole-file conflict for remote file deletion', () => {
    expect(
      createMergeConflictDocumentText({
        localPath: '/path/file.ts',
        localText: ['one', 'two', ''].join('\n'),
        remotePath: '/path/file.ts',
        remoteText: null,
      }),
    ).toBe(
      [
        '<<<<<<< Local: /path/file.ts',
        'one',
        'two',
        '=======',
        '>>>>>>> Remote: /path/file.ts',
        '',
      ].join('\n'),
    )
  })

  it('emits multiple independent conflict blocks', () => {
    const text = createMergeConflictDocumentText({
      localPath: '/path/file.ts',
      localText: ['one', 'two', 'three', 'four', 'five', ''].join('\n'),
      remotePath: '/path/file.ts',
      remoteText: ['ONE', 'two', 'three', 'FOUR', 'five', ''].join('\n'),
    })

    expect(parseMergeConflicts(text)).toHaveLength(2)
    expect(text).toBe(
      [
        '<<<<<<< Local: /path/file.ts',
        'one',
        '=======',
        'ONE',
        '>>>>>>> Remote: /path/file.ts',
        'two',
        'three',
        '<<<<<<< Local: /path/file.ts',
        'four',
        '=======',
        'FOUR',
        '>>>>>>> Remote: /path/file.ts',
        'five',
        '',
      ].join('\n'),
    )
  })

  it('returns unchanged local text when there is no diff', () => {
    const text = ['one', 'two', ''].join('\n')

    expect(
      createMergeConflictDocumentText({
        localPath: '/path/file.ts',
        localText: text,
        remotePath: '/path/file.ts',
        remoteText: text,
      }),
    ).toBe(text)
  })
})

describe('merge conflict parsing', () => {
  it('finds two-sided git conflict marker regions', () => {
    const text = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'after',
    ].join('\n')

    const conflicts = parseMergeConflicts(text)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      index: 0,
      oursLabel: 'HEAD',
      theirsLabel: 'branch',
    })
    expect(slice(text, conflicts[0]!.ours)).toBe('ours\n')
    expect(slice(text, conflicts[0]!.theirs)).toBe('theirs\n')
  })

  it('finds diff3 conflicts with a base section', () => {
    const text = [
      '<<<<<<< ours',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> theirs',
      '',
    ].join('\n')

    const conflict = parseMergeConflicts(text)[0]!

    expect(conflict.baseLabel).toBe('base')
    expect(slice(text, conflict.ours)).toBe('ours\n')
    expect(slice(text, conflict.base!)).toBe('base\n')
    expect(slice(text, conflict.theirs)).toBe('theirs\n')
  })

  it('ignores incomplete conflicts', () => {
    const text = ['<<<<<<< HEAD', 'ours', '=======', 'theirs'].join('\n')

    expect(parseMergeConflicts(text)).toEqual([])
  })
})

describe('merge conflict resolution', () => {
  it('resolves to ours, theirs, both, and base', () => {
    const text = [
      'start',
      '<<<<<<< ours',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> theirs',
      'end',
    ].join('\n')
    const conflict = parseMergeConflicts(text)[0]!

    expect(resolvedText(text, conflict, 'ours')).toBe('start\nours\nend')
    expect(resolvedText(text, conflict, 'theirs')).toBe('start\ntheirs\nend')
    expect(resolvedText(text, conflict, 'both')).toBe('start\nours\ntheirs\nend')
    expect(resolvedText(text, conflict, 'base')).toBe('start\nbase\nend')
    expect(resolveMergeConflict(text, conflict, 'both')).toEqual({
      replacement: 'ours\ntheirs\n',
      range: conflict.range,
      selection: { start: conflict.range.start + 12, end: conflict.range.start + 12 },
    })
  })

  it('returns null when resolving to an absent base', () => {
    const text = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n')
    const conflict = parseMergeConflicts(text)[0]!

    expect(resolveMergeConflict(text, conflict, 'base')).toBeNull()
  })

  it('honors explicit side ordering', () => {
    const text = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch', ''].join('\n')
    const conflict = parseMergeConflicts(text)[0]!

    expect(resolvedText(text, conflict, ['theirs', 'ours'])).toBe('theirs\nours\n')
  })
})

function slice(text: string, range: { readonly start: number; readonly end: number }): string {
  return text.slice(range.start, range.end)
}

function parseMergeConflicts(text: string): readonly MergeConflictRegion[] {
  return parseMergeConflictSource(createStringTextSnapshot(text))
}

function resolveMergeConflict(
  text: string,
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution,
) {
  return resolveMergeConflictSource(createStringTextSnapshot(text), conflict, resolution)
}

// The document the caller's edit produces; the resolver itself only returns the replacement.
function resolvedText(
  text: string,
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution,
): string | null {
  const resolved = resolveMergeConflict(text, conflict, resolution)
  if (!resolved) return null
  return text.slice(0, resolved.range.start) + resolved.replacement + text.slice(resolved.range.end)
}

describe('merge conflict scanning', () => {
  const conflictText = '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n'

  it('finds a marker split across scan windows and pieces', () => {
    const prefix = `${'x'.repeat(16_380)}\n`
    const text = `${prefix}${conflictText}after`
    // The marker's first four characters stay in the original piece; the rest arrive in an insert.
    const session = createDocumentSession(`${prefix}<<<<${conflictText.slice(12)}after`)
    const at = prefix.length + 4
    const change = session.applyEdits([{ from: at, to: at, text: '<<< ours' }])
    expect(change.textSnapshot.readRange(0, change.textSnapshot.length)).toBe(text)

    const conflicts = parseMergeConflictSource(change.textSnapshot)

    expect(conflicts).toEqual(parseMergeConflicts(text))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.startMarker.start).toBe(prefix.length)
    expect(slice(text, conflicts[0]!.theirs)).toBe('theirs\n')
  })

  it('keeps CRLF inside the sides and out of the labels', () => {
    const text = '<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\n'
    const conflict = parseMergeConflicts(text)[0]!

    expect(conflict.oursLabel).toBe('HEAD')
    expect(conflict.theirsLabel).toBe('branch')
    expect(slice(text, conflict.ours)).toBe('ours\r\n')
    expect(slice(text, conflict.theirs)).toBe('theirs\r\n')
  })

  it('ends a conflict on a final marker line without a line break', () => {
    const text = '<<<<<<< a\nours\n=======\ntheirs\n>>>>>>> b'
    const conflict = parseMergeConflicts(text)[0]!

    expect(conflict.range).toEqual({ start: 0, end: text.length })
    expect(conflict.theirsLabel).toBe('b')
  })

  it('ignores markers that do not open a line and restarts on a second opener', () => {
    const text = [
      'x <<<<<<< not a marker',
      '<<<<<<< abandoned',
      'lost',
      '<<<<<<< ours',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> theirs',
      '',
    ].join('\n')
    const conflicts = parseMergeConflicts(text)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.oursLabel).toBe('ours')
    expect(slice(text, conflicts[0]!.ours)).toBe('ours\n')
  })

  it('reads a long line between markers without holding it', () => {
    const long = 'y'.repeat(100_000)
    const text = `<<<<<<< ours\n${long}\n=======\ntheirs\n>>>>>>> theirs\n`
    const conflict = parseMergeConflicts(text)[0]!

    expect(slice(text, conflict.ours)).toBe(`${long}\n`)
  })

  it('scans a source once, however often it is asked', () => {
    const source = createStringTextSnapshot(`before\n${conflictText}`)
    const chunks = vi.spyOn(source, 'forEachTextChunk')

    const first = parseMergeConflictSource(source)
    const second = parseMergeConflictSource(source)

    expect(second).toBe(first)
    expect(chunks).toHaveBeenCalledTimes(1)
  })

  it('reads only the chosen sides to resolve', () => {
    const source = createStringTextSnapshot(`before\n${conflictText}after`)
    const conflict = parseMergeConflictSource(source)[0]!
    const readRange = vi.spyOn(source, 'readRange')

    resolveMergeConflictSource(source, conflict, 'theirs')

    expect(readRange.mock.calls).toEqual([[conflict.theirs.start, conflict.theirs.end]])
  })
})

describe('carrying conflicts across edits', () => {
  const text = [
    'intro',
    '<<<<<<< ours',
    'ours line',
    '||||||| base',
    'base line',
    '=======',
    'theirs line',
    '>>>>>>> theirs',
    'outro',
    '',
  ].join('\n')

  function edited(source: string, edits: readonly { from: number; to: number; text: string }[]) {
    const session = createDocumentSession(source)
    const previous = session.getTextSnapshot()
    parseMergeConflictSource(previous)
    const next = session.applyEdits(edits).textSnapshot
    return { previous, next }
  }

  it('moves the regions and rows of a conflict typed inside', () => {
    const inside = text.indexOf('ours line') + 4
    const { previous, next } = edited(text, [{ from: inside, to: inside, text: 'more\n' }])

    const carried = carryMergeConflicts(previous, next, [
      { from: inside, to: inside, text: 'more\n' },
    ])

    expect(carried).toEqual(parseMergeConflicts(next.readRange(0, next.length)))
    expect(carried?.[0]?.separatorMarkerLine).toBe(6)
  })

  it('declines when an edit touches a marker line', () => {
    const marker = text.indexOf('=======') + 2
    const edit = { from: marker, to: marker + 1, text: '' }
    const { previous, next } = edited(text, [edit])

    expect(carryMergeConflicts(previous, next, [edit])).toBeNull()
  })

  it('agrees with a fresh scan for edits that miss every marker line', () => {
    const plainLines = ['intro', 'ours line', 'base line', 'theirs line', 'outro']
    let seed = 7
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % limit
    }
    for (let trial = 0; trial < 50; trial += 1) {
      const line = plainLines[random(plainLines.length)]!
      const start = text.indexOf(line) + random(line.length)
      const end = Math.min(start + random(3), text.indexOf(line) + line.length)
      const edit = { from: start, to: end, text: ['x', '\n', 'yz\nw', ''][random(4)]! }
      const { previous, next } = edited(text, [edit])

      const carried = carryMergeConflicts(previous, next, [edit])

      expect(carried).toEqual(parseMergeConflicts(next.readRange(0, next.length)))
    }
  })
})
