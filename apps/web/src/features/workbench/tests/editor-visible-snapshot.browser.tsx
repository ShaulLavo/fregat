import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import '@workspace/ui/globals.css'
import '@singapor/core/style.css'
import '@singapor/gutters/style.css'
import {
  createEditorTextBuffer,
  createEditorViewSession,
  type EditorPlugin,
  type EditorPluginContext,
  type EditorTextBuffer,
  type EditorViewContributionProvider,
  type EditorViewSnapshot,
} from '@singapor/core'
import { Editor as CoreEditor } from '@singapor/core/editor'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapor/gutters'
import { createRef, useEffect, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import {
  resetEditorColorThemeStore,
  setSelectedEditorThemeId,
} from '@/features/editor/state/color-theme-store'
import {
  disposeEditorShikiWorkerOwner,
  disposeEditorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { BUILTIN_EDITOR_THEMES } from '@/features/editor/utils/theme-catalog'
import { EditorVisibleSnapshot } from '@/features/workbench/components/editor-visible-snapshot'
import { FileEditorBody } from '@/features/workbench/components/file-editor-body'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import {
  EditorSurfaceActionsContext,
  type EditorSurfaceActions,
} from '@/features/workbench/providers/editor-surface-actions-context'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { statPath } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  readEditorVisibleSnapshotCache,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import {
  installDelayedFileReadClient,
  type DelayedFileReadClient,
} from '../../../../test/factories/delayed-file-read-client'

let root: Root | null = null
let liveEditor: CoreEditor | null = null
let delayedFileRead: DelayedFileReadClient | null = null
const CONTENT_VERSION = 'stat:1:1'

afterEach(async () => {
  delayedFileRead?.restore()
  delayedFileRead = null
  liveEditor?.dispose()
  liveEditor = null
  if (root) flushSync(() => root?.unmount())
  root = null
  await Promise.all([disposeEditorShikiWorkerOwner(), disposeEditorTreeSitterSyntaxProvider()])
  resetEditorColorThemeStore()
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark', 'light')
  localStorage.clear()
  performance.clearMarks()
  performance.clearMeasures()
})

test('cached paint matches live editor geometry, glass, active gutter, and syntax variables', async () => {
  const workspace = document.createElement('div')
  workspace.dataset.workbench = ''
  document.body.append(workspace)
  const liveHost = editorHost()
  workspace.append(liveHost)
  const record = structuredClone(cachedSnapshot()) as Mutable<CachedEditorVisibleSnapshot>
  liveEditor = new CoreEditor(liveHost, {
    cursorLineHighlight: {
      gutterBackground: ['fold-gutter'],
      gutterNumber: true,
      rowBackground: true,
    },
    defaultText: `${'const\tvalue '.repeat(80)}\nsecond`,
    lineHeight: 20,
    plugins: [
      createLineGutterPlugin({ labelForRow: ({ bufferRow }) => bufferRow + 1 }),
      createFoldGutterPlugin(),
    ],
    tabSize: 2,
    theme: record.snapshot.theme ?? undefined,
  })
  await nextFrame()
  await nextFrame()
  liveEditor.setSelection(record.snapshot.rows[1]!.chunks[0]!.sourceStartOffset)
  liveEditor.setSelection(0)

  const liveSurface = await elementWithin(liveHost, '.editor-virtualized')
  const liveGutter = await elementWithin(liveHost, '.editor-virtualized-gutter')
  const liveContentRow = await elementWithin(liveHost, '.editor-virtualized-row')
  const liveActiveNumber = await elementWithin(liveHost, '.editor-virtualized-line-number-active')
  const liveInactiveNumber = await elementWithin(
    liveHost,
    '.editor-virtualized-gutter-label:not(.editor-virtualized-line-number-active)',
  )
  const liveCursorLane = await elementWithin(
    liveHost,
    '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution="fold-gutter"]',
  )
  const liveGutterCells = Array.from(
    liveHost.querySelectorAll<HTMLElement>(
      '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution]',
    ),
  )
  liveSurface.scrollLeft = 8
  liveSurface.dispatchEvent(new Event('scroll'))
  await nextFrame()
  calibrateRecordGeometry(record, liveSurface, liveGutter, liveContentRow, liveGutterCells)

  const replayHost = editorHost()
  workspace.append(replayHost)
  root = createRoot(replayHost)
  flushSync(() =>
    root?.render(
      <EditorVisibleSnapshot indentationGuidesEnabled overlayRef={createRef()} record={record} />,
    ),
  )

  const overlay = await elementWithin(replayHost, '[data-editor-visible-snapshot]')
  const replaySurface = await elementWithin(replayHost, '.editor-virtualized')
  const replayGutter = await elementWithin(replayHost, '.editor-virtualized-gutter')
  const replayContentRow = await elementWithin(replayHost, '[data-editor-visible-row="0"]')
  const replayActiveNumber = await elementWithin(
    replayHost,
    '.editor-virtualized-line-number-active',
  )
  const replayInactiveNumber = await elementWithin(
    replayHost,
    '.editor-virtualized-gutter-label:not(.editor-virtualized-line-number-active)',
  )
  const replaySyntax = await elementWithin(replayHost, '[data-editor-visible-chunk="0"] > span')
  const replayCursorLane = await elementWithin(
    replayHost,
    '[data-editor-visible-gutter-lane="fold-gutter"].editor-virtualized-cursor-line-gutter',
  )
  const replayControl = await elementWithin(replayHost, '.editor-virtualized-control-character')
  const replayFoldPlaceholder = await elementWithin(
    replayHost,
    '.editor-virtualized-fold-placeholder',
  )
  const syntaxProbe = document.createElement('span')
  syntaxProbe.style.color = 'var(--editor-syntax-keyword)'
  liveSurface.append(syntaxProbe)

  expect(overlay.getAttribute('aria-hidden')).toBe('true')
  expect(overlay).not.toHaveAttribute('tabindex')
  expect(overlay.tabIndex).toBe(-1)
  expect(getComputedStyle(overlay).pointerEvents).toBe('none')
  expect(getComputedStyle(overlay).userSelect).toBe('none')
  expect(getComputedStyle(replaySurface).backgroundColor).toBe(
    getComputedStyle(liveSurface).backgroundColor,
  )
  expect(getComputedStyle(replayGutter).backgroundColor).toBe(
    getComputedStyle(liveGutter).backgroundColor,
  )
  expect(getComputedStyle(replayActiveNumber).color).toBe(getComputedStyle(liveActiveNumber).color)
  expect(getComputedStyle(replayInactiveNumber).color).toBe(
    getComputedStyle(liveInactiveNumber).color,
  )
  for (const { live, replay, text } of [
    { live: liveActiveNumber, replay: replayActiveNumber, text: '1' },
    { live: liveInactiveNumber, replay: replayInactiveNumber, text: '2' },
  ]) {
    const liveStyle = getComputedStyle(live)
    const replayStyle = getComputedStyle(replay)
    expect(['flex', 'inline-flex']).toContain(liveStyle.display)
    expect(liveStyle.justifyContent).toBe('flex-end')
    expect(replayStyle.display).toBe(liveStyle.display)
    expect(replayStyle.justifyContent).toBe(liveStyle.justifyContent)
    expect(replayStyle.paddingLeft).toBe(liveStyle.paddingLeft)
    expect(replayStyle.paddingRight).toBe(liveStyle.paddingRight)
    expect(live.textContent).toBe(text)
    expect(replay.textContent).toBe(text)

    const liveTextRange = document.createRange()
    liveTextRange.selectNodeContents(live)
    const replayTextRange = document.createRange()
    replayTextRange.selectNodeContents(replay)
    const liveTextBounds = liveTextRange.getBoundingClientRect()
    const replayTextBounds = replayTextRange.getBoundingClientRect()
    expect(liveTextBounds.width).toBeGreaterThan(0)
    expect(replayTextBounds.width).toBeCloseTo(liveTextBounds.width, 1)
    expect(replayTextBounds.right - replayGutter.getBoundingClientRect().left).toBeCloseTo(
      liveTextBounds.right - liveGutter.getBoundingClientRect().left,
      1,
    )
  }
  expect(getComputedStyle(replaySyntax).color).toBe(getComputedStyle(syntaxProbe).color)
  expect(getComputedStyle(replayCursorLane).backgroundColor).toBe(
    getComputedStyle(liveCursorLane).backgroundColor,
  )
  expect(getComputedStyle(replayContentRow).backgroundColor).toBe(
    getComputedStyle(liveContentRow).backgroundColor,
  )
  expect(
    replayContentRow.getBoundingClientRect().left - replayHost.getBoundingClientRect().left,
  ).toBeCloseTo(
    liveContentRow.getBoundingClientRect().left - liveHost.getBoundingClientRect().left,
    1,
  )
  expect(replayGutter.getBoundingClientRect().width).toBeCloseTo(
    liveGutter.getBoundingClientRect().width,
    1,
  )
  expect(replayControl.getBoundingClientRect().width).toBe(24)
  expect(replayFoldPlaceholder.textContent).toBe('...')
  expect(replayContentRow.textContent).toBe(
    'const\tvalueNULBidirectional text omitted from this bounded paint...',
  )
  expect(replayHost.querySelector('textarea')).toBeNull()
  expect(replayHost.querySelector('[contenteditable]')).toBeNull()
})

test(
  'the first render replays cached text and highlights before metadata or file content arrives',
  { timeout: 20_000 },
  async ({ onTestFinished }) => {
    const path = 'repo/src/editor-tab-a.ts'
    const rootPath = 'repo'
    const themeId = prepareRealFileTest()
    const record = await cachedSnapshotForExistingTarget(path, rootPath, themeId)
    const withGuides = structuredClone(record) as Mutable<CachedEditorVisibleSnapshot>
    withGuides.snapshot.paintLayers = [
      {
        id: 'scope-lines',
        rectangles: [
          { left: 80, top: 10, width: 1, height: 30, backgroundColor: 'rgb(90, 90, 90)' },
        ],
      },
    ]
    expect(writeEditorVisibleSnapshotCache(testScopedStorage, withGuides).status).toBe('written')
    const gate = installDelayedFileReadClient(undefined, { delayMetadata: true })
    delayedFileRead = gate
    const queryClient = createTestQueryClient()

    const host = mountRealFileEditor(path, rootPath, queryClient)

    const overlay = host.querySelector<HTMLElement>('[data-editor-visible-snapshot]')
    expect(overlay).not.toBeNull()
    const cachedText = overlay?.textContent ?? ''
    expect(cachedText).toContain('const\tvalue')
    expect(cachedText).not.toContain('real browser fixture A')
    const syntax = overlay?.querySelector<HTMLElement>(
      '[data-editor-visible-row="0"] [data-editor-visible-chunk="0"] > span',
    )
    expect(syntax?.textContent).toBe('const')
    expect(syntax?.style.color).toBe('var(--editor-syntax-keyword)')
    const guide = overlay?.querySelector<HTMLElement>(
      '[data-editor-visible-paint-layer="scope-lines"] [data-editor-visible-paint-rectangle]',
    )
    expect(guide).not.toBeNull()
    const overlayBounds = overlay!.getBoundingClientRect()
    const guideBounds = guide!.getBoundingClientRect()
    expect(guideBounds.left - overlayBounds.left).toBeCloseTo(72, 1)
    expect(guideBounds.top - overlayBounds.top).toBeCloseTo(10, 1)
    expect(guideBounds.width).toBe(1)
    expect(guideBounds.height).toBe(30)
    expect(host.querySelector('.app-editor-host:not([data-editor-visible-snapshot])')).toBeNull()
    await expect.poll(gate.observedStatus).toBe(200)
    await expect.poll(gate.observedMetadataStatus).toBe(200)
    await nextFrame()
    expect(performance.getEntriesByName('editor.cached_visible_paint')).toHaveLength(1)
    expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(0)
    expect(performance.getEntriesByName('editor.authoritative_highlight_paint')).toHaveLength(0)

    gate.releaseMetadata()
    await expect
      .poll(() => queryClient.getQueryState(fileSystemKeys.fileMetadata(path))?.fetchStatus)
      .toBe('idle')
    expect(host.querySelector('[data-editor-visible-snapshot]')).toBe(overlay)
    expect(host.querySelector('.app-editor-host:not([data-editor-visible-snapshot])')).toBeNull()

    const overlapPaints: {
      cacheOpacity: number
      liveOpacity: number
      width: number
      height: number
    }[] = []
    const observer = new MutationObserver(() => {
      const cache = host.querySelector<HTMLElement>('[data-editor-visible-snapshot]')
      const live = host.querySelector<HTMLElement>(
        '.app-editor-host:not([data-editor-visible-snapshot]) .editor-virtualized',
      )
      if (!cache || cache.hidden || !live?.querySelector('.editor-virtualized-row')) return

      const { width, height } = live.getBoundingClientRect()
      overlapPaints.push({
        cacheOpacity: paintedOpacity(cache),
        liveOpacity: paintedOpacity(live),
        width,
        height,
      })
    })
    observer.observe(host, { attributes: true, childList: true, subtree: true })
    onTestFinished(() => observer.disconnect())

    gate.release()

    await expect
      .poll(
        () =>
          host.querySelector(
            '.app-editor-host:not([data-editor-visible-snapshot]) .editor-virtualized',
          )?.textContent,
        { timeout: 10_000 },
      )
      .toContain("export const editorTabA = 'real browser fixture A'")
    await expect
      .poll(() => performance.getEntriesByName('editor.authoritative_highlight_paint').length, {
        timeout: 10_000,
      })
      .toBe(1)
    await expect.poll(() => !hasVisibleSnapshot(host)).toBe(true)
    await expect.poll(appliedThemeIdentity).toBe(`${themeId}|${themeId}|${themeId}`)

    expect(overlapPaints.length).toBeGreaterThan(0)
    for (const paint of overlapPaints) {
      expect(paint.cacheOpacity).toBe(1)
      expect(paint.liveOpacity).toBe(0)
      expect(paint.width).toBeGreaterThan(0)
      expect(paint.height).toBeGreaterThan(0)
    }
    const live = await elementWithin(
      host,
      '.app-editor-host:not([data-editor-visible-snapshot]) .editor-virtualized',
    )
    expect(paintedOpacity(live)).toBe(1)

    const cachedPaint = performance.getEntriesByName('editor.cached_visible_paint')[0]!
    const textPaint = performance.getEntriesByName(
      'editor.authoritative_text_paint',
    )[0] as PerformanceMark
    const highlightPaint = performance.getEntriesByName(
      'editor.authoritative_highlight_paint',
    )[0] as PerformanceMark
    expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(1)
    expect(textPaint.startTime).toBeGreaterThan(cachedPaint.startTime)
    expect(highlightPaint.startTime).toBeGreaterThanOrEqual(textPaint.startTime)
    expect(textPaint.detail).toMatchObject({ documentId: path, phase: 'text' })
    expect(highlightPaint.detail).toMatchObject({
      documentId: path,
      phase: 'highlight-settled',
      status: 'painted',
    })
  },
)

test('a real file-read error removes both the cold paint and its matching record', async () => {
  const path = 'repo/src/plan-060-missing.ts'
  const rootPath = 'repo'
  const themeId = prepareRealFileTest()
  const gate = installDelayedFileReadClient()
  delayedFileRead = gate
  const record = cachedSnapshotForTarget(path, rootPath, themeId, 'stat:missing')
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')

  const host = mountRealFileEditor(path, rootPath)
  expect(host.querySelector('[data-editor-visible-snapshot]')).not.toBeNull()
  await expect.poll(gate.observedStatus).toBe(404)
  expect(host.querySelector('[data-editor-visible-snapshot]')).not.toBeNull()

  gate.release()

  await expect.poll(() => host.querySelector('[data-editor-visible-snapshot]')).toBeNull()
  await expect
    .poll(() =>
      readEditorVisibleSnapshotCache(testScopedStorage, {
        path,
        rootPath,
        themeId,
      }),
    )
    .toBeNull()
  await expect.poll(() => host.textContent?.toLowerCase()).toContain('found')
})

test.each(['pointerdown', 'touchmove', 'wheel'] as const)(
  'FileEditorBody capture hides cold paint before a real %s event bubbles',
  async (eventType) => {
    const path = 'repo/src/editor-tab-b.ts'
    const rootPath = 'repo'
    const themeId = prepareRealFileTest()
    const gate = installDelayedFileReadClient()
    delayedFileRead = gate
    const record = await cachedSnapshotForExistingTarget(path, rootPath, themeId)
    expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')

    const host = mountRealFileEditor(path, rootPath)
    await expect.poll(gate.observedStatus).toBe(200)
    const overlay = await element('[data-editor-visible-snapshot]')
    const pane = overlay.parentElement
    expect(pane).not.toBeNull()
    if (!pane) return

    let hiddenAtBubble = false
    pane.addEventListener(
      eventType,
      () => {
        hiddenAtBubble = overlay.hidden === true
      },
      { once: true },
    )
    pane.dispatchEvent(editorInteractionEvent(eventType))

    expect(hiddenAtBubble).toBe(true)
    expect(overlay.hidden).toBe(true)
    expect(
      readEditorVisibleSnapshotCache(testScopedStorage, {
        path,
        rootPath,
        themeId,
      }),
    ).not.toBeNull()
    expect(host.querySelector('.app-editor-host:not([data-editor-visible-snapshot])')).toBeNull()
  },
)

test('the cached mark stays distinct from matching next-frame authoritative paint', async () => {
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot()).status).toBe(
    'written',
  )
  const host = document.createElement('div')
  host.dataset.workbench = ''
  host.style.height = '120px'
  host.style.position = 'relative'
  host.style.width = '320px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(<PaintHarness live={false} />))

  await nextFrame()
  expect(performance.getEntriesByName('editor.cached_visible_paint')).toHaveLength(1)
  expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(0)

  flushSync(() => root?.render(<PaintHarness live />))
  expect(document.querySelector('[data-editor-visible-snapshot]')).not.toBeNull()

  await nextFrame()

  expect(
    document.querySelector<HTMLElement>('[data-editor-visible-snapshot]')?.hidden ?? true,
  ).toBe(true)
  expect(performance.getEntriesByName('editor.authoritative_text_paint')).toHaveLength(1)
  expect(performance.getEntriesByName('editor.authoritative_highlight_paint')).toHaveLength(1)
  const cached = performance.getEntriesByName('editor.cached_visible_paint')[0]!
  const text = performance.getEntriesByName('editor.authoritative_text_paint')[0]!
  expect(text.startTime).toBeGreaterThan(cached.startTime)
})

