import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentTextSnapshot } from '../../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createShikiWorkerOwner, type ShikiWorkerOwner } from '../../src/shiki/workerClient'
import type { ShikiWorkerResponse } from '../../src/shiki/workerTypes'

const owners = new Set<ShikiWorkerOwner>()

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
  const session = owner.createSession({
    documentId: 'shared.ts',
    runtimeSessionId,
    languageId: 'typescript',
    lang: 'typescript',
    theme: 'github-dark',
    registrations: await registrations(),
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot),
  })!
  expect(
    (await session.refresh(createDocumentTextSnapshot(snapshot))).tokens.length,
  ).toBeGreaterThan(0)
  return { session, snapshot, text }
}

describe('real Shiki worker retention', () => {
  it('fences documents and keeps shared resources distinct through disposal and recreation', async () => {
    const owner = createShikiWorkerOwner()
    owners.add(owner)
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
      const session = owner.createSession({
        documentId: 'shared.ts',
        runtimeSessionId,
        languageId: 'typescript',
        lang: 'typescript',
        theme: 'github-dark',
        registrations: resolved,
        snapshot,
        textSnapshot: createDocumentTextSnapshot(snapshot),
      })!
      const refresh = session.refresh(createDocumentTextSnapshot(snapshot))
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
    await owner.request({
      type: 'open',
      documentId: 'shared.ts',
      runtimeSessionId: 'retention-first',
      lang: 'typescript',
      theme: 'github-dark',
      ...resolved,
      text: firstText,
      maxLineLength: owner.maxTokenizationLineLength(),
    })
    expect((await owner.inspectRetention())?.documentCount).toBe(1)

    const pendingRegistrations = deferred<typeof resolved>()
    const pendingSnapshot = createPieceTableSnapshot(firstText)
    const pendingText = createDocumentTextSnapshot(pendingSnapshot)
    const pendingSession = owner.createSession({
      documentId: 'pending.ts',
      runtimeSessionId: 'retention-pending',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: pendingRegistrations.promise,
      snapshot: pendingSnapshot,
      textSnapshot: pendingText,
    })!
    const materialize = pendingText.materializeFullText.bind(pendingText)
    const enteredRegistrationWait = deferred<void>()
    let fullTextReads = 0
    pendingText.materializeFullText = () => {
      const text = materialize()
      fullTextReads += 1
      enteredRegistrationWait.resolve()
      return text
    }
    const pendingRefresh = observeSettlement(pendingSession.refresh(pendingText))
    await enteredRegistrationWait.promise
    expect(fullTextReads).toBe(1)
    pendingSession.dispose()
    const pendingInspection = observeSettlement(owner.inspectRetention())
    const pendingFence = observeSettlement(owner.awaitIdleFence())
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(pendingRefresh.settled).toBe(false)
    expect(pendingInspection.settled).toBe(false)
    expect(pendingFence.settled).toBe(false)
    expect(owner.inspect().pendingRequests).toBe(0)
    pendingRegistrations.resolve(resolved)
    expect((await pendingRefresh.promise).tokens.length).toBe(0)
    expect(await pendingInspection.promise).toEqual(surviving)
    expect(await pendingFence.promise).toBeUndefined()
    expect(fullTextReads).toBe(1)

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
      shared: { highlighterCount: 1 },
    })
    const generation = owner.inspect().workerGeneration
    await owner.dispose()
    expect(await owner.inspectRetention()).toBeNull()
    expect(owner.inspect().workerGeneration).toBe(generation)
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
      expect(await first.owner.request({ type: 'idleFence' })).toBeUndefined()
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
      const updated = createPieceTableSnapshot('const survivorUpdated = 42;\n')
      expect(
        (await survivorDocument.session.refresh(createDocumentTextSnapshot(updated))).tokens.length,
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

      expect(
        (await firstDocument.session.refresh(createDocumentTextSnapshot(firstDocument.snapshot)))
          .tokens.length,
      ).toBeGreaterThan(0)
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
