import { createSplitProjection, createTextDiff } from '@singapore-editor/diff'
import { describe, expect, it } from 'vitest'

import { diffQueryTargetAt, type DiffSideState } from '@/features/editor/utils/diff-language-query'
import { createDiffPositionMap, type DiffFileSide } from '@/features/editor/utils/diff-position-map'

// The gate deciding whether a point in a diff may become a language-server question. Every refusal
// here is a wrong answer that does not get shown.

const OLD = 'const a = 1\nconst b = 2\nconst c = 3\n'
const NEW = 'const a = 1\nconst B = 22\nconst c = 3\n'

const BOTH_READY = sides({ new: 'ready', old: 'ready' })

describe('diffQueryTargetAt', () => {
  it('reconstructs both file texts exactly, which is what the opened documents are', () => {
    // The premise under everything else here. `DiffFile.newLines` keeps a trailing empty element
    // for the final newline, so joining it returns the file byte for byte. If that stopped being
    // true the diff would open a document that is not the file, and every answer about it would be
    // off by however much the texts differ — inert and silent rather than broken and loud, which
    // is the worst of the available failures.
    const file = createTextDiff({
      newFile: { path: 'repo/a.ts', text: NEW },
      oldFile: { path: 'repo/a.ts', text: OLD },
    })

    expect(file.newLines.join('\n')).toBe(NEW)
    expect(file.oldLines.join('\n')).toBe(OLD)
  })

  it('asks about the new side, naming the document to ask', () => {
    const { map, offsetOf } = setUp()

    const target = diffQueryTargetAt({
      map,
      offset: offsetOf('addition') + 6,
      sides: BOTH_READY,
    })

    expect(target).toEqual({ kind: 'ask', position: { character: 6, line: 1 }, side: 'new' })
  })

  it('asks about a deleted line, which exists only in the old document', () => {
    // The capability this gate gained. A deletion is real code; it is simply code that lives in the
    // pre-image, and the diff opens the pre-image too.
    const { map, offsetOf } = setUp({ side: 'old' })

    const target = diffQueryTargetAt({ map, offset: offsetOf('deletion'), sides: BOTH_READY })

    expect(target).toEqual({ kind: 'ask', position: { character: 0, line: 1 }, side: 'old' })
  })

  it('refuses a side whose document drifted out from under it', () => {
    // The new side shares the file's real uri with any editor that has it open, and our proxy
    // forwards that editor's text to the server. An edit ABOVE the hover shifts every line below
    // it, so the position we would send names different code than the one under the pointer.
    const { map, offsetOf } = setUp()

    const target = diffQueryTargetAt({
      map,
      offset: offsetOf('addition') + 6,
      sides: sides({ new: 'drifted', old: 'ready' }),
    })

    expect(target).toEqual({ kind: 'unavailable', reason: 'text-moved' })
  })

  it('refuses a side with no document at all', () => {
    // An added file has no old side to open, and a diff built from a patch has neither.
    const { map, offsetOf } = setUp({ side: 'old' })

    const target = diffQueryTargetAt({
      map,
      offset: offsetOf('deletion'),
      sides: sides({ new: 'ready' }),
    })

    expect(target).toEqual({ kind: 'unavailable', reason: 'side-not-open' })
  })

  it('refuses a separator even when both documents are ready', () => {
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const { map, offsetOf } = setUp({
      newText: `${long.replace('line 40', 'changed')}\n`,
      oldText: `${long}\n`,
    })

    const target = diffQueryTargetAt({ map, offset: offsetOf('hunk'), sides: BOTH_READY })

    expect(target).toEqual({ kind: 'unavailable', reason: 'not-a-file-line' })
  })
})

function sides(states: Partial<Record<DiffFileSide, DiffSideState>>) {
  return new Map(
    Object.entries(states).map(([side, state]) => [side as DiffFileSide, state as DiffSideState]),
  )
}

function setUp({
  newText = NEW,
  oldText = OLD,
  side = 'new',
}: { newText?: string; oldText?: string; side?: DiffFileSide } = {}) {
  const file = createTextDiff({
    newFile: { path: 'repo/a.ts', text: newText },
    oldFile: { path: 'repo/a.ts', text: oldText },
  })
  const projection = createSplitProjection(file)
  const rows = side === 'old' ? projection.leftRows : projection.rightRows

  return {
    map: createDiffPositionMap(rows, file.newLines, file.oldLines),
    offsetOf(type: string) {
      const index = rows.findIndex((row) => row.type === type)
      expect(index, `no ${type} row`).toBeGreaterThanOrEqual(0)

      return rows.slice(0, index).reduce((offset, row) => offset + row.text.length + 1, 0)
    },
  }
}