test('a ready exact document still paints its cached frame before authoritative paint', async () => {
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot()).status).toBe(
    'written',
  )
  const host = document.createElement('div')
  host.dataset.workbench = ''
  host.style.height = '120px'
  host.style.position = 'relative'
  host.style.width = '320px'
  document.body.append(host)
  root = createRoot(host)

  flushSync(() => root?.render(<PaintHarness live />))
  expect(document.querySelector('[data-editor-visible-snapshot]')).not.toBeNull()
  await nextFrame()
  await nextFrame()

  const cached = performance.getEntriesByName('editor.cached_visible_paint')[0]
  const text = performance.getEntriesByName('editor.authoritative_text_paint')[0]
  const highlight = performance.getEntriesByName('editor.authoritative_highlight_paint')[0]
  expect(cached).toBeDefined()
  expect(text).toBeDefined()
  expect(highlight).toBeDefined()
  expect(text?.startTime).toBeGreaterThan(cached?.startTime ?? Number.POSITIVE_INFINITY)
  expect(highlight?.startTime).toBeGreaterThan(cached?.startTime ?? Number.POSITIVE_INFINITY)
})

test('capture-phase interaction hides the visual before the event reaches the live target', async () => {
  const { observations, overlay, target } = await mountInteractionHarness('pointer')

  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

  expect(observations).toEqual([true])
  expect(overlay.hidden).toBe(true)
})

