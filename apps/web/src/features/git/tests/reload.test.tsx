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
  takeSavedDiffView,
  savedGitView,
} from '@/features/git/state/reload'
import type { DiffReloadView, DiffReloadIdentity } from '@/features/git/utils/reload-schema'

const checkpointIdentity: DiffReloadIdentity = { kind: 'checkpoint', identity: 'old:new' }
const caret = { kind: 'source', side: 'old', line: 30, character: 5 } as const
const diffView: DiffReloadView = {
  expanded: ['gap'],
  old: {
    selections: [{ anchor: caret, head: caret, affinity: 'before' }],
    viewport: { anchor: caret, withinRow: 2 },
    left: 0,
  },
  new: null,
  stacked: null,
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
  expect(takeSavedDiffView(reloaded, { kind: 'checkpoint', identity: 'other' })).toBeUndefined()
  const taken = takeSavedDiffView(reloaded, checkpointIdentity)
  expect(taken?.expanded).toEqual(['gap'])
  expect(taken?.old?.selections[0]?.head).toEqual(caret)

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
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(
    takeSavedDiffView(reloaded, { kind: 'checkpoint', identity: 'superseded:identity' }),
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
  expect(takeSavedDiffView(owner, checkpointIdentity)).toBeUndefined()
})

test('a diff slot saved as pixel offsets drops instead of migrating', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  storage.setItem(
    'git.view.v1',
    JSON.stringify({
      root: 'repo',
      diff: {
        identity: checkpointIdentity,
        view: { expanded: [], old: { top: 620, left: 0 }, new: null, stacked: null },
      },
    }),
  )
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  expect(takeSavedDiffView(owner, checkpointIdentity)).toBeUndefined()
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
  const changed = v.parse(gitInputRevisionSchema, {
    ...revision,
    new: { kind: 'blob', objectId: 'c'.repeat(40) },
  })
  expect(takeSavedDiffView(reloaded, { ...identity, revision: changed })).toBeUndefined()
  const staged = v.parse(gitSnapshotTargetSchema, { ...target, changeSource: 'staged' })
  expect(takeSavedDiffView(reloaded, { ...identity, target: staged })).toBeUndefined()
  expect(takeSavedDiffView(reloaded, identity)).toEqual(diffView)
})

test('a saved diff view is handed out once per page load, never refreshed by later captures', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  captureDiffView(owner, gitReloadGeneration(owner), checkpointIdentity, diffView)

  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(takeSavedDiffView(reloaded, checkpointIdentity)).toEqual(diffView)
  expect(takeSavedDiffView(reloaded, checkpointIdentity)).toBeUndefined()
  captureDiffView(reloaded, gitReloadGeneration(reloaded), checkpointIdentity, {
    ...diffView,
    expanded: ['later'],
  })
  expect(takeSavedDiffView(reloaded, checkpointIdentity)).toBeUndefined()

  const next = new QueryClient()
  prepareGitReload(next, storage, 'repo')
  expect(takeSavedDiffView(next, checkpointIdentity)?.expanded).toEqual(['later'])
})
