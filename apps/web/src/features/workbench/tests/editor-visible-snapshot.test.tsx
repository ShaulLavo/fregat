import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import type {
  EditorPlugin,
  EditorPluginContext,
  EditorTextBuffer,
  EditorViewContribution,
  EditorViewContributionProvider,
  EditorViewSnapshot,
  EditorVisibleSnapshotJSON,
} from '@singapor/core'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { StrictMode, useLayoutEffect } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'

import { EditorVisibleSnapshot } from '@/features/workbench/components/editor-visible-snapshot'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import {
  editorVisibleSnapshotCounts,
  editorVisibleSnapshotSegments,
} from '@/features/workbench/utils/editor-visible-snapshot'
import {
  readEditorVisibleSnapshotCache,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'
import { expect, test } from '../../../../test/fixtures'

const ROOT_PATH = '/repo'
const PATH = '/repo/src/app.ts'
const THEME_ID = 'dark-plus'
const CONTENT_VERSION = 'stat:1:15'

beforeEach(() => {
  localStorage.clear()
  performance.clearMarks()
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => window.clearTimeout(frame))
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  performance.clearMarks()
})

test('scroll bursts materialize only the last terminal viewport after the debounce', () => {
  const buffer = controlledBuffer()
  const { binding, contribution, result } = mountedCapture(buffer)
  const first = runtimeSnapshot('document-1')
  const latest = runtimeSnapshot('document-1')

  act(() => {
    contribution.update(first.snapshot, 'viewport')
    vi.advanceTimersByTime(200)
    contribution.update(latest.snapshot, 'selection')
    vi.advanceTimersByTime(349)
  })
  expect(first.materialize).not.toHaveBeenCalled()
  expect(latest.materialize).not.toHaveBeenCalled()

  act(() => vi.advanceTimersByTime(1))

  expect(first.materialize).not.toHaveBeenCalled()
  expect(latest.materialize).toHaveBeenCalledTimes(1)
  expect(readMatching()).toMatchObject({ path: PATH, rootPath: ROOT_PATH, themeId: THEME_ID })
  expect(result.current.additionalPlugins).toBe(binding.additionalPlugins)
})

test('a child-layout initial contribution still waits for the capture debounce', () => {
  const buffer = controlledBuffer()
  const initial = runtimeSnapshot('document-1')

  render(<CaptureMountHarness buffer={buffer} snapshot={initial.snapshot} />)
  expect(initial.materialize).not.toHaveBeenCalled()

  act(() => vi.advanceTimersByTime(349))
  expect(initial.materialize).not.toHaveBeenCalled()

  act(() => vi.advanceTimersByTime(1))
  expect(initial.materialize).toHaveBeenCalledTimes(1)
})

test('unsupported paint diagnostics distinguish plugin CSS from widget paint', () => {
  const diagnostics: Array<{
    readonly detail?: Readonly<Record<string, unknown>>
    readonly name: string
  }> = []
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', {
    enabled: true,
    record: (diagnostic: (typeof diagnostics)[number]) => diagnostics.push(diagnostic),
  })
  const harness = mountedCapture(controlledBuffer())
  const pluginCss = unsupportedRuntimeSnapshot('unreplayable-plugin-css')
  const widget = unsupportedRuntimeSnapshot('unreplayable-widget')

  act(() => {
    harness.contribution.update(pluginCss, 'layout')
    vi.advanceTimersByTime(350)
    harness.contribution.update(widget, 'layout')
    vi.advanceTimersByTime(350)
  })

  expect(
    diagnostics
      .filter(({ name }) => name === 'editor.visible_snapshot.capture')
      .map(({ detail }) => detail?.outcome),
  ).toEqual(['unreplayable-plugin-css', 'unreplayable-widget'])
})