test('capture-phase keyboard input hides the visual before the live target handles it', async () => {
  const { observations, overlay, target } = await mountInteractionHarness('keyboard')

  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))

  expect(observations).toEqual([true])
  expect(overlay.hidden).toBe(true)
})

test('capture-phase focus hides the visual before focus reaches the live target', async () => {
  const { observations, overlay, target } = await mountInteractionHarness('focus')

  target.focus()

  expect(document.activeElement).toBe(target)
  expect(observations).toEqual([true])
  expect(overlay.hidden).toBe(true)
})

async function mountInteractionHarness(kind: InteractionKind) {
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot()).status).toBe(
    'written',
  )
  const host = document.createElement('div')
  host.dataset.workbench = ''
  host.style.height = '120px'
  host.style.position = 'relative'
  host.style.width = '320px'
  document.body.append(host)
  root = createRoot(host)
  const observations: boolean[] = []
  flushSync(() => root?.render(<InteractionHarness kind={kind} observations={observations} />))
  const target = await element('[data-live-target]')
  const overlay = await element('[data-editor-visible-snapshot]')

  return { observations, overlay, target }
}

function PaintHarness({ live }: { live: boolean }) {
  const binding = useEditorVisibleSnapshot({
    storage: testScopedStorage,
    active: true,
    fileReadError: false,
    renderedDocument: live
      ? {
          buffer: CLEAN_BUFFER,
          documentId: 'document-1',
          path: '/repo/src/app.ts',
          rootPath: '/repo',
        }
      : null,
    selectedTarget: {
      contentVersion: CONTENT_VERSION,
      path: '/repo/src/app.ts',
      rootPath: '/repo',
    },
    theme: {
      appliedThemeId: 'dark-plus',
      committedThemeId: 'dark-plus',
      selectedThemeId: 'dark-plus',
    },
  })
  return (
    <>
      {live ? (
        <InitialPaintEmitter emit={binding.onInitialPaint} plugin={binding.additionalPlugins[0]!} />
      ) : null}
      {binding.record ? (
        <EditorVisibleSnapshot
          indentationGuidesEnabled
          overlayRef={binding.overlayRef}
          record={binding.record}
        />
      ) : null}
    </>
  )
}

