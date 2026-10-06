import { createDocumentSession } from '@singapore-editor/core/document'
import { Editor } from '@singapore-editor/core/editor'
import type { EditorViewContributionContext } from '@singapore-editor/core/extensions'
import '@singapore-editor/core/style.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMinimapPlugin } from '../src/index'
import { canUseMinimapWorker } from '../src/workerClient'
import type { MinimapWorkerRequest, MinimapWorkerResponse } from '../src/types'

const NativeWorker = globalThis.Worker
type ObservedWorker = Worker & {
  readonly requests: MinimapWorkerRequest[]
  readonly responses: MinimapWorkerResponse[]
  terminated: boolean
}
const actors: ObservedWorker[] = []
const contexts: Array<() => EditorViewContributionContext> = []
const cleanup: Array<() => void> = []

beforeEach(() => {
  actors.length = 0
  contexts.length = 0
  vi.stubGlobal('Worker', observedWorkerConstructor())
})
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.unstubAllGlobals()
})

describe.skipIf(!canUseMinimapWorker())('minimap document ownership in the browser', () => {
  it('rebinds the plain editor through text replacement, clear and reopening', async () => {
    const { editor, host } = mount('first😀\nline')
    await stable(1)
    const first = live()[0]!
    const oldCanvas = host.querySelector('.editor-minimap-canvas')
    editor.setText('next🪐\nline\nend')
    await stable(1)
    expect(first.terminated).toBe(true)
    expect(host.querySelector('.editor-minimap-canvas')).not.toBe(oldCanvas)
    expect(lastProjection(live()[0]!).projection).toMatchObject({
      kind: 'reset',
      summary: {
        textLength: 15,
        lines: [
          { text: 'next🪐', length: 6 },
          { text: 'line', length: 4 },
          { text: 'end', length: 3 },
        ],
      },
    })
    const outgoingCanvas = host.querySelector('.editor-minimap-canvas')
    if (!(outgoingCanvas instanceof HTMLCanvasElement))
      expect.unreachable('Painted canvas is required')
    expect(outgoingCanvas.getBoundingClientRect().width).toBeGreaterThan(0)
    editor.clear()
    await waitFor(() => live().length === 0)
    const clearedCanvas = host.querySelector('.editor-minimap-canvas')
    expect(clearedCanvas).not.toBe(outgoingCanvas)
    if (!(clearedCanvas instanceof HTMLCanvasElement))
      expect.unreachable('Cleared canvas is required')
    const inspection = document.createElement('canvas')
    inspection.width = clearedCanvas.width
    inspection.height = clearedCanvas.height
    const clearedContext = inspection.getContext('2d')
    if (!clearedContext) expect.unreachable('Fresh blank canvas is required')
    clearedContext.drawImage(clearedCanvas, 0, 0)
    expect(
      clearedContext
        .getImageData(0, 0, clearedCanvas.width, clearedCanvas.height)
        .data.every((channel) => channel === 0),
    ).toBe(true)
    expect(host.querySelector('.editor-minimap')?.getBoundingClientRect().width).toBe(0)
    const { page } = await import('vitest/browser')
    await page.screenshot({ element: host, path: '../.vitest/evidence/minimap-clear-after.png' })
    editor.setText('again😀\nline')
    await stable(1)
    assertCorrelation(live()[0]!)
    await page.screenshot({ element: host, path: '../.vitest/evidence/minimap-reopen.png' })
  })

  it('shares canonical source for two canvases through one publication, undo and redo', async () => {
    const text = Array.from({ length: 64 }, (_, index) => `//${index}😀`).join('\n')
    const session = createDocumentSession(text)
    const left = mount('')
    const right = mount('')
    left.editor.attachSession(session, { documentId: 'shared-minimap' })
    right.editor.attachSession(session, { documentId: 'shared-minimap' })
    await stable(2)
    expect(left.context().getDocumentContributions()).toBe(
      right.context().getDocumentContributions(),
    )
    left.editor.runInOperation(() => {
      for (let index = 0; index < 12; index++)
        session.applyEdits([{ from: 24 + index * 4, to: 24 + index * 4, text: 'x\ny\n' }])
    })
    await waitFor(
      () =>
        left.context().getSnapshot().lineCount === 88 &&
        right.context().getSnapshot().lineCount === 88,
    )
    await stable(2, left.context().getSnapshot().documentSyncPoint.revision)
    const [first, second] = live()
    if (!first || !second) expect.unreachable('Two independent canvas workers are required')
    expect(lastProjection(first).identity.documentId).toBe(
      lastProjection(second).identity.documentId,
    )
    expect(lastProjection(first).identity.endpointGeneration).not.toBe(
      lastProjection(second).identity.endpointGeneration,
    )
    for (const actor of live()) assertCorrelation(actor)
    const { page } = await import('vitest/browser')
    await page.screenshot({ path: '../.vitest/evidence/minimap-shared.png' })
    for (let index = 0; index < 12; index++) session.undo()
    await stable(2, left.context().getSnapshot().documentSyncPoint.revision)
    expect(left.context().getSnapshot().lineCount).toBe(64)
    for (let index = 0; index < 12; index++) session.redo()
    await stable(2, left.context().getSnapshot().documentSyncPoint.revision)
    expect(right.context().getSnapshot().lineCount).toBe(88)
    const peerFrames = frames(second)
    const ownFrames = frames(first)
    left.editor.setScrollPosition({ top: 100, left: 0 })
    await waitFor(
      () => frames(first) > ownFrames && left.context().getSnapshot().viewport.scrollTop > 0,
    )
    expect(frames(second)).toBe(peerFrames)
    left.editor.dispose()
    await waitFor(() => first.terminated)
    expect(second.terminated).toBe(false)
    right.editor.dispose()
    await waitFor(() => live().length === 0)
  })

  it('retains hidden worker state with zero source transfers and resumes the newest point on show', async () => {
    const { editor, host, context } = mount('ab\n'.repeat(2_000))
    await stable(1)
    const actor = live()[0]!
    host.style.display = 'none'
    await twoFrames()
    const sourceCount = projections(actor).length
    const renderCount = frames(actor)
    editor.runInOperation(() => {
      for (let index = 0; index < 10; index++) editor.edit({ from: 1, to: 1, text: 'X' })
    })
    await twoFrames()
    expect(projections(actor)).toHaveLength(sourceCount)
    expect(frames(actor)).toBe(renderCount)
    expect(actor.terminated).toBe(false)
    host.style.display = 'flex'
    await waitFor(
      () =>
        context().getSnapshot().geometryCommitted !== false &&
        context().getSnapshot().viewport.clientHeight > 0,
    )
    await stable(1, context().getSnapshot().documentSyncPoint.revision)
    expect(live()[0]).toBe(actor)
    expect(projections(actor).length).toBeGreaterThan(sourceCount)
    expect(lastProjection(actor).projection).toMatchObject({
      kind: 'patch',
      summary: { lines: [{ text: 'aXXXXXXXXXXb', length: 12 }] },
    })
    assertCorrelation(actor)
  })

  it('keeps folds and theme changes in frame demand at the same canonical source point', async () => {
    const { editor, context } = mount('begin\ninside\nend\n'.repeat(100))
    await stable(1)
    const actor = live()[0]!
    const sourceCount = projections(actor).length
    const beforeFrames = frames(actor)
    editor.setSyntaxFolds([
      { startIndex: 0, endIndex: 16, startLine: 0, endLine: 2, type: 'region' },
    ])
    editor.fold(0)
    editor.setTheme({
      backgroundColor: '#101010',
      foregroundColor: '#00ff00',
      minimapBackgroundColor: '#101010',
    })
    await waitFor(() => frames(actor) > beforeFrames)
    await stable(1)
    expect(projections(actor)).toHaveLength(sourceCount)
    expect(
      context()
        .getSnapshot()
        .foldMarkers.some((marker) => marker.collapsed),
    ).toBe(true)
    await waitFor(() =>
      actor.requests.some(
        (request) =>
          request.type === 'updateBaseStyles' &&
          request.baseStyles.foreground.g === 255 &&
          request.baseStyles.foreground.r === 0,
      ),
    )
    await stable(1)
    editor.unfold(0)
    await twoFrames()
    expect(projections(actor)).toHaveLength(sourceCount)
    assertCorrelation(actor)
  })
})

