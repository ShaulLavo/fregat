import { createEditorTextBuffer } from '../../src/documentSession'
import { createEditorDocumentAnalysis } from '../../src/editor/documentAnalysis'
import { createShikiHighlighterProvider } from '../../src/shiki/plugin'
import type { ShikiWorkerRequest, ShikiWorkerRequestPayload } from '../../src/shiki/workerTypes'
import { createHighlighterDocument } from './documentFixture'
import { readAll } from '../factories/snapshotText'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentTextSnapshot } from '../../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createShikiWorkerOwner, type ShikiWorkerOwner } from '../../src/shiki/workerClient'
import type { ShikiWorkerResponse } from '../../src/shiki/workerTypes'

const owners = new Set<ShikiWorkerOwner>()
let externalId = 1000000

afterEach(async () => {
  await Promise.all(Array.from(owners, (owner) => owner.dispose()))
  owners.clear()
})

async function registrations() {
  const [language, theme] = await Promise.all([
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
  ])
  return {
    languageRegistrations: language.default,
    themeRegistration: { ...theme.default, name: 'github-dark' },
    themeRegistrations: [],
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => expect.unreachable('Uninitialized gate')
  const promise = new Promise<T>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

function observeSettlement<T>(promise: Promise<T>) {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  return {
    promise,
    get settled() {
      return settled
    },
  }
}

type HeldReply = {
  readonly response: ShikiWorkerResponse
  deliver(): void
}

function workerTransport() {
  const worker = new Worker(new URL('../../src/shiki/shiki.worker.ts', import.meta.url), {
    type: 'module',
  })
  const requests: ShikiWorkerRequest[] = []
  const post = worker.postMessage.bind(worker)
  vi.spyOn(worker, 'postMessage').mockImplementation((request: ShikiWorkerRequest) => {
    requests.push(request)
    post(request)
  })
  let hold: ReturnType<typeof deferred<HeldReply>> | null = null
  worker.addEventListener('message', (event: MessageEvent<ShikiWorkerResponse>) => {
    if (!event.data.ok || !event.data.result?.retention || !hold) return
    event.stopImmediatePropagation()
    const receive = worker.onmessage
    if (!receive) expect.unreachable('Owner message handler was not installed')
    const current = hold
    hold = null
    current.resolve({ response: event.data, deliver: () => receive.call(worker, event) })
  })
  return {
    worker,
    requests,
    request(payload: ShikiWorkerRequestPayload): Promise<ShikiWorkerResponse> {
      const id = externalId++
      return new Promise((resolve) => {
        const receive = (event: MessageEvent<ShikiWorkerResponse>) => {
          if (event.data.id !== id) return
          worker.removeEventListener('message', receive)
          resolve(event.data)
        }
        worker.addEventListener('message', receive)
        worker.postMessage({ id, payload })
      })
    },
    holdNextReply() {
      expect(hold).toBeNull()
      const next = deferred<HeldReply>()
      hold = next
      return next.promise
    },
  }
}

function transportOwner() {
  const transports: ReturnType<typeof workerTransport>[] = []
  const owner = createShikiWorkerOwner({
    workerFactory: () => {
      const transport = workerTransport()
      transports.push(transport)
      return transport.worker
    },
  })
  owners.add(owner)
  return { owner, transports }
}

async function populate(owner: ShikiWorkerOwner, runtimeSessionId: string) {
  const text = `const ${runtimeSessionId} = true;`
  const snapshot = createPieceTableSnapshot(text)
  const session = createHighlighterDocument(owner, {
    documentId: 'shared.ts',
    runtimeSessionId,
    languageId: 'typescript',
    lang: 'typescript',
    theme: 'github-dark',
    registrations: await registrations(),
    text: readAll(createDocumentTextSnapshot(snapshot)),
  })!
  expect((await session.run()).tokens.length).toBeGreaterThan(0)
  return { session, snapshot, text }
}

describe('real Shiki worker retention', () => {
  it('fences documents and keeps shared resources distinct through disposal and recreation', async () => {
    const { owner, transports } = transportOwner()
    expect(await owner.inspectRetention()).toBeNull()
    expect(await owner.awaitIdleFence()).toBeUndefined()
    expect(owner.inspect().workerGeneration).toBe(0)
    const resolved = await registrations()
    await owner.loadTheme({ theme: 'github-dark', registrations: resolved })
    const empty = await owner.inspectRetention()
    expect(empty).toMatchObject({
      documentCount: 0,
      tokenizerCount: 0,
      lineCount: 0,
      tokenCount: 0,
    })
    expect(empty?.shared.highlighterCount).toBe(1)

    const open = (runtimeSessionId: string, text: string) => {
      const snapshot = createPieceTableSnapshot(text)
      const session = createHighlighterDocument(owner, {
        documentId: 'shared.ts',
        runtimeSessionId,
        languageId: 'typescript',
        lang: 'typescript',
        theme: 'github-dark',
        registrations: resolved,
        text: readAll(createDocumentTextSnapshot(snapshot)),
      })!
      const refresh = session.run()
      return { session, refresh }
    }
    const firstText = 'const value = 1;\nconst next = value;\n'
    const first = open('retention-first', firstText)
    const second = open('retention-survivor', 'const survivor = true;')
    const retained = await owner.inspectRetention()
    await Promise.all([first.refresh, second.refresh])
    expect(retained).toMatchObject({ documentCount: 2, tokenizerCount: 2, lineCount: 4 })
    expect(retained?.tokenCount).toBeGreaterThan(0)
    expect(retained?.documents).toEqual([
      expect.objectContaining({
        documentId: 'shared.ts',
        runtimeSessionId: 'retention-first',
        sourceUnits: firstText.length,
        lineCount: 3,
      }),
      expect.objectContaining({ documentId: 'shared.ts', runtimeSessionId: 'retention-survivor' }),
    ])
    expect(retained?.shared.highlighterCount).toBe(1)
    expect(retained?.shared.highlighters[0]?.languageNames).toContain('typescript')
    expect(retained?.shared.highlighters[0]?.themeNames).toContain('github-dark')
    expect(retained?.unmeasuredBytes).toContain('tokenizer-states')
    expect(retained?.unmeasuredBytes).toContain('wasm-allocator-live')

    first.session.dispose()
    const surviving = await owner.inspectRetention()
    expect(surviving?.documents.map((document) => document.runtimeSessionId)).toEqual([
      'retention-survivor',
    ])
    expect(surviving?.shared).toEqual(retained?.shared)
    const firstOpen = transports[0]!.requests.find(
      (request) =>
        request.payload.type === 'open' && request.payload.runtimeSessionId === 'retention-first',
    )?.payload
    if (firstOpen?.type !== 'open')
      throw new TypeError('The real first runtime must have opened before retirement')
    await transports[0]!.request(firstOpen)
    expect((await owner.inspectRetention())?.documentCount).toBe(1)

    const pendingRegistrations = deferred<typeof resolved>()
    const pendingBuffer = createEditorTextBuffer(firstText)
    const pendingAnalysis = createEditorDocumentAnalysis({
      buffer: pendingBuffer,
      documentId: 'pending.ts',
    })
    const entered = deferred<void>()
    const pendingProvider = createShikiHighlighterProvider({
      workerOwner: owner,
      theme: 'github-dark',
      resolveLanguage: async () => {
        entered.resolve()
        return (await pendingRegistrations.promise).languageRegistrations
      },
      resolveTheme: async () => resolved.themeRegistration,
    })
    const pendingSession = pendingAnalysis.borrowHighlighter({
      provider: pendingProvider,
      languageId: 'typescript',
    })!
    const fullRead = vi.spyOn(pendingBuffer, 'materializeFullText')
    const pendingRefresh = observeSettlement(
      pendingSession.refresh(pendingBuffer.getTextSnapshot()),
    )
    await entered.promise
    pendingAnalysis.dispose()
    pendingSession.dispose()
    await expect(pendingRefresh.promise).rejects.toMatchObject({ name: 'AbortError' })
    const pendingInspection = observeSettlement(owner.inspectRetention())
    const pendingFence = observeSettlement(owner.awaitIdleFence())
    expect(await pendingInspection.promise).toEqual({ ...surviving, retiredRuntimeCount: 2 })
    expect(await pendingFence.promise).toBeUndefined()
    expect(owner.inspect().pendingRequests).toBe(0)
    expect(fullRead).not.toHaveBeenCalled()
    pendingRegistrations.resolve(resolved)
    await Promise.resolve()
    expect(
      transports[0]!.requests.some(
        (request) =>
          request.payload.type === 'open' &&
          request.payload.runtimeSessionId === pendingSession.runtimeSessionId,
      ),
    ).toBe(false)

    const recreated = open('retention-recreated', firstText)
    const reacquired = await owner.inspectRetention()
    expect((await recreated.refresh).tokens.length).toBeGreaterThan(0)
    expect(reacquired?.documentCount).toBe(2)
    expect(reacquired?.shared).toEqual(retained?.shared)
    recreated.session.dispose()
    second.session.dispose()
    expect(await owner.inspectRetention()).toMatchObject({
      documentCount: 0,
      tokenizerCount: 0,
      lineCount: 0,
      tokenCount: 0,
      retiredRuntimeCount: 4,
      shared: { highlighterCount: 1 },
    })
    const generation = owner.inspect().workerGeneration
    await owner.dispose()
    expect(await owner.inspectRetention()).toBeNull()
    expect(owner.inspect().workerGeneration).toBe(generation)
  })

  it('bounds retired runtime metadata while preserving a populated survivor', async ({
    annotate,
  }) => {
    const { owner } = transportOwner()
    const survivor = await populate(owner, 'retiredSurvivor')
    const before = await owner.inspectRetention()
    await annotate('retired metadata before disposal', {
      body: JSON.stringify(before),
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
    })
    expect(before?.retiredRuntimeCount).toBe(0)
    if (!before) expect.unreachable('Populated worker retention was absent')
    const limit = before.retiredRuntimeLimit
    expect(Number.isInteger(limit)).toBe(true)
    expect(limit).toBeGreaterThan(0)
    expect(before).toMatchObject({ documentCount: 1, tokenizerCount: 1, lineCount: 1 })
    expect(before.tokenCount).toBeGreaterThan(0)
    expect(before.shared.highlighterCount).toBe(1)

    const retired = await populate(owner, 'retiredFirst')
    expect((await owner.inspectRetention())?.documentCount).toBe(2)
    retired.session.dispose()
    const afterOne = await owner.inspectRetention()
    await annotate('retired metadata after one disposal', {
      body: JSON.stringify(afterOne),
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
    })
    expect(afterOne).toEqual({ ...before, retiredRuntimeCount: 1 })

    const distinctRetirements = limit + 2
    for (let index = 1; index < distinctRetirements; index += 1) {
      await owner.disposeDocument(`retired-bound-${index}`)
    }
    const bounded = await owner.inspectRetention()
    await annotate('retired metadata after exceeding the limit', {
      body: JSON.stringify({ distinctRetirements, before, afterOne, bounded }),
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
    })
    expect(bounded).toEqual({ ...before, retiredRuntimeCount: limit })
    expect(await owner.awaitIdleFence()).toBeUndefined()
    expect((await survivor.session.run()).tokens.length).toBeGreaterThan(0)
    expect(await owner.inspectRetention()).toEqual(bounded)
  })

  it.each(['dispose', 'crash'] as const)(
    'rejects an outstanding inspection on %s and keeps a separate populated owner usable',
    async (teardown) => {
      const first = transportOwner()
      const survivor = transportOwner()
      expect(await first.owner.inspectRetention()).toBeNull()
      expect(await first.owner.awaitIdleFence()).toBeUndefined()
      expect(first.transports).toHaveLength(0)
      const firstDocument = await populate(first.owner, 'first')
      const survivorDocument = await populate(survivor.owner, 'survivor')
      expect(first.transports).toHaveLength(1)
      expect(survivor.transports).toHaveLength(1)
      const transport = first.transports[0]!
      const initial = await first.owner.inspectRetention()
      const survivorBefore = await survivor.owner.inspectRetention()
      expect(initial).toMatchObject({
        documentCount: 1,
        tokenizerCount: 1,
        shared: { highlighterCount: 1 },
      })
      expect(survivorBefore?.documents).toMatchObject([
        { runtimeSessionId: 'survivor', sourceUnits: survivorDocument.text.length },
      ])
      const fenceReply = await transportRequest(first.transports[0]!, { type: 'idleFence' })
      expect(fenceReply.ok).toBe(true)
      if (!fenceReply.ok) throw new TypeError('The actual worker fence must succeed')
      expect(fenceReply.result).toBeUndefined()
      expect(await first.owner.awaitIdleFence()).toBeUndefined()

      const positiveReply = transport.holdNextReply()
      const positiveInspection = observeSettlement(first.owner.inspectRetention())
      const positive = await positiveReply
      expect(first.owner.inspect().pendingRequests).toBe(1)
      expect(positiveInspection.settled).toBe(false)
      positive.deliver()
      expect(await positiveInspection.promise).toEqual(initial)

      const heldReply = transport.holdNextReply()
      const inspection = observeSettlement(first.owner.inspectRetention())
      const error =
        teardown === 'dispose' ? 'Shiki worker disposed' : 'controlled retention worker loss'
      const rejected = expect(inspection.promise).rejects.toThrow(error)
      const late = await heldReply
      expect(inspection.settled).toBe(false)
      expect(first.owner.inspect().pendingRequests).toBe(1)
      const generation = first.owner.inspect().workerGeneration
      if (teardown === 'dispose') await first.owner.dispose()
      if (teardown === 'crash')
        transport.worker.dispatchEvent(new ErrorEvent('error', { message: error }))
      await rejected
      expect(first.owner.inspect()).toMatchObject({
        lifecycle: teardown === 'dispose' ? 'disposed' : 'crashed',
        pendingRequests: 0,
      })
      late.deliver()
      expect(await first.owner.inspectRetention()).toBeNull()
      expect(await first.owner.awaitIdleFence()).toBeUndefined()
      expect(first.owner.inspect().workerGeneration).toBe(generation)
      expect(first.transports).toHaveLength(1)
      expect(await survivor.owner.inspectRetention()).toEqual(survivorBefore)
      const updatedText = 'const survivorUpdated = 42;\n'
      const updated = createPieceTableSnapshot(updatedText)
      expect(
        (
          await survivorDocument.session.edit([
            {
              from: 0,
              to: survivorDocument.session.buffer.getTextSnapshot().length,
              text: updatedText,
            },
          ])
        ).tokens.length,
      ).toBeGreaterThan(0)
      expect(await survivor.owner.inspectRetention()).toMatchObject({
        documentCount: 1,
        tokenizerCount: 1,
        documents: [{ runtimeSessionId: 'survivor', sourceUnits: updated.length, lineCount: 2 }],
        shared: survivorBefore?.shared,
      })
      expect(await survivor.owner.awaitIdleFence()).toBeUndefined()
      expect(survivor.transports).toHaveLength(1)
      if (teardown === 'dispose') return

      expect((await firstDocument.session.run()).tokens.length).toBeGreaterThan(0)
      expect(first.transports).toHaveLength(2)
      expect(first.owner.inspect().workerGeneration).toBe(generation + 1)
      const currentReply = first.transports[1]!.holdNextReply()
      const currentInspection = observeSettlement(first.owner.inspectRetention())
      const current = await currentReply
      expect(current.response.id).not.toBe(late.response.id)
      late.deliver()
      await survivor.owner.awaitIdleFence()
      expect(currentInspection.settled).toBe(false)
      expect(first.owner.inspect().pendingRequests).toBe(1)
      current.deliver()
      expect(await currentInspection.promise).toEqual(initial)
      expect(await first.owner.awaitIdleFence()).toBeUndefined()
    },
  )
})

async function transportRequest(
  transport: ReturnType<typeof workerTransport>,
  payload: ShikiWorkerRequestPayload,
) {
  return transport.request(payload)
}
