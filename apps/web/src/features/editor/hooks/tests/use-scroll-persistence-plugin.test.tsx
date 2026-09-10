import { act, renderHook } from '@testing-library/react'
import type {
  EditorPlugin,
  EditorPluginContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapor/core'
import { afterEach, vi } from 'vitest'

import { useScrollPersistencePlugin } from '@/features/editor/hooks/use-scroll-persistence-plugin'
import { expect, test } from '../../../../../test/fixtures'

afterEach(() => vi.unstubAllGlobals())

test('a deferred snapshot keeps the callback that owned its document', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1
    frames.set(nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  const firstOwner = vi.fn()
  const secondOwner = vi.fn()
  const hook = renderHook(
    ({ path, onChange }) =>
      useScrollPersistencePlugin({
        document: { path },
        onScrollPositionChange: onChange,
      }),
    { initialProps: { onChange: firstOwner, path: '/repo/a.ts' } },
  )
  const contribution = activate(hook.result.current)

  contribution.update(snapshot('/repo/a.ts', 1_962), 'viewport')
  hook.rerender({ onChange: secondOwner, path: '/repo/b.ts' })
  flushFirstFrame(frames)

  expect(firstOwner).toHaveBeenCalledWith('/repo/a.ts', { left: 0, top: 1_962 })
  expect(secondOwner).not.toHaveBeenCalled()
})

test('persists the bottom row at the viewport bottom instead of the trailing empty area', () => {
  const onChange = vi.fn()
  const hook = renderHook(() =>
    useScrollPersistencePlugin({
      document: { path: '/repo/a.ts' },
      onScrollPositionChange: onChange,
    }),
  )
  const contribution = activate(hook.result.current)

  contribution.update(snapshot('/repo/a.ts', 3_980), 'viewport')
  contribution.dispose?.()

  expect(onChange).toHaveBeenCalledWith('/repo/a.ts', { left: 0, top: 3_400 })
})

function activate(plugin: EditorPlugin): EditorViewContribution {
  let provider: EditorViewContributionProvider | null = null
  plugin.activate({
    registerViewContribution: (registered) => {
      provider = registered
      return { dispose: () => undefined }
    },
  } as EditorPluginContext)

  expect(provider).not.toBeNull()
  return provider!.createContribution({} as EditorViewContributionContext)!
}

function snapshot(documentId: string, scrollTop: number): EditorViewSnapshot {
  return {
    documentId,
    totalHeight: 4_000,
    viewport: {
      clientHeight: 600,
      scrollLeft: 0,
      scrollTop,
    },
  } as EditorViewSnapshot
}

function flushFirstFrame(frames: Map<number, FrameRequestCallback>): void {
  const callback = frames.values().next().value
  expect(callback).toBeDefined()
  frames.clear()
  act(() => callback?.(0))
}