function mount(text: string) {
  let current: EditorViewContributionContext | null = null
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;position:relative;width:360px;height:260px'
  document.body.append(host)
  const editor = new Editor(host, {
    defaultText: text,
    lineHeight: 20,
    plugins: [
      createMinimapPlugin({ maxColumn: 16, showSlider: 'always' }),
      {
        name: 'observe-minimap-owner',
        activate: (context) =>
          context.registerViewContribution({
            createContribution(view) {
              current = view
              return { update() {}, dispose() {} }
            },
          }),
      },
    ],
  })
  contexts.push(() => {
    if (!current) expect.unreachable('View context is required')
    return current
  })
  cleanup.push(() => {
    editor.dispose()
    host.remove()
  })
  return {
    editor,
    host,
    context() {
      if (!current) expect.unreachable('Actual view context is required')
      return current
    },
  }
}

function live() {
  return actors.filter((actor) => !actor.terminated)
}
function projections(actor: ObservedWorker) {
  return actor.requests.filter((request) => request.type === 'projectSource')
}
function frames(actor: ObservedWorker) {
  return actor.requests.filter((request) => request.type === 'render').length
}
function lastProjection(actor: ObservedWorker) {
  const request = projections(actor).at(-1)
  if (!request) expect.unreachable('An applied projection is required')
  return request
}
function assertCorrelation(actor: ObservedWorker) {
  for (const response of actor.responses) {
    if (response.type !== 'rendered') continue
    const request = actor.requests.find(
      (request) => request.type === 'render' && request.sequence === response.sequence,
    )
    if (request?.type !== 'render') expect.unreachable('Rendered source request is required')
    expect(response.source?.identity).toEqual(request.source?.identity)
    expect(response.source?.target).toEqual(request.source?.target)
  }
}
async function stable(count: number, revision?: number) {
  await waitFor(
    () =>
      live().length === count &&
      live().every((actor) => {
        const request = actor.requests.findLast((request) => request.type === 'render')
        const response = actor.responses.findLast((response) => response.type === 'rendered')
        return (
          request?.type === 'render' &&
          response?.type === 'rendered' &&
          request.sequence === response.sequence &&
          (revision === undefined || response.source?.target.revision === revision)
        )
      }),
  )
}
async function twoFrames() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}
async function waitFor(test: () => boolean) {
  const end = performance.now() + 5_000
  while (!test()) {
    if (performance.now() >= end) {
      console.info('minimap integration timeout', {
        actors: actors.map((actor) => ({
          terminated: actor.terminated,
          requests: actor.requests.map((request) => request.type),
          projected: projections(actor).at(-1)?.target,
          render: actor.requests.findLast((request) => request.type === 'render')?.source?.target,
          responses: actor.responses.map((response) => response.type),
        })),
        views: contexts.map((context) => {
          const snapshot = context().getSnapshot()
          return {
            geometry: snapshot.geometryCommitted,
            revision: snapshot.documentSyncPoint.revision,
            textVersion: snapshot.textVersion,
            width: snapshot.viewport.clientWidth,
            height: snapshot.viewport.clientHeight,
          }
        }),
      })
      throw new TypeError('Minimap integration did not settle')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function observedWorkerConstructor() {
  return class extends NativeWorker {
    public readonly requests: MinimapWorkerRequest[] = []
    public readonly responses: MinimapWorkerResponse[] = []
    public terminated = false
    public constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      actors.push(this)
      this.addEventListener('message', (event: MessageEvent<MinimapWorkerResponse>) =>
        this.responses.push(event.data),
      )
    }
    public override postMessage(
      request: MinimapWorkerRequest,
      transfer?: Transferable[] | StructuredSerializeOptions,
    ) {
      this.requests.push(request)
      if (Array.isArray(transfer)) {
        super.postMessage(request, transfer)
        return
      }
      super.postMessage(request, transfer)
    }
    public override terminate() {
      this.terminated = true
      super.terminate()
    }
  }
}