test('a held document flushes under its own path before a newly selected path takes ownership', () => {
  const buffer = controlledBuffer()
  const harness = mountedCapture(buffer)
  const old = runtimeSnapshot('document-1')

  act(() => harness.contribution.update(old.snapshot, 'tokens'))
  harness.rerender({
    active: true,
    appliedThemeId: THEME_ID,
    committedThemeId: THEME_ID,
    contentVersion: CONTENT_VERSION,
    documentId: 'document-1',
    fileReadError: false,
    path: '/repo/src/next.ts',
    renderedPath: PATH,
    selectedThemeId: THEME_ID,
  })

  expect(old.materialize).toHaveBeenCalledTimes(1)
  expect(readMatching()).not.toBeNull()
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      path: '/repo/src/next.ts',
      rootPath: ROOT_PATH,
      themeId: THEME_ID,
    }),
  ).toBeNull()

  const stale = runtimeSnapshot('document-1')
  act(() => {
    harness.contribution.update(stale.snapshot, 'viewport')
    vi.advanceTimersByTime(400)
  })
  expect(stale.materialize).not.toHaveBeenCalled()
})

test('dirty state removes both a matching cold record and its rendered overlay', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, documentId: 'document-1' })
  act(() => buffer.setDirty(true))

  expect(result.current.record).toBeNull()
  expect(readMatching()).toBeNull()
})

test('a cached selected file never paints above a different held document', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, documentId: 'held-document', renderedPath: '/repo/src/held.ts' })
  expect(result.current.record).toBeNull()

  rerender({ ...options, documentId: 'document-1' })
  expect(result.current.record).not.toBeNull()
})

test('the first render presents cached text before the content version is known', () => {
  const snapshot = cachedSnapshot()
  writeEditorVisibleSnapshotCache(testScopedStorage, snapshot)
  const buffer = controlledBuffer()
  const options = { ...hookOptions({ buffer, documentId: null }), contentVersion: null }
  const renderedRecords: Array<CachedEditorVisibleSnapshot | null> = []

  renderHook(
    (props: HookProps) => {
      const binding = useEditorVisibleSnapshot(toHookOptions(props, buffer))
      renderedRecords.push(binding.record)
      return binding
    },
    { initialProps: options },
  )

  expect(renderedRecords[0]).toEqual(snapshot)
  expect(renderedRecords[0]?.snapshot.rows[0]?.chunks[0]?.parts).toEqual([
    { kind: 'text', text: 'const value = 1' },
  ])
})

test('a matching content version preserves the unverified frame and its presentation deadline', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options: HookProps = {
    ...hookOptions({ buffer, documentId: null }),
    contentVersion: null,
  }
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  const initialRecord = result.current.record
  expect(initialRecord).not.toBeNull()

  act(() => vi.advanceTimersByTime(1_000))
  rerender({ ...options, contentVersion: CONTENT_VERSION })

  expect(result.current.record).toBe(initialRecord)
  act(() => vi.advanceTimersByTime(499))
  expect(result.current.record).toBe(initialRecord)
  expect(mark.mock.calls.filter(([name]) => name === 'editor.cached_visible_paint')).toHaveLength(1)

  act(() => vi.advanceTimersByTime(1))
  expect(result.current.record).toBeNull()
})

test('a mismatched content version dismisses an unverified cached frame', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options: HookProps = {
    ...hookOptions({ buffer, documentId: null }),
    contentVersion: null,
  }
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, contentVersion: 'stat:2:15' })

  expect(result.current.record).toBeNull()
  rerender(options)
  expect(result.current.record).toBeNull()
})

test('content version arrival never restores an unverified frame dismissed by interaction', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options: HookProps = {
    ...hookOptions({ buffer, documentId: null }),
    contentVersion: null,
  }
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  act(() => result.current.dismissOverlay())
  expect(result.current.record).toBeNull()
  rerender({ ...options, contentVersion: CONTENT_VERSION })

  expect(result.current.record).toBeNull()
  expect(readMatching()).not.toBeNull()
})

test('a file-read error dismisses and removes an unverified cached frame', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = { ...hookOptions({ buffer, documentId: null }), contentVersion: null }
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, fileReadError: true })

  expect(result.current.record).toBeNull()
  expect(readMatching()).toBeNull()
})

