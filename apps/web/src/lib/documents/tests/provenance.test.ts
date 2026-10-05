import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { expect, test } from '../../../../test/fixtures'
import { historyRepository } from '../../../../test/factories/git-history'
import { createTestQueryClient } from '../../../../test/render'
import {
  historicalDocument,
  matchesHistoricalTarget,
  snapshotDocument,
} from '@/lib/documents/utils/comparisons'
import { documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { encodeTabContent, decodeTabContent } from '@/lib/documents/utils/storage-codec'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'
import {
  contentForDocumentToken,
  documentTokenForContent,
} from '@/features/address/utils/document-token'
import { admitHistoricalAddress } from '@/features/address/utils/historical-admission'
import { emptyAddress } from '@workspace/client-core/address/grammar'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'
import { fetchDiff } from '@/lib/git-diff-query'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'

test('real equal blob pairs retain distinct commit subjects and refuse spoofed relationships from shared metadata', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const repo = await historyRepository(server.root)
  await repo.write('a.ts', 'before\n')
  const parent = repo.commit('Parent')
  await repo.write('a.ts', 'after\n')
  const first = repo.commit('First')
  const second = repo.git(
    'commit-tree',
    repo.git('rev-parse', 'HEAD^{tree}'),
    '-p',
    parent,
    '-m',
    'Second',
  )
  const queries = createTestQueryClient()
  try {
    const rootPath = filesystemPath('history-repo')
    const details = await queries.query(commitDetailsQueryOptions(rootPath, first))
    const other = await queries.query(commitDetailsQueryOptions(rootPath, second))
    const file = details.files[0]
    const otherFile = other.files[0]
    expect(file).toBeDefined()
    expect(otherFile).toBeDefined()
    if (!file || !otherFile) return
    const one = historicalDocument({ rootPath, details, file })
    const two = historicalDocument({ rootPath, details: other, file: otherFile })
    expect(one).not.toBeNull()
    expect(two).not.toBeNull()
    if (!one || !two || one.source.kind !== 'snapshot' || one.source.target.kind !== 'historical')
      return
    expect(documentKey(one)).not.toBe(documentKey(two))
    expect(comparisonRequest(one.source)).toEqual(comparisonRequest(two.source))
    if (two.source.kind !== 'snapshot')
      return expect.unreachable('second historical fixture missing')
    const [bytesOne, bytesTwo] = await Promise.all([
      queries.query(snapshotComparisonQueryOptions(one.source)),
      queries.query(snapshotComparisonQueryOptions(two.source)),
    ])
    expect(bytesOne).toBe(bytesTwo)
    const content = documentTab(one)
    const stored = encodeTabContent(content, rootPath)
    expect(decodeTabContent(stored, rootPath)).toEqual(content)
    const encoded = documentTokenForContent(rootPath, content)
    expect(encoded.kind).toBe('token')
    if (encoded.kind !== 'token') return
    expect(contentForDocumentToken(rootPath, encoded.token)).toEqual({ kind: 'content', content })
    const address = {
      ...emptyAddress(),
      mode: 'workbench',
      document: encoded.token,
      tabs: [encoded.token, 'f/live.ts'],
    } as const
    expect((await admitHistoricalAddress(queries, rootPath, address)).selectedRejected).toBe(false)
    const target = one.source.target
    const variants = [
      { ...target, origin: { ...target.origin, parents: [] } },
      { ...target, revision: { ...target.revision, old: target.revision.new } },
      {
        ...target,
        revision: { ...target.revision, oldPath: filesystemPath('history-repo/other.ts') },
      },
      { ...target, revision: { ...target.revision, status: 'deleted' } },
      { ...target, path: filesystemPath('history-repo/other.ts') },
    ] as const
    for (const spoofed of variants) {
      expect(matchesHistoricalTarget(spoofed, details)).toBe(false)
      const token = documentTokenForContent(
        rootPath,
        documentTab({ kind: 'git-diff', source: { kind: 'snapshot', target: spoofed } }),
      )
      expect(token.kind).toBe('token')
      if (token.kind !== 'token') continue
      expect(
        (await admitHistoricalAddress(queries, rootPath, { ...address, document: token.token }))
          .selectedRejected,
      ).toBe(true)
      const mixed = await admitHistoricalAddress(queries, rootPath, {
        ...address,
        document: 'f/live.ts',
        tabs: ['f/live.ts', token.token],
      })
      expect(mixed.address.tabs).toEqual(['f/live.ts'])
    }
  } finally {
    queries.clear()
  }
})

