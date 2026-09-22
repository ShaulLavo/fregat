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
import type { DiffReloadView } from '@/features/git/utils/reload-schema'

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
  captureDiffView(owner, gitReloadGeneration(owner), 'old:new', diffView)

  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedGitView(reloaded, 'repo')?.scrollTop).toBe(320)
  expect(savedDiffView(reloaded, 'old:new')?.expanded).toEqual(['gap'])
  expect(savedDiffView(reloaded, 'old:new')?.oldSelections?.[0]?.headOffset).toBe(5)
  expect(savedDiffView(reloaded, 'other')).toBeUndefined()

  prepareGitReload(reloaded, storage, 'other-repo')
  expect(savedGitView(reloaded, 'repo')).toBeUndefined()
})

test('a diff view captured against a superseded generation is dropped', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  const generation = gitReloadGeneration(owner)
  prepareGitReload(owner, storage, 'repo')
  captureDiffView(owner, generation, 'superseded:identity', diffView)
  expect(savedDiffView(owner, 'superseded:identity')).toBeUndefined()
})
