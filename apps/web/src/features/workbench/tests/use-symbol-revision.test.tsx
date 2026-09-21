import { createEditorBufferSession } from '@singapore-editor/core/document'
import { act, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { useSymbolRevision } from '@/features/workbench/hooks/use-symbol-revision'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'

const firstFile = {
  content: 'const value = 1\n',
  mtimeMs: 1,
  path: filesystemPath('/repo/a.ts'),
  size: 16,
  version: 'v1',
}

test('a content burst publishes only its settled revision and latest buffer', async () => {
  const store = createEditorDocumentStore()
  const document = store.getState().ensureLiveEditorDocument(firstFile)
  const session = createEditorBufferSession(document.buffer)
  let renders = 0
  const rendered = renderHookWithProviders(() => {
    renders += 1
    return useSymbolRevision(store, document.key)
  })
  await waitFor(() =>
    expect(rendered.result.current).toBe(store.getState().documentContentRevisions[document.key]),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const originalRevision = rendered.result.current
    const initialRenders = renders
    for (const text of ['one ', 'two ', 'three ']) {
      act(() => session.applyText(text))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(rendered.result.current).toBe(originalRevision)
      expect(renders).toBe(initialRenders)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(rendered.result.current).toBe(store.getState().documentContentRevisions[document.key])
    expect(rendered.result.current).not.toBe(originalRevision)
    expect(document.buffer.materializeFullText()).toBe('const value = 1\none two three ')
    expect(renders).toBe(initialRenders + 1)
  } finally {
    rendered.unmount()
    vi.useRealTimers()
  }
})

test('switching documents cancels the old burst and unmounting cancels the new one', async () => {
  const store = createEditorDocumentStore()
  const first = store.getState().ensureLiveEditorDocument(firstFile)
  const second = store
    .getState()
    .ensureLiveEditorDocument({ ...firstFile, path: filesystemPath('/repo/b.ts') })
  const firstSession = createEditorBufferSession(first.buffer)
  const secondSession = createEditorBufferSession(second.buffer)
  const rendered = renderHookWithProviders(({ key }) => useSymbolRevision(store, key), {
    initialProps: { key: first.key },
  })
  await waitFor(() =>
    expect(rendered.result.current).toBe(store.getState().documentContentRevisions[first.key]),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    act(() => firstSession.applyText('old '))
    rendered.rerender({ key: second.key })
    expect(rendered.result.current).toBe(store.getState().documentContentRevisions[second.key])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(rendered.result.current).toBe(store.getState().documentContentRevisions[second.key])

    act(() => secondSession.applyText('pending '))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    rendered.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    rendered.unmount()
    vi.useRealTimers()
  }
})