test('moving worktree and staged captures update input revisions under their stable subjects', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.ts', 'base\n')
  repo.commit('Base')
  const rootPath = filesystemPath('history-repo')
  const path = 'history-repo/a.ts'
  for (const source of ['worktree', 'staged'] as const) {
    await repo.write('a.ts', 'first\n')
    if (source === 'staged') repo.git('add', 'a.ts')
    const first = await fetchDiff(path, source === 'staged', undefined, client)
    await repo.write('a.ts', 'second\n')
    if (source === 'staged') repo.git('add', 'a.ts')
    const second = await fetchDiff(path, source === 'staged', undefined, client)
    const one = first[0] && snapshotDocument(first[0], rootPath, source)
    const two = second[0] && snapshotDocument(second[0], rootPath, source)
    expect(one).not.toBeNull()
    expect(two).not.toBeNull()
    if (!one || !two || one.source.kind !== 'snapshot' || two.source.kind !== 'snapshot') continue
    const scope = { environmentId: TEST_ENVIRONMENT_ID, rootPath }
    const before = snapshotComparisonInput({ comparison: one.source, scope, diffs: first })
    const after = snapshotComparisonInput({ comparison: two.source, scope, diffs: second })
    expect(before.subject).toBe(after.subject)
    expect(before.revision).not.toEqual(after.revision)
    expect(after.files[0]?.kind).toBe('full')
    expect(documentTokenForContent(rootPath, documentTab(one))).toEqual(
      documentTokenForContent(rootPath, documentTab(two)),
    )
  }
})

test('real root, rename, empty deletion, merge and submodule details retain actual provenance and sides', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('empty.ts', '')
  await repo.write('a.ts', 'before\n')
  const initial = repo.commit('Root')
  const rootPath = filesystemPath('history-repo')
  const scope = { environmentId: TEST_ENVIRONMENT_ID, rootPath }
  const rootDetails = (
    await client.git.history.commit.get({ query: { path: rootPath, commit: initial } })
  ).data
  if (!rootDetails) return expect.unreachable('root commit details missing')
  const empty = rootDetails.files.find((file) => file.path.endsWith('/empty.ts'))
  if (!empty) return expect.unreachable('empty root file missing')
  const rootDocument = historicalDocument({ rootPath, details: rootDetails, file: empty })
  if (!rootDocument || rootDocument.source.kind !== 'snapshot')
    return expect.unreachable('empty root target missing')
  expect(rootDocument.source.target).toMatchObject({
    kind: 'historical',
    origin: { id: initial, parents: [] },
    revision: { old: { kind: 'missing' }, new: { kind: 'blob' }, status: 'added' },
  })
  const rootRequest = comparisonRequest(rootDocument.source)
  if (rootRequest.kind !== 'snapshot') return expect.unreachable('root fixture is not fixed')
  const rootDiff = (await client.git.diff.blob.get({ query: rootRequest.query })).data
  const rootInput = snapshotComparisonInput({
    scope,
    comparison: rootDocument.source,
    diffs: rootDiff ?? [],
  })
  expect(rootInput.files[0]).toMatchObject({
    kind: 'full',
    old: { kind: 'missing' },
    new: { kind: 'blob', text: '' },
  })
  repo.git('mv', 'a.ts', 'renamed.ts')
  repo.git('rm', 'empty.ts')
  const changed = repo.commit('Rename and remove empty')
  const details = (
    await client.git.history.commit.get({ query: { path: rootPath, commit: changed } })
  ).data
  if (!details) return expect.unreachable('changed commit details missing')
  for (const file of details.files) {
    const document = historicalDocument({ rootPath, details, file })
    if (
      !document ||
      document.source.kind !== 'snapshot' ||
      document.source.target.kind !== 'historical'
    )
      return expect.unreachable('changed target missing')
    expect(document.source.target.origin).toEqual({ id: changed, parents: [initial] })
    expect(matchesHistoricalTarget(document.source.target, details)).toBe(true)
    if (file.status === 'renamed')
      expect(document.source.target.revision.oldPath).toBe('history-repo/a.ts')
    if (file.status === 'deleted') {
      const request = comparisonRequest(document.source)
      if (request.kind !== 'snapshot') return expect.unreachable('deletion fixture is not fixed')
      const diffs = (await client.git.diff.blob.get({ query: request.query })).data ?? []
      expect(
        snapshotComparisonInput({ scope, comparison: document.source, diffs }).files[0],
      ).toMatchObject({ kind: 'full', old: { kind: 'blob', text: '' }, new: { kind: 'missing' } })
    }
  }
  repo.git('checkout', '-b', 'side')
  await repo.write('side.ts', 'side\n')
  const side = repo.commit('Side')
  repo.git('checkout', 'main')
  await repo.write('main.ts', 'main\n')
  const main = repo.commit('Main')
  repo.git('merge', '--no-ff', 'side', '-m', 'Merge')
  const merge = repo.git('rev-parse', 'HEAD')
  const merged = (await client.git.history.commit.get({ query: { path: rootPath, commit: merge } }))
    .data
  if (!merged?.files[0]) return expect.unreachable('merge file missing')
  const mergedDocument = historicalDocument({ rootPath, details: merged, file: merged.files[0] })
  expect(mergedDocument?.source).toMatchObject({
    target: { origin: { id: merge, parents: [main, side] } },
  })
  expect(merged.files.map((file) => file.path)).toEqual(['history-repo/side.ts'])
  repo.git('update-index', '--add', '--cacheinfo', `160000,${initial},module`)
  repo.git('commit', '-m', 'Submodule reference')
  const submoduleId = repo.git('rev-parse', 'HEAD')
  const submodule = (
    await client.git.history.commit.get({ query: { path: rootPath, commit: submoduleId } })
  ).data
  const entry = submodule?.files.find((file) => file.kind === 'submodule')
  if (!submodule || !entry) return expect.unreachable('submodule fixture missing')
  expect(historicalDocument({ rootPath, details: submodule, file: entry })).toBeNull()
})
