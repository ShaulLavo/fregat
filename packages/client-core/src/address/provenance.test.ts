import { gitSnapshotTargetSchema, environmentIdSchema } from '@workspace/contracts'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  editorReferenceForSnapshotTarget,
  editorReferenceForToken,
  editorReferenceSchema,
  snapshotTargetForReference,
  tokenForEditorReference,
} from './references'
import { emptyAddress, formatAddress, parseAddress } from './grammar'

const old = 'a'.repeat(40)
const next = 'b'.repeat(40)
const commit = 'c'.repeat(40)
const parents = ['d'.repeat(40), 'e'.repeat(40)]

for (const kind of ['moving', 'historical', 'captured-review'] as const) {
  test(`${kind} survives shared schema, local/remote route, editor and tabs metadata`, () => {
    const common = { rootPath: '/repo', path: '/repo/src/a~b.ts' }
    const revision = {
      old: { kind: 'blob', objectId: old },
      new: { kind: 'blob', objectId: next },
      oldPath: '/repo/src/old.ts',
      status: 'renamed',
    }
    const target = v.parse(
      gitSnapshotTargetSchema,
      kind === 'moving'
        ? { ...common, kind, changeSource: 'staged' }
        : kind === 'historical'
          ? { ...common, kind, revision, origin: { id: commit, parents } }
          : { ...common, kind, revision },
    )
    const reference = editorReferenceForSnapshotTarget(target)
    expect(reference).not.toBeNull()
    if (!reference) return
    const token = tokenForEditorReference(reference)
    const parsed = editorReferenceForToken(token)
    expect(parsed).toEqual(reference)
    expect(v.parse(editorReferenceSchema, reference)).toEqual(reference)
    if (parsed?.kind !== 'snapshot') return
    expect(snapshotTargetForReference(parsed, '/repo')).toEqual(target)
    for (const environmentId of [
      null,
      v.parse(environmentIdSchema, '499c1da4-fd11-4701-a7d1-0d19381e8fd5'),
    ] as const) {
      const address = {
        ...emptyAddress(),
        environmentId,
        mode: 'chat',
        workspace: 'project',
        document: 't/new',
        editor: token,
        tabs: [token, 'f/src/live.ts'],
      } as const
      const href = formatAddress(address)
      const restored = parseAddress(href)
      expect(restored.editor).toBe(token)
      expect(restored.tabs).toEqual(address.tabs)
    }
  })
}

test('legacy readonly tokens drop only their entry from a mixed tab collection', () => {
  const oldToken = `d/historical/${old}..${next}/src/a.ts`
  expect(editorReferenceForToken(oldToken)).toBeNull()
  const address = parseAddress(
    `/~project/workbench/f/src/live.ts?tabs=f/src/live.ts~${oldToken}~h/src/history.ts`,
  )
  expect(address.tabs).toEqual(['f/src/live.ts', 'h/src/history.ts'])
  expect(address.document).toBe('f/src/live.ts')
})

test('historical tokens require the full origin and fixed revision without stripping metadata', () => {
  const token = `d/historical/${old}..${next},s=modified,r=src%2Fa.ts,c=${commit},p=${parents.join('+')}/src/a.ts`
  expect(editorReferenceForToken(token)).toMatchObject({ revisionToken: token.split('/')[2] })
  for (const damaged of [
    token.replace(`,c=${commit}`, ''),
    token.replace(`,p=${parents.join('+')}`, ''),
    token.replace(',s=modified', ''),
    token.replace(',r=src%2Fa.ts', ''),
    token.replace(`c=${commit}`, 'c=HEAD'),
    token.replace(`p=${parents.join('+')}`, 'p=bad'),
    token.replace('s=modified', 's=unknown'),
    token.replace(',s=modified', ',x=unknown,s=modified'),
    token.replace(',s=modified', ',s=modified,s=modified'),
  ])
    expect(editorReferenceForToken(damaged)).toBeNull()
})

test('root commits keep the empty ordered parent list and distinguish missing from empty blobs', () => {
  const reference = editorReferenceForToken(
    `d/historical/_..${next},s=added,r=empty.ts,c=${commit},p=_/empty.ts`,
  )
  expect(reference?.kind).toBe('snapshot')
  if (reference?.kind !== 'snapshot') return
  expect(snapshotTargetForReference(reference, '/repo')).toMatchObject({
    origin: { id: commit, parents: [] },
    revision: { old: { kind: 'missing' }, new: { kind: 'blob', objectId: next } },
  })
})
