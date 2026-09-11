import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { documentTokenForPath, pathForDocumentToken } from '@/features/address/utils/document-token'
import { emptyAddress, formatAddress, parseAddress } from '@workspace/client-core/address/grammar'
import { compareSavedDocumentId } from '@/features/editor/utils/compare-saved-document'
import { conflictDiffDocumentId } from '@/features/editor/utils/conflict-diff-document'
import {
  checkpointDiffDocumentId,
  snapshotDiffDocumentId,
} from '@/features/git/utils/diff-document'
import { refDocumentId } from '@/features/git/utils/ref-document'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import { settingsDocumentId } from '@/features/settings/utils/document'
import type { SessionId } from '@workspace/contracts'

const ROOT = '/repo'
const OLD_OID = 'a'.repeat(40)
const NEW_OID = 'b'.repeat(40)
const SESSION = '5f7f875d-6e41-5275-8927-06a9e5a4a2e1' as SessionId

function token(path: string) {
  const result = documentTokenForPath(ROOT, path)
  if (result.kind !== 'token') return expect.unreachable(`expected a token, got ${result.kind}`)

  return result.token
}

function roundTrip(path: string) {
  const parsed = pathForDocumentToken(ROOT, token(path))
  if (parsed.kind !== 'path') return expect.unreachable(`expected a path, got ${parsed.kind}`)

  return parsed.path
}

describe('files, compare-saved, refs and the search buffer', () => {
  test('round-trips a file', () => {
    expect(token(`${ROOT}/apps/web/src/main.tsx`)).toBe('f/apps/web/src/main.tsx')
    expect(roundTrip(`${ROOT}/apps/web/src/main.tsx`)).toBe(`${ROOT}/apps/web/src/main.tsx`)
  })

  test('round-trips a compare-saved document', () => {
    const path = compareSavedDocumentId(`${ROOT}/src/App.tsx`)

    expect(token(path)).toBe('c/src/App.tsx')
    expect(roundTrip(path)).toBe(path)
  })

  test('round-trips a git-ref document, a kind the plan never names', () => {
    const path = refDocumentId({ path: `${ROOT}/src/a.ts`, ref: 'refs/heads/main' })

    expect(token(path)).toBe('r/refs%2Fheads%2Fmain/src/a.ts')
    expect(roundTrip(path)).toBe(path)
  })

  test('drops the encoded absolute root from the search buffer', () => {
    expect(token(searchBufferDocumentId(ROOT))).toBe('s')
    expect(roundTrip(searchBufferDocumentId(ROOT))).toBe(searchBufferDocumentId(ROOT))
  })

  test('refuses a search buffer belonging to another workspace', () => {
    expect(documentTokenForPath(ROOT, searchBufferDocumentId('/other'))).toMatchObject({
      kind: 'unaddressable',
    })
  })
})

describe('snapshot diffs', () => {
  const diff = {
    newObjectId: NEW_OID,
    oldObjectId: OLD_OID,
    path: `${ROOT}/src/app.ts`,
    staged: false,
  }

  test('collapses a percent-encoded JSON id into a readable token', () => {
    const path = snapshotDiffDocumentId(diff as Parameters<typeof snapshotDiffDocumentId>[0])

    expect(token(path)).toBe(`d/worktree/${OLD_OID}..${NEW_OID},s=modified/src/app.ts`)
    expect(token(path).length).toBeLessThan(path.length / 2)
  })

  test('keeps `status` and `oldPath`, which the app cannot re-derive', () => {
    const renamed = snapshotDiffDocumentId({
      ...diff,
      oldPath: `${ROOT}/src/old.ts`,
    } as Parameters<typeof snapshotDiffDocumentId>[0])

    expect(token(renamed)).toContain('s=renamed')
    expect(token(renamed)).toContain('r=src%2Fold.ts')
    expect(roundTrip(renamed)).toBe(renamed)
  })

  test('marks a missing side with `_` and round-trips an added file', () => {
    const added = snapshotDiffDocumentId({
      newObjectId: NEW_OID,
      oldFileMissing: true,
      path: `${ROOT}/src/new.ts`,
      staged: false,
    } as Parameters<typeof snapshotDiffDocumentId>[0])

    expect(token(added)).toContain(`_..${NEW_OID}`)
    // The name promises a round trip, so assert one: `_` has to survive the decode as a
    // missing side, which is what `missingSidesForStatus` reconstructs.
    expect(roundTrip(added)).toBe(added)
  })

  // The server validates object ids as 40-64 hex; a fixed-width-40 grammar would
  // reject every id from a SHA-256 repository.
  test('accepts SHA-256 object ids', () => {
    const sha256 = 'c'.repeat(64)
    expect(pathForDocumentToken(ROOT, `d/worktree/${sha256}..${sha256}/a.ts`).kind).toBe('path')
  })

  test('rejects a revision naming nothing, and a malformed one', () => {
    expect(pathForDocumentToken(ROOT, 'd/worktree/_.._/a.ts')).toMatchObject({ kind: 'rejected' })
    expect(pathForDocumentToken(ROOT, 'd/worktree/zzz..zzz/a.ts')).toMatchObject({
      kind: 'rejected',
    })
    expect(pathForDocumentToken(ROOT, 'd/bogus/a..b/a.ts')).toMatchObject({ kind: 'rejected' })
  })

  test('reports branch diffs as unavailable rather than rejecting them', () => {
    expect(
      pathForDocumentToken(ROOT, `d/branch/${'a'.repeat(40)}..${'b'.repeat(40)}/src/a.ts`),
    ).toMatchObject({
      kind: 'unavailable',
    })
  })
})

