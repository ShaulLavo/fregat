import { fixtureEnvironmentId } from '../../../../test/factories/chat'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from '../../../../test/factories/git'
import { fetchDiff } from '@/lib/git-diff-query'
import { snapshotDocument, capturedReviewDocument } from '@/lib/documents/utils/comparisons'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { expect, test } from '../../../../test/fixtures'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'

for (const kind of ['worktree', 'staged', 'historical'] as const) {
  test(`${kind} retains exact blob inputs through dirty live edits and Undo`, async ({
    server,
    client,
  }) => {
    const fixture = await createSnapshotComparisonFixture(server.root, client)
    const input = {
      worktree: fixture.input,
      staged: fixture.stagedInput,
      historical: fixture.historicalInput,
    }[kind]
    const service = new WorkspaceDocumentService(() => undefined, fixture.scope.environmentId)
    const file = await fetchFile(fixture.path, new AbortController().signal, client)
    const live = service.ensureLiveDocument(file)
    const stamp = service.prepareTargetStamp(live.key)
    const lease = service.acquireSnapshotComparison({ input, signal: new AbortController().signal })
    const read = lease.read()
    expect(read.kind).toBe('ready')
    if (read.kind !== 'ready' || read.input.kind !== 'snapshot') return
    expect(read.input).toBe(input)
    expect(
      read.input.comparison.target.kind === 'moving'
        ? read.input.comparison.target.changeSource
        : read.input.comparison.target.kind,
    ).toBe(kind)
    const side = input.files[0]
    expect(side?.kind).toBe('full')
    if (side?.kind !== 'full') return
    expect(side.old.kind === 'blob' ? side.old.text : null).toContain(
      kind === 'worktree' ? 'INDEX' : 'COMMIT',
    )
    expect(side.new.kind === 'blob' ? side.new.text : null).toContain(
      kind === 'worktree' ? 'DISK' : 'INDEX',
    )
    const session = createEditorBufferSession(live.buffer)
    session.applyText('export const authority = "DIRTY"\n')
    expect(lease.read()).toBe(read)
    expect(service.getLiveDocument(live.key)?.buffer).toBe(live.buffer)
    expect(stamp && service.isTargetStampCurrent(stamp)).toBe(false)
    session.undo()
    expect(live.buffer.getTextSnapshot().materializeFullText()).toContain('DISK')
    lease.release()
    expect(service.getLiveDocument(live.key)?.buffer).toBe(live.buffer)
    service.dispose()
  })
}

test('joins two interests by scoped subject and clears only the final source interest', async ({
  server,
  client,
}) => {
  const { input, scope } = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, scope.environmentId)
  const canceled = new AbortController()
  const first = service.acquireSnapshotComparison({ input, signal: canceled.signal })
  const second = service.acquireSnapshotComparison({ input, signal: new AbortController().signal })
  expect(first.read()).toBe(second.read())
  expect(service.state().liveDocumentsByKey).toEqual({})
  canceled.abort()
  expect(first.read().kind).toBe('released')
  expect(second.read().kind).toBe('ready')
  expect(service.state().snapshotComparisons.size).toBe(1)
  second.release()
  second.release()
  expect(service.state().snapshotComparisons.size).toBe(0)
  service.dispose()
  expect(
    service.acquireSnapshotComparison({ input, signal: new AbortController().signal }).read(),
  ).toEqual({ kind: 'released', reason: 'owner-disposed' })
})

test('refresh rejects obsolete, replayed, foreign and changed-subject requests', async ({
  server,
  client,
}) => {
  const fixture = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, fixture.scope.environmentId)
  const first = service.acquireSnapshotComparison({
    input: fixture.input,
    signal: new AbortController().signal,
  })
  const second = service.acquireSnapshotComparison({
    input: fixture.input,
    signal: new AbortController().signal,
  })
  const old = first.requestRefresh()
  const latest = first.requestRefresh()
  const updated = { ...fixture.input }
  expect(first.refresh(updated, old)).toBe(false)
  expect(second.refresh(updated, latest)).toBe(false)
  expect(first.refresh(fixture.stagedInput, latest)).toBe(false)
  expect(first.refresh(updated, latest)).toBe(true)
  expect(first.refresh(fixture.input, latest)).toBe(false)
  expect(first.read()).toBe(second.read())
  const read = second.read()
  if (read.kind === 'ready') expect(read.input).toBe(updated)
  service.dispose()
  expect(second.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
})

