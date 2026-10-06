import { expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../../src/documentSession'
import { DocumentDelivery } from '../../src/editor/documentDelivery'
import { createShikiDocumentOperation, createShikiWorkerOwner } from '../../src/shiki/workerClient'
import type { ShikiWorkerRequest, ShikiWorkerResponse } from '../../src/shiki/workerTypes'
import { createEditorDocumentAnalysis } from '../../src/editor/documentAnalysis'
import { createShikiHighlighterProvider } from '../../src/shiki/plugin'

it.each([false, true])('rejects work queued before owner disposal, cached=%s', async (cached) => {
  const owner = createShikiWorkerOwner()
  const [language, theme] = await Promise.all([
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
  ])
  const provider = createShikiHighlighterProvider({
    workerOwner: owner,
    resolveLanguage: async () => language.default,
    resolveTheme: async () => ({ ...theme.default, name: 'github-dark' }),
  })
  const buffer = createEditorTextBuffer('const queued = 1;')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'queued.ts' })
  const audience = analysis.contributions.createAudience()
  const accept = vi.fn()
  try {
    if (cached)
      expect(
        (
          await analysis.contributions.request(
            provider.operation,
            { languageId: 'typescript' },
            { kind: 'latest', audience },
          ).settled
        ).kind,
      ).toBe('completed')
    const task = analysis.contributions.request(
      provider.operation,
      { languageId: 'typescript' },
      { kind: 'latest', audience, accept },
    )
    await owner.dispose()
    expect((await task.settled).kind).toBe('superseded')
    expect(accept).not.toHaveBeenCalled()
    expect(owner.inspect().workerGeneration).toBe(cached ? 1 : 0)
  } finally {
    audience.dispose()
    analysis.dispose()
    await owner.dispose()
  }
})

it('settles an admitted registration wait when its physical owner is disposed', async () => {
  const owner = createShikiWorkerOwner()
  const [language, theme] = await Promise.all([
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
  ])
  let started = () => {}
  const registrationStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let release = () => {}
  const held = new Promise<typeof language.default>((resolve) => {
    release = () => resolve(language.default)
  })
  const readyProvider = createShikiHighlighterProvider({
    workerOwner: owner,
    resolveLanguage: async () => language.default,
    resolveTheme: async () => ({ ...theme.default, name: 'github-dark' }),
  })
  const heldProvider = createShikiHighlighterProvider({
    workerOwner: owner,
    resolveLanguage: () => {
      started()
      return held
    },
    resolveTheme: async () => ({ ...theme.default, name: 'github-dark' }),
  })
  const readyBuffer = createEditorTextBuffer('const ready = 1;')
  const heldBuffer = createEditorTextBuffer('const held = 1;')
  const readyAnalysis = createEditorDocumentAnalysis({
    buffer: readyBuffer,
    documentId: 'ready.ts',
  })
  const heldAnalysis = createEditorDocumentAnalysis({ buffer: heldBuffer, documentId: 'held.ts' })
  const readyLease = readyAnalysis.borrowHighlighter({
    provider: readyProvider,
    languageId: 'typescript',
  })!
  const heldLease = heldAnalysis.borrowHighlighter({
    provider: heldProvider,
    languageId: 'typescript',
  })!
  const settled = vi.fn()
  try {
    expect((await readyLease.refresh(readyBuffer.getTextSnapshot())).tokens.length).toBeGreaterThan(
      0,
    )
    const result = heldLease.refresh(heldBuffer.getTextSnapshot()).then(
      (value) => {
        settled()
        return value
      },
      (error) => {
        settled()
        throw error
      },
    )
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await registrationStarted
    await owner.dispose()
    await rejected
    expect(settled).toHaveBeenCalledOnce()
    await owner.awaitIdleFence()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
    release()
    await Promise.resolve()
    expect(owner.inspect().workerGeneration).toBe(1)
  } finally {
    release()
    readyLease.dispose()
    heldLease.dispose()
    readyAnalysis.dispose()
    heldAnalysis.dispose()
    await owner.dispose()
  }
})

it.each(['open', 'recolor'] as const)(
  'records a dispatched obsolete %s before sending the newest incremental edit',
  async (phase) => {
    const buffer = createEditorTextBuffer('const first = 1;')
    const view = createEditorBufferSession(buffer)
    const delivery = new DocumentDelivery(buffer, 'cancel.ts')
    const scope = delivery.createScope()
    const requests: ShikiWorkerRequest[] = []
    let held: MessageEvent<ShikiWorkerResponse> | null = null
    let received = () => {}
    const firstReply = new Promise<void>((resolve) => {
      received = resolve
    })
    const worker = new Worker(new URL('../../src/shiki/shiki.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener('message', (event: MessageEvent<ShikiWorkerResponse>) => {
      const request = requests.find((request) => request.id === event.data.id)
      if (request?.payload.type !== phase || held) return
      event.stopImmediatePropagation()
      held = event
      received()
    })
    const post = worker.postMessage.bind(worker)
    vi.spyOn(worker, 'postMessage').mockImplementation((request: ShikiWorkerRequest) => {
      requests.push(request)
      post(request)
    })
    const owner = createShikiWorkerOwner({ workerFactory: () => worker })
    const [language, theme, light] = await Promise.all([
      import('@shikijs/langs/typescript'),
      import('@shikijs/themes/github-dark'),
      import('@shikijs/themes/github-light'),
    ])
    let selected = 'github-dark'
    const registrations = {
      languageRegistrations: language.default,
      themeRegistration: { ...theme.default, name: 'github-dark' },
      themeRegistrations: [],
    }
    const initialRead = delivery.current()!
    const runtime = createShikiDocumentOperation(owner, {
      documentId: 'cancel.ts',
      runtimeSessionId: 'cancel-shiki',
      languageId: 'typescript',
      source: scope.source,
      initialRead,
      lang: 'typescript',
      theme: 'github-dark',
      registrations,
      resolveTheme: (current) =>
        current === selected
          ? null
          : {
              theme: selected,
              registrations: {
                ...registrations,
                themeRegistration: { ...light.default, name: selected },
              },
            },
    })!
    if (phase === 'recolor') {
      await runtime.analyze(initialRead, new AbortController().signal)
      selected = 'github-light'
    }
    const work = new AbortController()
    const old = runtime.analyze(initialRead, work.signal)
    const obsolete = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await firstReply
      work.abort()
      view.applyEdits([{ from: 6, to: 11, text: 'newest' }])
      const latest = runtime.analyze(delivery.current()!, new AbortController().signal)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(
        requests.filter(
          (request) =>
            request.payload.type === 'open' ||
            request.payload.type === 'edit' ||
            request.payload.type === 'recolor',
        ),
      ).toHaveLength(phase === 'open' ? 1 : 2)
      expect(held).not.toBeNull()
      worker.onmessage?.call(worker, held!)
      await obsolete
      const result = await latest
      expect(result.tokens.length).toBeGreaterThan(0)
      expect(
        result.tokens.toTokens().every((token) => token.end <= buffer.getTextSnapshot().length),
      ).toBe(true)
      const edits = requests.filter((request) => request.payload.type === 'edit')
      expect(edits).toHaveLength(1)
      expect(edits[0]?.payload).toMatchObject({
        previousPoint: { revision: 0 },
        edits: [{ from: 6, to: 11, text: 'newest' }],
      })
      await owner.awaitIdleFence()
      expect(owner.inspect().pendingRequests).toBe(0)
    } finally {
      runtime.dispose()
      scope.dispose()
      delivery.dispose()
      await owner.dispose()
      vi.restoreAllMocks()
    }
  },
)
