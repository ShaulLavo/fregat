import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { onlineManager } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'

import { useStagePathsMutation } from '@/features/git/hooks/use-stage-paths-mutation'
import {
  commitProgressStoreFor,
  selectCommitProgress,
} from '@/features/git/state/commit-progress-store'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'

import { createInProcessClient } from '../../../../../test/client'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'
import { makeTestServer } from '../../../../../test/server'

test('a queued Git mutation resumes on its owning server after the active server switches', async ({
  client,
  server,
}) => {
  expect(client).toBeDefined()
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const secondClient = createInProcessClient(secondServer)
  for (const root of [server.root, secondServer.root]) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' })
    await writeFile(path.join(root, 'shared.txt'), 'belongs to this checkout\n')
  }

  const origin = activeServerOrigin()
  const wasOnline = onlineManager.isOnline()
  const { result, queryClient, unmount } = renderHookWithProviders(() =>
    useStagePathsMutation(['shared.txt'], ''),
  )
  onlineManager.setOnline(false)
  const staged = result.current.mutateAsync()
  await waitFor(() => expect(result.current.isPaused).toBe(true))
  setActiveServerOrigin('http://localhost:3413')
  const previousClient = getClient()
  setClient(secondClient)

  try {
    await act(async () => {
      onlineManager.setOnline(true)
      await staged
    })

    expect(
      execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: server.root,
        encoding: 'utf8',
      }).trim(),
    ).toBe('shared.txt')
    expect(
      execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: secondServer.root,
        encoding: 'utf8',
      }).trim(),
    ).toBe('')
  } finally {
    unmount()
    queryClient.clear()
    onlineManager.setOnline(wasOnline)
    setClient(previousClient)
    setActiveServerOrigin(origin)
    await secondServer.cleanup()
  }
})

test('commit output for the same checkout path stays with its query client', () => {
  const first = createTestQueryClient()
  const second = createTestQueryClient()
  const progressA = commitProgressStoreFor(first)
  const progressB = commitProgressStoreFor(second)

  progressA.getState().beginCommitProgress('repo', null)
  progressA.getState().appendCommitProgress('repo', { stream: 'stdout', text: 'A hook running' })
  expect(selectCommitProgress(progressB.getState(), 'repo')).toEqual([])
  progressB.getState().clearCommitProgress('repo')
  expect(selectCommitProgress(progressA.getState(), 'repo')).toEqual([
    { stream: 'stdout', text: 'A hook running' },
  ])
  expect(commitProgressStoreFor(first)).toBe(progressA)
})