describe('checkpoint diffs', () => {
  const base = { fromTurnCount: 3, sessionId: SESSION, toTurnCount: 5 }

  test('round-trips file scope', () => {
    const path = checkpointDiffDocumentId({
      ...base,
      filePath: `${ROOT}/src/a.ts`,
      path: `${ROOT}/src/a.ts`,
      scope: 'file',
    })

    expect(token(path)).toBe(`k/${SESSION}/3..5/src/a.ts`)
    expect(roundTrip(path)).toBe(path)
  })

  test('round-trips session scope, whose path is synthetic', () => {
    const path = checkpointDiffDocumentId({
      ...base,
      path: 'checkpoint-session-5',
      scope: 'session',
    })

    expect(token(path)).toBe(`k/${SESSION}/3..5`)
    expect(roundTrip(path)).toBe(path)
  })

  test('round-trips turn scope', () => {
    const path = checkpointDiffDocumentId({
      ...base,
      path: 'checkpoint-turn-5',
      scope: 'turn',
    })

    expect(token(path)).toBe(`k/${SESSION}/3..5!turn`)
    expect(roundTrip(path)).toBe(path)
  })

  // The real measurement, against the plan's mistaken "622 -> ~100": the plan cites
  // the snapshot encoder and quotes the checkpoint's length.
  test('is dramatically shorter than the encoded id it replaces', () => {
    const path = checkpointDiffDocumentId({
      ...base,
      filePath: `${ROOT}/apps/web/src/keymap/commands.ts`,
      path: `${ROOT}/apps/web/src/keymap/commands.ts`,
      scope: 'file',
    })

    expect(path.length).toBeGreaterThan(300)
    expect(token(path).length).toBeLessThan(100)
  })

  test('rejects a turn range that runs backwards', () => {
    expect(pathForDocumentToken(ROOT, `k/${SESSION}/9..2`)).toMatchObject({ kind: 'rejected' })
  })
})

test('settings round-trips as an ordinary document token', () => {
  expect(token(settingsDocumentId())).toBe('settings')
  expect(roundTrip(settingsDocumentId())).toBe(settingsDocumentId())
})

describe('what has no token', () => {
  test('cannot encode a conflict document', () => {
    expect(documentTokenForPath(ROOT, conflictDiffDocumentId('conflict-1'))).toMatchObject({
      kind: 'unaddressable',
    })
  })

  test('cannot encode a document outside the workspace', () => {
    expect(documentTokenForPath(ROOT, '/elsewhere/a.ts')).toMatchObject({ kind: 'unaddressable' })
  })
})

describe('hostile input', () => {
  // encodeURIComponent leaves `~` and `!` alone, and both are structural in the grammar.
  test('escapes the tab separator and the turn marker inside a filename', () => {
    expect(token(`${ROOT}/a~b!c.ts`)).toBe('f/a%7Eb%21c.ts')
    expect(roundTrip(`${ROOT}/a~b!c.ts`)).toBe(`${ROOT}/a~b!c.ts`)
  })

  test('round-trips spaces, unicode and reserved characters', () => {
    for (const name of ['a b.ts', 'ünïcödé.ts', 'a#b.ts', 'a?b.ts', 'a%20b.ts']) {
      expect(roundTrip(`${ROOT}/${name}`)).toBe(`${ROOT}/${name}`)
    }
  })

  test('degrades instead of throwing on a malformed percent-escape', () => {
    expect(() => pathForDocumentToken(ROOT, 'f/a%E0%A4%A')).not.toThrow()
    expect(pathForDocumentToken(ROOT, 'f/a%E0%A4%A')).toMatchObject({ kind: 'rejected' })
  })

  test('refuses a token that would escape the workspace', () => {
    expect(pathForDocumentToken(ROOT, 'f/../../etc/passwd')).toMatchObject({ kind: 'rejected' })
  })

  test('rejects an unknown token kind rather than guessing', () => {
    expect(pathForDocumentToken(ROOT, 'zzz/a.ts')).toMatchObject({ kind: 'rejected' })
    expect(pathForDocumentToken(ROOT, '')).toMatchObject({ kind: 'rejected' })
  })

  /**
   * The same shape check `parseSessionToken` applies to a `t/` token. Without it any
   * decoded segment became a `SessionId`, so a hand-edited `k/` token minted a checkpoint
   * document for a session that cannot exist — and that tab then persisted into the cache.
   */
  test('refuses to turn an arbitrary URL segment into a session id', () => {
    expect(pathForDocumentToken(ROOT, 'k/not-a-session/1..2/src/a.ts')).toMatchObject({
      kind: 'rejected',
    })
    expect(pathForDocumentToken(ROOT, `k/${SESSION}/1..2/src/a.ts`)).toMatchObject({ kind: 'path' })
  })
})