function InitialPaintEmitter({
  emit,
  plugin,
}: {
  emit: ReturnType<typeof useEditorVisibleSnapshot>['onInitialPaint']
  plugin: EditorPlugin
}) {
  const emittedRef = useRef(false)
  useEffect(() => {
    if (emittedRef.current) return

    emittedRef.current = true
    let provider: EditorViewContributionProvider | null = null
    plugin.activate({
      registerViewContribution: (next: EditorViewContributionProvider) => {
        provider = next
        return { dispose: () => undefined }
      },
    } as unknown as EditorPluginContext)
    const contribution = provider!.createContribution({} as never)
    contribution?.update(
      {
        ...cachedSnapshot().snapshot,
        foldMarkers: [],
        paintLayers: [],
        syntaxStatus: 'ready',
        toVisibleSnapshot: () => null,
        visibleRows: [],
      } as unknown as EditorViewSnapshot,
      'document',
    )
    emit({
      documentGeneration: 4,
      documentId: 'document-1',
      phase: 'text',
      textVersion: 1,
    })
    emit({
      documentGeneration: 4,
      documentId: 'document-1',
      phase: 'highlight-settled',
      status: 'painted',
      textVersion: 1,
    })
    return () => contribution?.dispose()
  }, [emit, plugin])

  return null
}