test('an unverified cached frame never covers an already dirty live document', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  buffer.setDirty(true)
  const options = { ...hookOptions({ buffer, documentId: 'document-1' }), contentVersion: null }
  const { result } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )

  expect(result.current.record).toBeNull()
  expect(readMatching()).toBeNull()
})

test('a cached frame with a different content version is never presented', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: { ...options, contentVersion: 'stat:2:15' } },
  )

  expect(result.current.record).toBeNull()
  expect(readMatching()).not.toBeNull()
})

test('theme previews and committed themes that are not yet applied never persist', () => {
  const buffer = controlledBuffer()
  const preview = mountedCapture(buffer, {
    appliedThemeId: THEME_ID,
    committedThemeId: THEME_ID,
    selectedThemeId: 'theme-preview',
  })
  const previewSnapshot = runtimeSnapshot('document-1')

  act(() => {
    preview.contribution.update(previewSnapshot.snapshot, 'tokens')
    vi.advanceTimersByTime(400)
  })
  expect(previewSnapshot.materialize).not.toHaveBeenCalled()
  preview.unmount()

  const pending = mountedCapture(buffer, {
    appliedThemeId: 'old-theme',
    committedThemeId: THEME_ID,
    selectedThemeId: THEME_ID,
  })
  const pendingSnapshot = runtimeSnapshot('document-1')
  act(() => {
    pending.contribution.update(pendingSnapshot.snapshot, 'tokens')
    vi.advanceTimersByTime(400)
  })

  expect(pendingSnapshot.materialize).not.toHaveBeenCalled()
  expect(readMatching()).toBeNull()
})

test('preview cancellation does not resurrect an already-attempted cold frame', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, selectedThemeId: 'theme-preview' })
  expect(result.current.record).toBeNull()

  rerender(options)
  expect(result.current.record).toBeNull()
  expect(readMatching()).not.toBeNull()
})

test('a file-read error removes the matching cached frame', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  rerender({ ...options, fileReadError: true })

  expect(result.current.record).toBeNull()
  expect(readMatching()).toBeNull()
})

test('terminal paint dismisses only on the matching next frame', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()
  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)

  act(() => {
    contribution.update(runtimeSnapshot('document-1').snapshot, 'document')
    const textPaint = {
      documentGeneration: 7,
      documentId: 'document-1',
      phase: 'text',
      textVersion: 1,
    } as const
    result.current.onInitialPaint(textPaint)
    result.current.onInitialPaint({
      documentGeneration: 7,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'painted',
      textVersion: 1,
    })
  })
  expect(result.current.record).not.toBeNull()

  act(() => vi.advanceTimersByTime(16))
  expect(result.current.record).not.toBeNull()
  expect(mark.mock.calls.filter(([name]) => name === 'editor.cached_visible_paint')).toHaveLength(1)
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_text_paint'),
  ).toHaveLength(0)

  act(() => vi.advanceTimersByTime(16))
  expect(result.current.record).toBeNull()
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_text_paint'),
  ).toHaveLength(1)
  const highlight = mark.mock.calls.find(
    ([name]) => name === 'editor.authoritative_highlight_paint',
  )
  expect(highlight?.[1]).toMatchObject({ detail: { status: 'painted' } })
})

test('highlighted text keeps the cached frame until matching paint layers are ready', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)
  const ready = runtimeSnapshot('document-1').snapshot

  act(() => {
    contribution.update({ ...ready, paintLayers: null }, 'document')
    emitSuccessfulPaint(result.current.onInitialPaint, 7)
    vi.advanceTimersByTime(64)
  })
  expect(result.current.record).not.toBeNull()

  act(() => {
    contribution.update(runtimeSnapshot('another-document').snapshot, 'layout')
    vi.advanceTimersByTime(32)
  })
  expect(result.current.record).not.toBeNull()

  act(() => {
    contribution.update(runtimeSnapshot('document-1', 2).snapshot, 'layout')
    vi.advanceTimersByTime(32)
  })
  expect(result.current.record).not.toBeNull()

  act(() => {
    contribution.update(ready, 'layout')
    vi.advanceTimersByTime(32)
  })
  expect(result.current.record).toBeNull()
})