test('tab copies retain independent interests and retention closes them', async ({
  server,
  client,
}) => {
  const { input, scope } = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, scope.environmentId)
  const first = service.prepareSnapshotComparisonTab(tabId('first'), {
    input,
    signal: new AbortController().signal,
  })
  service.copyView(tabId('first'), tabId('second'))
  expect(service.state().snapshotComparisonTabs.size).toBe(2)
  service.removeView(tabId('first'))
  expect(first.read().kind).toBe('released')
  expect(service.state().snapshotComparisons.size).toBe(1)
  service.retain({ documentKeys: new Set(), tabIds: new Set() })
  expect(service.state().snapshotComparisons.size).toBe(0)
  service.dispose()
})

test('patch, omitted, binary and unresolved inputs stay outside complete source admission', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const parse = (diff: typeof f.worktree) =>
    snapshotComparisonInput({ scope: f.scope, comparison: f.comparison, diffs: [diff] }).files[0]
  const partial = parse({ ...f.worktree, oldText: undefined })
  expect(partial?.kind).toBe('partial')
  if (partial?.kind === 'partial')
    expect(partial.display.every((file) => file.isPartial)).toBe(true)
  expect(parse({ ...f.worktree, omitted: 'size' })).toEqual({ kind: 'no-text', reason: 'size' })
  expect(
    parse({ ...f.worktree, patch: '\nBinary files a/source.ts and b/source.ts differ\n' }),
  ).toEqual({ kind: 'no-text', reason: 'binary' })
  expect(parse({ ...f.worktree, oldObjectId: 'HEAD' })?.kind).toBe('partial')
  expect(parse({ ...f.worktree, oldObjectId: 'e'.repeat(40) })?.kind).toBe('full')
  const fixed = capturedReviewDocument(f.worktree, f.scope.rootPath)
  expect(fixed?.source.kind).toBe('snapshot')
  if (fixed?.source.kind === 'snapshot')
    expect(
      snapshotComparisonInput({
        scope: f.scope,
        comparison: fixed.source,
        diffs: [{ ...f.worktree, oldObjectId: 'e'.repeat(40) }],
      }).files[0],
    ).toEqual({ kind: 'no-text', reason: 'unavailable' })
  expect(parse({ ...f.worktree, path: 'other/source.ts' })).toEqual({
    kind: 'no-text',
    reason: 'unavailable',
  })
})

test('reentrant publication keeps captured reads intact and finishes at the newest shared capture', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const secondInput = { ...f.input }
  const thirdInput = { ...f.input }
  let nested = false
  let observe = false
  const service = new WorkspaceDocumentService(() => {
    if (!observe || nested) return
    nested = true
    const interest = service.state().snapshotComparisonTabs.get(tabId('source'))
    if (interest) interest.refresh(thirdInput, interest.requestRefresh())
  }, f.scope.environmentId)
  const first = service.prepareSnapshotComparisonTab(tabId('source'), {
    input: f.input,
    signal: new AbortController().signal,
  })
  const second = service.acquireSnapshotComparison({
    input: f.input,
    signal: new AbortController().signal,
  })
  const oldRead = first.read()
  observe = true
  expect(first.refresh(secondInput, first.requestRefresh())).toBe(true)
  const latest = second.read()
  expect(latest).toBe(first.read())
  if (latest.kind === 'ready') expect(latest.input).toBe(thirdInput)
  if (oldRead.kind === 'ready') expect(oldRead.input).toBe(f.input)
  const old = first.requestRefresh()
  const newer = second.requestRefresh()
  expect(first.refresh(secondInput, old)).toBe(false)
  expect(second.refresh(thirdInput, newer)).toBe(true)
  service.dispose()
})