type InteractionKind = 'focus' | 'keyboard' | 'pointer'

function InteractionHarness({
  kind,
  observations,
}: {
  kind: InteractionKind
  observations: boolean[]
}) {
  const binding = useEditorVisibleSnapshot({
    storage: testScopedStorage,
    active: true,
    fileReadError: false,
    renderedDocument: null,
    selectedTarget: {
      contentVersion: CONTENT_VERSION,
      path: '/repo/src/app.ts',
      rootPath: '/repo',
    },
    theme: {
      appliedThemeId: 'dark-plus',
      committedThemeId: 'dark-plus',
      selectedThemeId: 'dark-plus',
    },
  })

  return (
    <div
      className='relative h-full w-full'
      onFocusCapture={binding.dismissOverlay}
      onKeyDownCapture={binding.dismissOverlay}
      onPointerDownCapture={binding.dismissOverlay}
    >
      <button
        data-live-target=''
        onFocus={() => {
          if (kind === 'focus') observations.push(binding.overlayRef.current?.hidden === true)
        }}
        onKeyDown={() => {
          if (kind === 'keyboard') observations.push(binding.overlayRef.current?.hidden === true)
        }}
        onPointerDown={() => {
          if (kind === 'pointer') observations.push(binding.overlayRef.current?.hidden === true)
        }}
      >
        live target
      </button>
      {binding.record ? (
        <EditorVisibleSnapshot
          indentationGuidesEnabled
          overlayRef={binding.overlayRef}
          record={binding.record}
        />
      ) : null}
    </div>
  )
}