// The blind spot that let a critical bug through: every test above goes
// documentTokenForPath -> pathForDocumentToken directly, never through the URL. A
// token whose internal encoding the path parser destroys round-trips perfectly in
// isolation and restores the wrong document in the app.
describe('tokens survive the whole URL, not just the codec', () => {
  function throughUrl(path: string) {
    const result = documentTokenForPath(ROOT, path)
    if (result.kind !== 'token') return expect.unreachable(`expected a token, got ${result.kind}`)

    const href = formatAddress({
      ...emptyAddress(),
      document: result.token,
      mode: 'workbench',
      workspace: testWorkspaceToken('/repo'),
    })
    const parsed = pathForDocumentToken(ROOT, parseAddress(href).document ?? '')
    if (parsed.kind !== 'path') return expect.unreachable(`expected a path, got ${parsed.kind}`)

    return parsed.path
  }

  test('round-trips a git-ref whose ref contains slashes', () => {
    const path = refDocumentId({ path: `${ROOT}/src/a.ts`, ref: 'refs/heads/main' })

    expect(throughUrl(path)).toBe(path)
  })

  test('round-trips a file whose name contains a slash-encoded character', () => {
    expect(throughUrl(`${ROOT}/src/a b.ts`)).toBe(`${ROOT}/src/a b.ts`)
    expect(throughUrl(`${ROOT}/src/a~b!c.ts`)).toBe(`${ROOT}/src/a~b!c.ts`)
  })

  test('round-trips a renamed snapshot diff, whose oldPath rides in the revision segment', () => {
    const renamed = snapshotDiffDocumentId({
      newObjectId: NEW_OID,
      oldObjectId: OLD_OID,
      oldPath: `${ROOT}/src/old name.ts`,
      path: `${ROOT}/src/app.ts`,
      staged: false,
    } as Parameters<typeof snapshotDiffDocumentId>[0])

    expect(throughUrl(renamed)).toBe(renamed)
  })

  test('round-trips a file-scope checkpoint diff', () => {
    const path = checkpointDiffDocumentId({
      filePath: `${ROOT}/src/a.ts`,
      fromTurnCount: 3,
      path: `${ROOT}/src/a.ts`,
      scope: 'file',
      sessionId: SESSION,
      toTurnCount: 5,
    })

    expect(throughUrl(path)).toBe(path)
  })

  /**
   * The ids are part of the document id, so dropping them from the token minted a
   * DIFFERENT id on the way back — the restored tab never matched the one the app
   * would open, and the workbench kept both. The test above misses it only because it
   * omits the ids the app always sets.
   */
  test('round-trips a checkpoint diff carrying its object ids', () => {
    const path = checkpointDiffDocumentId({
      filePath: `${ROOT}/src/a.ts`,
      fromTurnCount: 3,
      newObjectId: 'b'.repeat(40),
      oldObjectId: 'a'.repeat(40),
      path: `${ROOT}/src/a.ts`,
      scope: 'file',
      status: 'modified',
      sessionId: SESSION,
      toTurnCount: 5,
    })

    expect(throughUrl(path)).toBe(path)
  })

  test('refuses an object id the URL made up', () => {
    const token = `k/${SESSION}/3..5,o=nothex/src%2Fa.ts`

    expect(pathForDocumentToken(ROOT, token)).toMatchObject({ kind: 'path' })
    expect(pathForDocumentToken(ROOT, token)).not.toMatchObject({
      path: expect.stringContaining('nothex'),
    })
  })
})

describe('status survives the round trip', () => {
  // `snapshotDiffDocumentId` re-derives status from which side is missing rather than
  // accepting one, so carrying `s=` means restoring the inputs that produce it.
  test.each(['deleted', 'untracked', 'modified'] as const)('round-trips %s', (status) => {
    const sides = {
      deleted: { newFileMissing: true },
      modified: {},
      untracked: { oldFileMissing: true },
    }[status]
    const path = snapshotDiffDocumentId({
      newObjectId: NEW_OID,
      oldObjectId: OLD_OID,
      path: `${ROOT}/src/app.ts`,
      staged: false,
      ...sides,
    } as Parameters<typeof snapshotDiffDocumentId>[0])

    expect(token(path)).toContain(`s=${status}`)
    expect(roundTrip(path)).toBe(path)
  })

  test('refuses to turn an arbitrary URL string into a git status', () => {
    const parsed = pathForDocumentToken(ROOT, `k/${SESSION}/1..2,s=notastatus/src/a.ts`)

    expect(parsed.kind).toBe('path')
    expect(parsed.kind === 'path' && parsed.path).not.toContain('notastatus')
  })
})