test('interaction dismissal preserves the authoritative paint pipeline', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)

  act(() => {
    contribution.update(runtimeSnapshot('document-1').snapshot, 'document')
    result.current.onInitialPaint({
      documentGeneration: 12,
      documentId: 'document-1',
      phase: 'text',
      textVersion: 1,
    })
    result.current.dismissOverlay()
    result.current.onInitialPaint({
      documentGeneration: 12,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'painted',
      textVersion: 1,
    })
    vi.advanceTimersByTime(16)
  })

  expect(result.current.record).toBeNull()
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_highlight_paint'),
  ).toHaveLength(1)
})

test('a terminal paint error dismisses the cache while paint layers remain pending', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)

  act(() => {
    contribution.update(
      { ...runtimeSnapshot('document-1').snapshot, paintLayers: null },
      'document',
    )
    result.current.onInitialPaint({
      documentGeneration: 7,
      documentId: 'document-1',
      phase: 'text',
      textVersion: 1,
    })
    result.current.onInitialPaint({
      documentGeneration: 7,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'error',
      textVersion: 1,
    })
    vi.advanceTimersByTime(64)
  })

  expect(result.current.record).toBeNull()
})

test('plain paint survives provider loading and a later painted event remains authoritative', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)
  const replacement = runtimeSnapshot('document-1', 2)

  act(() => {
    contribution.update(runtimeSnapshot('document-1').snapshot, 'document')
    result.current.onInitialPaint({
      documentGeneration: 8,
      documentId: 'document-1',
      phase: 'text',
      textVersion: 1,
    })
    result.current.onInitialPaint({
      documentGeneration: 8,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'plain',
      textVersion: 1,
    })
    vi.advanceTimersByTime(16)
  })

  expect(result.current.record).not.toBeNull()
  expect(mark.mock.calls.filter(([name]) => name === 'editor.cached_visible_paint')).toHaveLength(1)
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_text_paint'),
  ).toHaveLength(0)

  act(() => vi.advanceTimersByTime(16))

  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_text_paint'),
  ).toHaveLength(1)
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_highlight_paint'),
  ).toHaveLength(0)

  act(() => {
    contribution.update(replacement.snapshot, 'tokens')
    result.current.dismissOverlay()
    result.current.onInitialPaint({
      documentGeneration: 8,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'painted',
      textVersion: 1,
    })
    vi.advanceTimersByTime(350)
  })

  expect(result.current.record).toBeNull()
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_highlight_paint'),
  ).toHaveLength(1)
  expect(replacement.materialize).toHaveBeenCalledTimes(1)
  expect(readMatching()?.snapshot.textVersion).toBe(2)
})

test('pending-theme paint survives an interrupted handoff and marks once', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const renderedOptions = { ...options, documentId: 'document-1' }
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  rerender({ ...renderedOptions, appliedThemeId: 'old-theme' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)

  act(() => emitSuccessfulPaint(result.current.onInitialPaint, 9))
  act(() => vi.advanceTimersByTime(16))
  expect(result.current.record).not.toBeNull()
  expect(
    mark.mock.calls.filter(
      ([name]) =>
        name === 'editor.authoritative_text_paint' ||
        name === 'editor.authoritative_highlight_paint',
    ),
  ).toHaveLength(0)

  rerender(renderedOptions)
  act(() => contribution.update(runtimeSnapshot('document-1').snapshot, 'document'))
  rerender({ ...renderedOptions, appliedThemeId: 'old-theme' })
  act(() => vi.advanceTimersByTime(16))
  expect(result.current.record).not.toBeNull()
  expect(
    mark.mock.calls.filter(
      ([name]) =>
        name === 'editor.authoritative_text_paint' ||
        name === 'editor.authoritative_highlight_paint',
    ),
  ).toHaveLength(0)

  rerender(renderedOptions)
  act(() => contribution.update(runtimeSnapshot('document-1').snapshot, 'layout'))
  act(() => vi.advanceTimersByTime(15))
  expect(result.current.record).not.toBeNull()

  act(() => vi.advanceTimersByTime(1))
  expect(result.current.record).toBeNull()
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_text_paint'),
  ).toHaveLength(1)
  expect(
    mark.mock.calls.filter(([name]) => name === 'editor.authoritative_highlight_paint'),
  ).toHaveLength(1)

  rerender(renderedOptions)
  act(() => vi.advanceTimersByTime(32))
  expect(
    mark.mock.calls.filter(
      ([name]) =>
        name === 'editor.authoritative_text_paint' ||
        name === 'editor.authoritative_highlight_paint',
    ),
  ).toHaveLength(2)
})

