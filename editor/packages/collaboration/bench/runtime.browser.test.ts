import '../src/presence.css'
import { expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { ConfirmedWindow } from '@singapore-editor/collab'
import {
  createTreeSitterReviewSyntax,
  resolveTreeSitterLanguageContribution,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { TreeSitterWorkerClient } from '../../tree-sitter/src/treeSitter/workerClient'
import { lineMergeUnit } from '../../tree-sitter/src/treeSitter/mergeUnits'
import { createDocumentTextSnapshot } from '@singapore-editor/core/document'
import { MergeReviewDetector } from '../src/merge-review'
import { ReviewView } from '../src/review-view'
import { hoverControllerFor } from '@singapore-editor/plugin-ui/hover-registry'
import { EditorRoom } from '../test/editor-fixture'
import { workload } from './workload'

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function editPeers(room: EditorRoom, count: number, lineLength: number) {
  for (let peer = 0; peer < 2; peer++)
    for (let index = 0; index < count; index++) {
      const from = index * lineLength + 21
      room.editors[peer]!.edit({ from, to: from + 1, text: String(peer + 8) })
    }
}

test('measure real worker batches, dense conflicts, mark painting and hover opening', async () => {
  const languages = [
    await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === 'typescript')!,
    ),
  ]
  let allRequests = 0
  const requests: {
    type: string
    start: number
    end?: number
    request: unknown
    result?: unknown
  }[] = []
  const backend = new TreeSitterWorkerClient({
    workerFactory() {
      const worker = new Worker(
        new URL('../../tree-sitter/src/treeSitter/treeSitter.worker.ts', import.meta.url),
        { type: 'module' },
      )
      const pending = new Map<number, (typeof requests)[number]>()
      const send = worker.postMessage.bind(worker)
      worker.postMessage = (message, options?: StructuredSerializeOptions | Transferable[]) => {
        allRequests++
        if (
          message.payload?.type === 'reviewBatch' ||
          message.payload?.type === 'mergeUnit' ||
          message.payload?.type === 'projectMergeUnits'
        ) {
          const sample = { type: message.payload.type, start: performance.now(), request: message }
          requests.push(sample)
          pending.set(message.id, sample)
        }
        if (Array.isArray(options)) send(message, options)
        else send(message, options)
      }
      worker.addEventListener('message', ({ data }) => {
        const sample = pending.get(data.id)
        if (!sample) return
        sample.end = performance.now()
        sample.result = data
        pending.delete(data.id)
      })
      return worker
    },
  })
  const syntax = createTreeSitterReviewSyntax({ languageId: 'typescript', languages, backend })
  const detector = new MergeReviewDetector(syntax)
  const batches: unknown[] = []
  const paints: unknown[] = []
  try {
    for (let pass = -1; pass < 4; pass++) {
      for (const mode of ['ordinary', 'dense', 'dense', 'ordinary'] as const) {
        const { prefix, batch, confirmed } = workload(4, 8192, mode === 'dense' ? 'dense' : false)
        await syntax(confirmed.buffer, [])
        const window = new ConfirmedWindow(prefix)
        window.append(batch)
        requests.length = 0
        allRequests = 0
        const before = performance.now()
        const result = await detector.detect(
          window,
          confirmed,
          batch.map((edit) => edit.id),
        )
        const elapsedMs = performance.now() - before
        expect(result.status).toBe('complete')
        expect(result.marks.filter((mark) => mark.kind === 'overlap')).toHaveLength(
          mode === 'dense' ? 50 : 0,
        )
        const messages = requests.map((request) => ({
          type: request.type,
          requestJsonUtf8Bytes: bytes(request.request),
          resultJsonUtf8Bytes: bytes(request.result),
          roundTripMs: request.end! - request.start,
          sentAtEpochMs: performance.timeOrigin + request.start,
          receivedAtEpochMs: performance.timeOrigin + request.end!,
          workerProfile:
            (request.result as { result?: { profile?: unknown } } | undefined)?.result?.profile ??
            null,
        }))
        expect(messages.every((message) => Number.isFinite(message.roundTripMs))).toBe(true)
        const workerRequests = allRequests
        expect(messages).toHaveLength(1)
        expect(workerRequests).toBe(1)
        const serial = new MergeReviewDetector((...args) => syntax(...args))
        expect(
          await serial.detect(
            window,
            confirmed,
            batch.map((edit) => edit.id),
          ),
        ).toEqual(result)
        const markHash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result))),
          ),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
        if (pass >= 0)
          batches.push({
            mode,
            elapsedMs,
            marks: result.marks.length,
            messages,
            workerRequests,
            markHash,
            exactMarkEquality: true,
          })
        await syntax.release()
      }
    }
    for (let pass = -1; pass < 4; pass++) {
      for (const count of [1, 50, 50, 1]) {
        const updates: number[] = []
        const update = ReviewView.prototype.update
        const spy = vi.spyOn(ReviewView.prototype, 'update').mockImplementation(function (
          this: ReviewView,
          ...args
        ) {
          const before = performance.now()
          update.apply(this, args)
          updates.push(performance.now() - before)
        })
        const line = 'export const value = 1234567890;\n'
        const room = new EditorRoom(2, line.repeat(100_000), true, {
          syntax: async (snapshot, ranges) =>
            ranges.map((range) => [
              {
                ...lineMergeUnit(createDocumentTextSnapshot(snapshot), range),
                languageId: 'typescript',
                hasErrors: false,
              },
            ]),
        })
        try {
          await expect
            .poll(
              () =>
                Array.from(room.host.querySelectorAll<HTMLElement>('*')).filter(
                  (element) => hoverControllerFor(element) !== null,
                ).length,
            )
            .toBe(2)
          await frames()
          updates.length = 0
          editPeers(room, count, line.length)
          room.flush()
          await Promise.all(room.connections.map(({ review }) => review!.idle()))
          await frames()
          expect(room.connections.map(({ review }) => review!.marks.length)).toEqual([count, count])
          const dots = room.host.querySelectorAll('.editor-merge-review-dot').length
          expect(dots).toBeGreaterThan(0)
          const paintUpdates = updates.slice()
          room.editors[0]!.focus()
          room.editors[0]!.setSelection(21, 21)
          await frames()
          const before = performance.now()
          expect(room.editors[0]!.dispatchCommand('editor.action.showHover')).toBe(true)
          await expect
            .poll(() =>
              Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
                (node) => !node.hidden && node.textContent?.includes('Keep theirs'),
              ),
            )
            .toBe(true)
          await frames()
          const hoverOpenThroughTwoFramesMs = performance.now() - before
          if (pass >= 0)
            paints.push({
              marksPerEditor: count,
              dots,
              updateCalls: paintUpdates.length,
              updateMs: paintUpdates,
              hoverOpenThroughTwoFramesMs,
            })
          if (pass === 0 && count === 50) await commands.editorLook('dense-review-hover')
        } finally {
          room.dispose()
          spy.mockRestore()
          document.body.replaceChildren()
        }
      }
    }
    await commands.editorExperiment({
      qualification: 'experiment, shared machine',
      environment: { userAgent: navigator.userAgent, platform: navigator.platform },
      method:
        'A/B/B/A per pass; one warmup pass then four measured passes (eight samples per shape). Real parser worker over 100k TypeScript lines, four authors, 8192 retained records and 100 edits. Ordinary has no marks; dense has 50 conflicting units. Current parsing/window setup are excluded; complete detector includes projections. Message timestamps wrap actual Worker.postMessage and message events, including worker query work. UTF-8 JSON lengths are a reproducible payload-size proxy, not structured-clone wire bytes. UI uses real two-peer sessions and ReviewView over 100k lines with an injected line syntax reader to isolate painting from parsing. One/50 marks per editor. Update timers include highlight/gutter geometry and DOM work; hover timer includes dispatch, polling and two frames, not isolated CPU or compositor presentation. Linux timing is diagnostic only; timing verdicts require the Mac turn on AC. No React components participate in this editor surface.',
      batches,
      paints,
    })
  } finally {
    await syntax.dispose()
    await backend.dispose()
  }
}, 240_000)
