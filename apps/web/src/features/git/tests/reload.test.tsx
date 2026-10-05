import * as v from 'valibot'
import { gitSnapshotTargetSchema, gitInputRevisionSchema } from '@workspace/contracts'
import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import {
  captureDiffView,
  captureGitView,
  gitReloadGeneration,
  prepareGitReload,
  savedDiffView,
  savedGitView,
} from '@/features/git/state/reload'
import type { DiffReloadView, DiffReloadIdentity } from '@/features/git/utils/reload-schema'

const checkpointIdentity: DiffReloadIdentity = { kind: 'checkpoint', identity: 'old:new' }
const diffView: DiffReloadView = {
  expanded: ['gap'],
  old: { top: 620, left: 0 },
  new: null,
  stacked: null,
  oldSelections: [
    { anchorOffset: 5, headOffset: 5, startOffset: 5, endOffset: 5, affinity: 'before' },
  ],
}

test('Git view state survives a reload, and a different root does not claim it', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  captureGitView(owner, 'repo', { activeId: 'worktree:a.ts', scrollTop: 320 })
  captureDiffView(owner, gitReloadGeneration(owner), checkpointIdentity, diffView)

  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedGitView(reloaded, 'repo')?.scrollTop).toBe(320)
  expect(savedDiffView(reloaded, checkpointIdentity)?.expanded).toEqual(['gap'])
  expect(savedDiffView(reloaded, checkpointIdentity)?.oldSelections?.[0]?.headOffset).toBe(5)
  expect(savedDiffView(reloaded, { kind: 'checkpoint', identity: 'other' })).toBeUndefined()

  prepareGitReload(reloaded, storage, 'other-repo')
  expect(savedGitView(reloaded, 'repo')).toBeUndefined()
})

test('a diff view captured against a superseded generation is dropped', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  const generation = gitReloadGeneration(owner)
  prepareGitReload(owner, storage, 'repo')
  captureDiffView(
    owner,
    generation,
    { kind: 'checkpoint', identity: 'superseded:identity' },
    diffView,
  )
  expect(
    savedDiffView(owner, { kind: 'checkpoint', identity: 'superseded:identity' }),
  ).toBeUndefined()
})

test('an old diff slot drops without losing the valid root and list record', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  storage.setItem(
    'git.view.v1',
    JSON.stringify({
      root: 'repo',
      list: { activeId: 'worktree:a.ts', scrollTop: 320 },
      diff: { identity: 'old:new', view: diffView },
    }),
  )
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  expect(savedGitView(owner, 'repo')).toEqual({ activeId: 'worktree:a.ts', scrollTop: 320 })
  expect(savedDiffView(owner, checkpointIdentity)).toBeUndefined()
})

test('moving reload offsets restore only for the same semantic target and admitted pair', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  const target = v.parse(gitSnapshotTargetSchema, {
    kind: 'moving',
    rootPath: 'repo',
    path: 'repo/a.ts',
    changeSource: 'worktree',
  })
  const revision = v.parse(gitInputRevisionSchema, {
    old: { kind: 'blob', objectId: 'a'.repeat(40) },
    new: { kind: 'blob', objectId: 'b'.repeat(40) },
    oldPath: 'repo/a.ts',
    status: 'modified',
  })
  const identity: DiffReloadIdentity = { kind: 'snapshot', target, revision }
  prepareGitReload(owner, storage, 'repo')
  captureDiffView(owner, gitReloadGeneration(owner), identity, diffView)
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedDiffView(reloaded, identity)).toEqual(diffView)
  const changed = v.parse(gitInputRevisionSchema, {
    ...revision,
    new: { kind: 'blob', objectId: 'c'.repeat(40) },
  })
  expect(savedDiffView(reloaded, { ...identity, revision: changed })).toBeUndefined()
  const staged = v.parse(gitSnapshotTargetSchema, { ...target, changeSource: 'staged' })
  expect(savedDiffView(reloaded, { ...identity, target: staged })).toBeUndefined()
})