test('dirty state cancels matching paint before the authoritative frame', () => {
  const mark = vi.spyOn(performance, 'mark')
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result, rerender } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )

  rerender({ ...options, documentId: 'document-1' })
  const contribution = activateCaptureContribution(result.current.additionalPlugins[0]!)
  act(() => {
    contribution.update(runtimeSnapshot('document-1').snapshot, 'document')
    emitSuccessfulPaint(result.current.onInitialPaint, 10)
    buffer.setDirty(true)
    vi.advanceTimersByTime(16)
  })

  expect(result.current.record).toBeNull()
  expect(
    mark.mock.calls.filter(
      ([name]) =>
        name === 'editor.authoritative_text_paint' ||
        name === 'editor.authoritative_highlight_paint',
    ),
  ).toHaveLength(0)
})

test('the presentation fail-safe bounds a hung cold load', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())
  const buffer = controlledBuffer()
  const options = hookOptions({ buffer, documentId: null })
  const { result } = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options },
  )
  expect(result.current.record).not.toBeNull()

  act(() => vi.advanceTimersByTime(1_499))
  expect(result.current.record).not.toBeNull()

  act(() => vi.advanceTimersByTime(1))
  expect(result.current.record).toBeNull()
})

test('cached paint rectangles preserve scroll offsets and current guide visibility', () => {
  const record = cachedSnapshot()
  record.snapshot.viewport.scrollLeft = 8
  record.snapshot.viewport.scrollTop = 12
  record.snapshot.paintLayers = [
    {
      id: 'scope-lines',
      rectangles: [{ left: 80, top: 20, width: 1, height: 40, backgroundColor: 'rgb(90, 90, 90)' }],
    },
    {
      id: 'selection-decoration',
      rectangles: [
        { left: 100, top: 30, width: 20, height: 2, backgroundColor: 'rgb(30, 40, 50)' },
      ],
    },
  ]
  const overlayRef = { current: null }
  const view = render(
    <EditorVisibleSnapshot indentationGuidesEnabled overlayRef={overlayRef} record={record} />,
  )
  const guide = view.container.querySelector(
    '[data-editor-visible-paint-layer="scope-lines"] [data-editor-visible-paint-rectangle]',
  )

  expect(guide).toHaveStyle({
    left: '72px',
    top: '8px',
    width: '1px',
    height: '40px',
    backgroundColor: 'rgb(90, 90, 90)',
  })

  view.rerender(
    <EditorVisibleSnapshot
      indentationGuidesEnabled={false}
      overlayRef={overlayRef}
      record={record}
    />,
  )

  expect(view.container.querySelector('[data-editor-visible-paint-layer="scope-lines"]')).toBeNull()
  expect(
    view.container.querySelector('[data-editor-visible-paint-layer="selection-decoration"]'),
  ).not.toBeNull()
  expect(view.container.textContent).toContain('const value = 1')
})