for (const change of ['added', 'deleted', 'renamed'] as const) {
  test(`real ${change} input preserves missing sides and paths`, async ({ server, client }) => {
    const f = await createSnapshotComparisonFixture(server.root, client)
    const repo = join(server.root, 'repo')
    let path = f.path
    let staged = false
    if (change === 'added') {
      path = filesystemPath(f.comparison.target.path.replace('source.ts', 'added.ts'))
      await writeFile(join(repo, 'added.ts'), 'export const added = true\n')
    }
    if (change === 'deleted') await unlink(join(repo, 'source.ts'))
    if (change === 'renamed') {
      await writeFile(join(repo, 'rename-source.ts'), 'export const rename = true\n')
      runGit(repo, ['add', 'rename-source.ts'])
      runGit(repo, ['commit', '-m', 'rename source'])
      runGit(repo, ['mv', 'rename-source.ts', 'renamed.ts'])
      path = filesystemPath(f.comparison.target.path.replace('source.ts', 'renamed.ts'))
      staged = true
    }
    const [diff] = await fetchDiff(path, staged, undefined, client)
    const target = diff
      ? snapshotDocument(diff, f.scope.rootPath, staged ? 'staged' : 'worktree')
      : null
    expect(target?.source.kind).toBe('snapshot')
    if (!target || target.source.kind !== 'snapshot' || !diff) return
    const input = snapshotComparisonInput({
      scope: f.scope,
      comparison: target.source,
      diffs: [diff],
    })
    const file = input.files[0]
    expect(file?.kind).toBe('full')
    if (file?.kind !== 'full') return
    expect(file.old.kind).toBe(change === 'added' ? 'missing' : 'blob')
    expect(file.new.kind).toBe(change === 'deleted' ? 'missing' : 'blob')
    if (change === 'renamed') expect(file.old.path).not.toBe(file.new.path)
  })
}

test('a newly admitted complete capture updates an earlier partial interest and invalidates its pending refresh', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const partial = snapshotComparisonInput({
    scope: f.scope,
    comparison: f.comparison,
    diffs: [{ ...f.worktree, oldText: undefined, newText: undefined }],
  })
  const service = new WorkspaceDocumentService(() => undefined, f.scope.environmentId)
  const first = service.acquireSnapshotComparison({
    input: partial,
    signal: new AbortController().signal,
  })
  const oldRead = first.read()
  const oldRequest = first.requestRefresh()
  const second = service.acquireSnapshotComparison({
    input: f.input,
    signal: new AbortController().signal,
  })
  expect(first.read()).toBe(second.read())
  const latest = first.read()
  expect(latest).toMatchObject({ kind: 'ready', input: { kind: 'snapshot' } })
  if (latest.kind === 'ready' && latest.input.kind === 'snapshot')
    expect(latest.input.files[0]?.kind).toBe('full')
  expect(oldRead).toMatchObject({ kind: 'ready', input: { kind: 'snapshot' } })
  if (oldRead.kind === 'ready' && oldRead.input.kind === 'snapshot')
    expect(oldRead.input.files[0]?.kind).toBe('partial')
  expect(first.refresh(partial, oldRequest)).toBe(false)
  service.dispose()
})

test('scope separates workspace interests and foreign or canceled adoption cannot enter the owner', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const service = new WorkspaceDocumentService(() => undefined, f.scope.environmentId)
  const aborted = new AbortController()
  aborted.abort()
  expect(
    service.acquireSnapshotComparison({ input: f.input, signal: aborted.signal }).read().kind,
  ).toBe('released')
  expect(service.state().snapshotComparisons.size).toBe(0)
  const first = service.acquireSnapshotComparison({
    input: f.input,
    signal: new AbortController().signal,
  })
  const otherRoot = filesystemPath('other-workspace')
  const mismatched = { ...f.input, scope: { ...f.scope, rootPath: otherRoot } }
  expect(() =>
    service.acquireSnapshotComparison({ input: mismatched, signal: new AbortController().signal }),
  ).toThrow('does not match')
  const scoped = snapshotComparisonInput({
    scope: { ...f.scope, rootPath: otherRoot },
    comparison: { ...f.comparison, target: { ...f.comparison.target, rootPath: otherRoot } },
    diffs: [f.worktree],
  })
  const second = service.acquireSnapshotComparison({
    input: scoped,
    signal: new AbortController().signal,
  })
  expect(first.read()).not.toBe(second.read())
  const read = first.read()
  for (let index = 0; index < 100; index++) expect(first.read()).toBe(read)
  const foreign = { ...f.input, scope: { ...f.scope, environmentId: fixtureEnvironmentId(2) } }
  expect(() =>
    service.acquireSnapshotComparison({ input: foreign, signal: new AbortController().signal }),
  ).toThrow('different environment')
  const request = first.requestRefresh()
  expect(first.refresh(foreign, request)).toBe(false)
  expect(first.refresh(scoped, request)).toBe(false)
  expect(first.refresh(f.input, request)).toBe(true)
  expect(service.state().snapshotComparisons.size).toBe(2)
  service.dispose()
  expect(service.state().snapshotComparisons.size).toBe(0)
})