function cleanBuffer(): EditorTextBuffer {
  return {
    isDirty: () => false,
    subscribe: () => () => undefined,
  } as unknown as EditorTextBuffer
}

const CLEAN_BUFFER = cleanBuffer()

const TREE_SITTER_DARK_THEME = BUILTIN_EDITOR_THEMES[0]

const REAL_EDITOR_ACTIONS = {
  applyWorkspaceEdit: async () => ({
    code: 'workspace-edit-host-unavailable',
    message: 'Workspace edits are unavailable in this browser fixture',
    status: 'failed',
  }),
  closeReferences: () => undefined,
  handleTextChange: () => undefined,
  openDefinition: () => false,
  openReferences: () => false,
  previewReference: () => undefined,
  setScrollPosition: () => undefined,
  setStatusSource: () => undefined,
} satisfies EditorSurfaceActions

function prepareRealFileTest(): string {
  resetEditorColorThemeStore()
  setSelectedEditorThemeId('dark', TREE_SITTER_DARK_THEME.id)
  seedBootMirrorTheme('dark')
  return TREE_SITTER_DARK_THEME.id
}

function mountRealFileEditor(
  path: string,
  rootPath: string,
  queryClient = createTestQueryClient(),
): HTMLElement {
  const host = document.createElement('main')
  host.dataset.workbench = ''
  host.style.height = '180px'
  host.style.position = 'relative'
  host.style.width = '420px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => {
    root?.render(
      <AppProviders command={false} queryClient={queryClient}>
        <EditorStateProvider>
          <ThemeIdentityProbe />
          <RealFileEditorBody path={path} rootPath={rootPath} />
        </EditorStateProvider>
      </AppProviders>,
    )
  })
  return host
}