test('the inert renderer preserves bounded parts, syntax runs, and captured geometry', () => {
  const record = cachedSnapshot()
  const row = record.snapshot.rows[0]!
  row.leftSpacerWidth = 24
  row.foldMarker = {
    collapsed: true,
    endOffset: 10,
    endRow: 2,
    key: 'fold-1',
    startOffset: 0,
    startRow: 0,
  }
  row.chunks = [
    {
      parts: [
        { kind: 'text', text: 'ab' },
        { kind: 'text', text: 'cd' },
      ],
      replayFidelity: 'exact',
      rowLocalEnd: 4,
      rowLocalStart: 0,
      runs: [{ end: 3, start: 1, style: { color: 'var(--editor-syntax-keyword)' } }],
      sourceEndOffset: 4,
      sourceStartOffset: 0,
    },
    {
      parts: [
        { kind: 'control', text: 'NUL', widthCells: 3 },
        { kind: 'refusal', text: 'Bidirectional text omitted' },
      ],
      replayFidelity: 'plain-core-rendered',
      rowLocalEnd: 6,
      rowLocalStart: 4,
      runs: [],
      sourceEndOffset: 6,
      sourceStartOffset: 4,
    },
  ]
  const overlayRef = { current: null }

  const view = render(
    <EditorVisibleSnapshot indentationGuidesEnabled overlayRef={overlayRef} record={record} />,
  )

  const overlay = view
    .getByText('Bidirectional text omitted')
    .closest('[data-editor-visible-snapshot]')
  expect(overlay).toHaveAttribute('aria-hidden', 'true')
  expect(overlay).not.toHaveAttribute('tabindex')
  expect(view.container.querySelector('[data-editor-visible-row="0"]')).toHaveStyle({
    left: '56px',
    top: '0px',
  })
  expect(view.container.querySelector('.editor-virtualized-row-spacer')).toHaveStyle({
    width: '24px',
  })
  expect(view.container.querySelector('.editor-virtualized-control-character')).toHaveStyle({
    width: '24px',
  })
  expect(view.container.querySelector('[data-editor-fold-state="collapsed"]')).not.toBeNull()
  expect(view.container.querySelector('.editor-virtualized-fold-placeholder')).toHaveTextContent(
    '...',
  )
  expect(view.container.textContent).toContain('abcdNULBidirectional text omitted...')

  const segments = editorVisibleSnapshotSegments(row.chunks[0]!)
  expect(segments.slice(0, 3)).toEqual([
    { kind: 'text', style: null, text: 'a' },
    { kind: 'text', style: { color: 'var(--editor-syntax-keyword)' }, text: 'b' },
    { kind: 'text', style: { color: 'var(--editor-syntax-keyword)' }, text: 'c' },
  ])
  expect(
    editorVisibleSnapshotSegments({
      ...row.chunks[0]!,
      parts: [
        { kind: 'control', text: 'NUL', widthCells: 3 },
        { kind: 'text', text: 'ab' },
      ],
      runs: [{ end: 2, start: 1, style: { color: 'highlighted' } }],
    }),
  ).toEqual([
    { kind: 'control', text: 'NUL', widthCells: 3 },
    { kind: 'text', style: null, text: 'a' },
    { kind: 'text', style: { color: 'highlighted' }, text: 'b' },
  ])
  expect(editorVisibleSnapshotCounts(record.snapshot)).toEqual({
    chunks: 2,
    foldMarkers: 1,
    paintLayers: 0,
    paintRectangles: 0,
    parts: 4,
    rows: 1,
    runs: 1,
  })
})

type HookProps = {
  readonly active: boolean
  readonly appliedThemeId: string | null
  readonly committedThemeId: string
  readonly contentVersion: string | null
  readonly documentId: string | null
  readonly fileReadError: boolean
  readonly path: string
  readonly renderedPath: string
  readonly selectedThemeId: string
}

function CaptureMountHarness({
  buffer,
  snapshot,
}: {
  readonly buffer: ControlledBuffer
  readonly snapshot: EditorViewSnapshot
}) {
  const binding = useEditorVisibleSnapshot(
    toHookOptions(hookOptions({ buffer, documentId: 'document-1' }), buffer),
  )

  return <CaptureContributionEmitter plugin={binding.additionalPlugins[0]!} snapshot={snapshot} />
}

