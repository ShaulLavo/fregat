import { fetchDiff } from '@/lib/git-diff-query'
import { snapshotComparison } from '../../../../../test/factories/git-diff'
import { runGit } from '../../../../../test/factories/git'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, waitFor } from '@testing-library/react'
import { useShownComparisonTab } from '@/features/workbench/hooks/use-shown-comparison-tab'
import { fileResource, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import type { EditorTabRecord } from '@/lib/documents/utils/types'
import { expect, test } from '../../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../../test/render'
import { createObservedInProcessClient } from '../../../../../test/client'
import { installTestClient } from '../../../../../test/factories/client-binding'

// Delaying the real read also exercises the saved-file query's cache and error settlement.
test('holds the complete tab through a read and skips a superseded selection', async ({
  client,
  server,
}) => {
  void client
  await mkdir(path.join(server.root, 'repo'), { recursive: true })
  for (const name of ['a', 'b', 'c'])
    await writeFile(path.join(server.root, `repo/${name}.txt`), name)
  const tabs: EditorTabRecord[] = ['a', 'b', 'c'].map((name) => ({
    id: tabId(name),
    content: {
      kind: 'document',
      document: { kind: 'compare-saved', file: fileResource(filesystemPath(`repo/${name}.txt`)) },
    },
  }))
  const gate = Promise.withResolvers<void>()
  const restore = installTestClient(
    createObservedInProcessClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/fs/read' && url.searchParams.get('path') === 'repo/b.txt')
        return gate.promise
    }),
  )
  try {
    const { result, rerender } = renderHookWithProviders(useShownComparisonTab, {
      initialProps: tabs[0]!,
    })
    await waitFor(() => expect(result.current.pending).toBe(false))
    rerender(tabs[1]!)
    expect(result.current).toEqual({ shown: tabs[0], pending: true })
    rerender(tabs[2]!)
    await waitFor(() => expect(result.current).toEqual({ shown: tabs[2], pending: false }))
    await act(async () => gate.resolve())
    expect(result.current.shown).toBe(tabs[2])
  } finally {
    gate.resolve()
    restore()
  }
})

test('releases a held tab when the next saved file fails', async ({ client, server }) => {
  void client
  await writeFile(path.join(server.root, 'a.txt'), 'a')
  const first: EditorTabRecord = {
    id: tabId('a'),
    content: {
      kind: 'document',
      document: { kind: 'compare-saved', file: fileResource(filesystemPath('a.txt')) },
    },
  }
  const missing: EditorTabRecord = {
    id: tabId('b'),
    content: {
      kind: 'document',
      document: { kind: 'compare-saved', file: fileResource(filesystemPath('missing.txt')) },
    },
  }
  const { result, rerender } = renderHookWithProviders(useShownComparisonTab, {
    initialProps: first,
  })
  await waitFor(() => expect(result.current.pending).toBe(false))
  rerender(missing)
  expect(result.current.shown).toBe(first)
  await waitFor(() => expect(result.current).toEqual({ shown: missing, pending: false }), {
    timeout: 10_000,
  })
})

test('keeps the previous Git comparison until its complete blob is read', async ({
  client,
  server,
}) => {
  const repo = path.join(server.root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '--quiet'])
  runGit(repo, ['config', 'user.email', 'fixture@example.com'])
  runGit(repo, ['config', 'user.name', 'Fixture'])
  for (const name of ['a', 'b']) await writeFile(path.join(repo, `${name}.txt`), `${name} before`)
  runGit(repo, ['add', '.'])
  runGit(repo, ['commit', '--quiet', '-m', 'fixture'])
  for (const name of ['a', 'b']) await writeFile(path.join(repo, `${name}.txt`), `${name} after`)
  const diffs = await Promise.all(
    ['a', 'b'].map((name) => fetchDiff(`repo/${name}.txt`, false, undefined, client)),
  )
  const tabs: EditorTabRecord[] = diffs.map(([diff], index) => ({
    id: tabId(String(index)),
    content: {
      kind: 'document',
      document: { kind: 'git-diff', source: snapshotComparison(diff!) },
    },
  }))
  const gate = Promise.withResolvers<void>()
  const restore = installTestClient(
    createObservedInProcessClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/git/diff/blob' && url.searchParams.get('path') === 'repo/b.txt')
        return gate.promise
    }),
  )
  try {
    const { result, rerender } = renderHookWithProviders(useShownComparisonTab, {
      initialProps: tabs[0]!,
    })
    await waitFor(() => expect(result.current.pending).toBe(false))
    rerender(tabs[1]!)
    expect(result.current).toEqual({ shown: tabs[0], pending: true })
    await act(async () => gate.resolve())
    await waitFor(() => expect(result.current).toEqual({ shown: tabs[1], pending: false }))
  } finally {
    gate.resolve()
    restore()
  }
})