function RealFileEditorBody({ path, rootPath }: { path: string; rootPath: string }) {
  const { fileState, fileVersion } = useSelectedFile(path)
  const liveDocument = useMemo(
    () => (fileState.status === 'ready' ? renderDocumentForFile(fileState.data) : null),
    [fileState],
  )

  return (
    <EditorSurfaceActionsContext value={REAL_EDITOR_ACTIONS}>
      <FileEditorBody
        active
        definitionTarget={null}
        fileState={fileState}
        fileVersion={fileVersion}
        languageServerReferences={null}
        liveDocument={liveDocument}
        path={path}
        rootPath={rootPath}
        tabId={`browser:${path}`}
      />
    </EditorSurfaceActionsContext>
  )
}

function renderDocumentForFile(file: FileResult): EditorRenderDocument {
  const buffer = createEditorTextBuffer(file.content)
  buffer.markClean()
  return {
    buffer,
    editability: 'editable',
    id: file.path,
    path: file.path,
    view: createEditorViewSession(buffer, `browser:${file.path}`),
  }
}

function ThemeIdentityProbe() {
  const { appliedThemeId, committedThemeId, selectedThemeId } = useEditorColorTheme()

  return (
    <span
      data-theme-identity={[appliedThemeId ?? '', committedThemeId, selectedThemeId].join('|')}
      hidden
    />
  )
}

function cachedSnapshotForTarget(
  path: string,
  rootPath: string,
  themeId: string,
  contentVersion: string,
): CachedEditorVisibleSnapshot {
  const record = structuredClone(cachedSnapshot()) as Mutable<CachedEditorVisibleSnapshot>
  record.contentVersion = contentVersion
  record.path = path
  record.rootPath = rootPath
  record.snapshot.documentId = path
  record.snapshot.theme = structuredClone(TREE_SITTER_DARK_THEME.editorTheme)
  record.themeId = themeId
  return record
}

async function cachedSnapshotForExistingTarget(
  path: string,
  rootPath: string,
  themeId: string,
): Promise<CachedEditorVisibleSnapshot> {
  const metadata = await statPath(path, new AbortController().signal)

  return cachedSnapshotForTarget(path, rootPath, themeId, metadata.version)
}

function appliedThemeIdentity(): string | null {
  return document.querySelector<HTMLElement>('[data-theme-identity]')?.dataset.themeIdentity ?? null
}

function hasVisibleSnapshot(host: HTMLElement): boolean {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-editor-visible-snapshot]')).some(
    (overlay) => !overlay.hidden,
  )
}

function paintedOpacity(element: HTMLElement): number {
  let opacity = 1
  let current: HTMLElement | null = element
  while (current) {
    opacity *= Number(getComputedStyle(current).opacity)
    current = current.parentElement
  }
  return opacity
}