function CaptureContributionEmitter({
  plugin,
  snapshot,
}: {
  readonly plugin: EditorPlugin
  readonly snapshot: EditorViewSnapshot
}) {
  useLayoutEffect(() => {
    let provider: EditorViewContributionProvider | null = null
    const registration = { dispose: vi.fn() }
    plugin.activate({
      registerViewContribution: (next: EditorViewContributionProvider) => {
        provider = next
        return registration
      },
    } as unknown as EditorPluginContext)
    const contribution = provider!.createContribution({} as never)
    contribution?.update(snapshot, 'document')

    return () => contribution?.dispose()
  }, [plugin, snapshot])

  return null
}

function mountedCapture(
  buffer: ControlledBuffer,
  theme: Partial<Pick<HookProps, 'appliedThemeId' | 'committedThemeId' | 'selectedThemeId'>> = {},
) {
  const options = { ...hookOptions({ buffer, documentId: 'document-1' }), ...theme }
  const hook = renderHook(
    (props: HookProps) => useEditorVisibleSnapshot(toHookOptions(props, buffer)),
    { initialProps: options, wrapper: StrictMode },
  )
  let provider: EditorViewContributionProvider | null = null
  const registration = { dispose: vi.fn() }
  const context = {
    registerViewContribution: (next: EditorViewContributionProvider) => {
      provider = next
      return registration
    },
  } as unknown as EditorPluginContext
  const binding = hook.result.current
  binding.additionalPlugins[0]!.activate(context)
  const contribution = provider!.createContribution({} as never) as EditorViewContribution

  return { ...hook, binding, contribution }
}

function activateCaptureContribution(plugin: EditorPlugin): EditorViewContribution {
  let provider: EditorViewContributionProvider | null = null
  plugin.activate({
    registerViewContribution: (next: EditorViewContributionProvider) => {
      provider = next
      return { dispose: vi.fn() }
    },
  } as unknown as EditorPluginContext)
  expect(provider).not.toBeNull()

  return provider!.createContribution({} as never) as EditorViewContribution
}

function hookOptions({
  buffer: _buffer,
  documentId,
}: {
  readonly buffer: ControlledBuffer
  readonly documentId: string | null
}): HookProps {
  return {
    active: true,
    appliedThemeId: THEME_ID,
    committedThemeId: THEME_ID,
    contentVersion: CONTENT_VERSION,
    documentId,
    fileReadError: false,
    path: PATH,
    renderedPath: PATH,
    selectedThemeId: THEME_ID,
  }
}

function toHookOptions(props: HookProps, buffer: ControlledBuffer) {
  return {
    storage: testScopedStorage,
    active: props.active,
    fileReadError: props.fileReadError,
    renderedDocument: props.documentId
      ? {
          buffer: buffer as unknown as EditorTextBuffer,
          documentId: props.documentId,
          path: props.renderedPath,
          rootPath: ROOT_PATH,
        }
      : null,
    selectedTarget: {
      contentVersion: props.contentVersion,
      path: props.path,
      rootPath: ROOT_PATH,
    },
    theme: {
      appliedThemeId: props.appliedThemeId,
      committedThemeId: props.committedThemeId,
      selectedThemeId: props.selectedThemeId,
    },
  }
}

function runtimeSnapshot(documentId: string, textVersion = 1) {
  const visible = cachedSnapshot().snapshot
  visible.textVersion = textVersion
  const materialize = vi.fn(() => ({
    ...visible,
    toJSON: () => visible,
  }))
  const snapshot = {
    documentId,
    foldMarkers: [],
    initialHighlightStatus: 'painted',
    paintLayers: [],
    syntaxStatus: 'ready',
    textVersion,
    toVisibleSnapshot: materialize,
    visibleRows: [{}],
  } as unknown as EditorViewSnapshot

  return { materialize, snapshot }
}

function unsupportedRuntimeSnapshot(
  outcome: 'unreplayable-plugin-css' | 'unreplayable-widget',
): EditorViewSnapshot {
  const mountedPaintSupport =
    outcome === 'unreplayable-plugin-css' ? 'unreplayable-plugin-css' : 'replayable'
  const chunks =
    outcome === 'unreplayable-widget' ? [{ mountedPaint: { kind: 'unreplayable-widget' } }] : []

  return {
    documentId: 'document-1',
    initialHighlightStatus: 'painted',
    paintLayers: [],
    syntaxStatus: 'ready',
    textVersion: 1,
    toVisibleSnapshot: () => null,
    visibleRows: [{ chunks, mountedPaintSupport }],
  } as unknown as EditorViewSnapshot
}

function emitSuccessfulPaint(
  emit: ReturnType<typeof useEditorVisibleSnapshot>['onInitialPaint'],
  documentGeneration: number,
): void {
  emit({
    documentGeneration,
    documentId: 'document-1',
    phase: 'text',
    textVersion: 1,
  })
  emit({
    documentGeneration,
    documentId: 'document-1',
    phase: 'highlight-settled',
    status: 'painted',
    textVersion: 1,
  })
}

type ControlledBuffer = {
  isDirty(): boolean
  setDirty(next: boolean): void
  subscribe(listener: () => void): () => void
}

function controlledBuffer(): ControlledBuffer {
  let dirty = false
  const listeners = new Set<() => void>()

  return {
    isDirty: () => dirty,
    setDirty: (next) => {
      dirty = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function readMatching() {
  return readEditorVisibleSnapshotCache(testScopedStorage, {
    path: PATH,
    rootPath: ROOT_PATH,
    themeId: THEME_ID,
  })
}

function cachedSnapshot(): Mutable<CachedEditorVisibleSnapshot> {
  return {
    cacheVersion: 4,
    contentVersion: CONTENT_VERSION,
    path: PATH,
    rootPath: ROOT_PATH,
    snapshot: visibleSnapshot(),
    themeId: THEME_ID,
  }
}

function visibleSnapshot(): Mutable<EditorVisibleSnapshotJSON> {
  return {
    paintLayers: [],
    contentWidth: 160,
    documentId: 'document-1',
    gutterLayout: {
      fixedWidth: 16,
      lanes: [
        { id: 'line-gutter', width: 24 },
        { id: 'fold-gutter', width: 16 },
      ],
    },
    gutterWidth: 56,
    initialHighlightStatus: 'painted',
    kind: 'editor-visible',
    languageId: 'typescript',
    lineCount: 1,
    metrics: { characterWidth: 8, rowHeight: 20 },
    rows: [
      {
        bufferRow: 0,
        chunks: [
          {
            parts: [{ kind: 'text', text: 'const value = 1' }],
            replayFidelity: 'exact',
            rowLocalEnd: 15,
            rowLocalStart: 0,
            runs: [{ end: 5, start: 0, style: { color: 'var(--editor-syntax-keyword)' } }],
            sourceEndOffset: 15,
            sourceStartOffset: 0,
          },
        ],
        contentCursorLine: true,
        foldMarker: null,
        gutterCursorLineBackgroundLaneIds: ['fold-gutter'],
        gutterNumberCursorLine: true,
        height: 20,
        index: 0,
        injectedTextRowId: null,
        leftSpacerWidth: 0,
        firstWrapSegment: true,
        source: 'document',
        top: 0,
      },
    ],
    schemaVersion: 1,
    tabSize: 2,
    textVersion: 1,
    theme: {
      foregroundColor: '#f8f8f2',
      gutterForegroundColor: '#6e7681',
      syntax: { keyword: '#ff79c6' },
    },
    totalHeight: 20,
    viewport: {
      borderBoxHeight: 120,
      borderBoxWidth: 320,
      clientHeight: 120,
      clientWidth: 320,
      scrollHeight: 120,
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 320,
      visibleRange: { end: 1, start: 0 },
    },
  }
}

type Mutable<T> = {
  -readonly [Key in keyof T]: Mutable<T[Key]>
}