function cachedSnapshot(): CachedEditorVisibleSnapshot {
  return {
    cacheVersion: 4,
    contentVersion: CONTENT_VERSION,
    path: '/repo/src/app.ts',
    rootPath: '/repo',
    snapshot: {
      paintLayers: [],
      contentWidth: 200,
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
      lineCount: 2,
      metrics: { characterWidth: 8, rowHeight: 20 },
      rows: [
        {
          bufferRow: 0,
          chunks: [
            {
              parts: [{ kind: 'text', text: 'const\tvalue' }],
              replayFidelity: 'exact',
              rowLocalEnd: 11,
              rowLocalStart: 0,
              runs: [
                {
                  end: 5,
                  start: 0,
                  style: { color: 'var(--editor-syntax-keyword)' },
                },
              ],
              sourceEndOffset: 11,
              sourceStartOffset: 0,
            },
            {
              parts: [
                { kind: 'control', text: 'NUL', widthCells: 3 },
                {
                  kind: 'refusal',
                  text: 'Bidirectional text omitted from this bounded paint',
                },
              ],
              replayFidelity: 'plain-core-rendered',
              rowLocalEnd: 13,
              rowLocalStart: 11,
              runs: [],
              sourceEndOffset: 13,
              sourceStartOffset: 11,
            },
          ],
          contentCursorLine: true,
          foldMarker: {
            collapsed: true,
            endOffset: 13,
            endRow: 1,
            key: 'fold-1',
            startOffset: 0,
            startRow: 0,
          },
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
        {
          bufferRow: 1,
          chunks: [
            {
              parts: [{ kind: 'text', text: 'second' }],
              replayFidelity: 'exact',
              rowLocalEnd: 6,
              rowLocalStart: 0,
              runs: [],
              sourceEndOffset: 20,
              sourceStartOffset: 14,
            },
          ],
          contentCursorLine: false,
          foldMarker: null,
          gutterCursorLineBackgroundLaneIds: [],
          gutterNumberCursorLine: false,
          height: 20,
          index: 1,
          injectedTextRowId: null,
          leftSpacerWidth: 0,
          firstWrapSegment: true,
          source: 'document',
          top: 20,
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
      totalHeight: 40,
      viewport: {
        borderBoxHeight: 120,
        borderBoxWidth: 320,
        clientHeight: 120,
        clientWidth: 320,
        scrollHeight: 120,
        scrollLeft: 8,
        scrollTop: 0,
        scrollWidth: 320,
        visibleRange: { end: 2, start: 0 },
      },
    },
    themeId: 'dark-plus',
  }
}

function editorInteractionEvent(type: 'pointerdown' | 'touchmove' | 'wheel'): Event {
  if (type === 'pointerdown') return new PointerEvent(type, { bubbles: true })
  if (type === 'wheel') return new WheelEvent(type, { bubbles: true })

  return new Event(type, { bubbles: true })
}

async function element(selector: string): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
  return document.querySelector<HTMLElement>(selector)!
}

async function elementWithin(host: HTMLElement, selector: string): Promise<HTMLElement> {
  await expect.poll(() => host.querySelector(selector)).not.toBeNull()
  return host.querySelector<HTMLElement>(selector)!
}

function editorHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.className = 'app-editor-host'
  host.style.height = '120px'
  host.style.position = 'relative'
  host.style.width = '320px'
  return host
}

function calibrateRecordGeometry(
  record: Mutable<CachedEditorVisibleSnapshot>,
  liveSurface: HTMLElement,
  liveGutter: HTMLElement,
  liveContentRow: HTMLElement,
  liveGutterCells: readonly HTMLElement[],
): void {
  const lanes = liveGutterCells.map((cell) => ({
    id: cell.dataset.editorGutterContribution!,
    width: cell.getBoundingClientRect().width,
  }))
  const gutterWidth = liveGutter.getBoundingClientRect().width
  const laneWidth = lanes.reduce((sum, lane) => sum + lane.width, 0)
  const rowHeight = liveContentRow.getBoundingClientRect().height
  record.snapshot.gutterLayout = {
    fixedWidth: Math.max(0, gutterWidth - laneWidth),
    lanes,
  }
  record.snapshot.gutterWidth = gutterWidth
  record.snapshot.metrics.rowHeight = rowHeight
  record.snapshot.viewport.scrollLeft = liveSurface.scrollLeft
  for (const row of record.snapshot.rows) row.height = rowHeight
  record.snapshot.rows[1]!.top = rowHeight
  record.snapshot.totalHeight = rowHeight * record.snapshot.rows.length
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

type Mutable<T> = {
  -readonly [Key in keyof T]: Mutable<T[Key]>
}
