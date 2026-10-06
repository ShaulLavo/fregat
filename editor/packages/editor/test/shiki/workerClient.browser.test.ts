import type { ShikiWorkerRequest, ShikiWorkerRequestPayload } from '../../src/shiki/workerTypes'
import { createHighlighterDocument } from './documentFixture'
import { readAll } from '../factories/snapshotText'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  type DocumentSessionChange,
} from '../../src'

import {
  createShikiWorkerOwner,
  type ShikiResolvedRegistrations,
  type ShikiWorkerOwner,
} from '../../src/shiki'

const createChange = (
  text: string,
  ...edits: readonly { from: number; to: number; text: string }[]
) =>
  ((snapshot = createPieceTableSnapshot(text)) => ({
    kind: 'edit',
    edits,
    transaction: null,
    textSnapshot: createDocumentTextSnapshot(snapshot, text),
    snapshot,
    selections: { selections: [], normalized: true },
    timings: [],
    canUndo: false,
    canRedo: false,
    isDirty: true,
    logicalRevisionCount: 1,
    logicalRevisionScope: null,
  }))() satisfies DocumentSessionChange

describe.skipIf(typeof Worker === 'undefined')('Shiki worker highlighter', () => {
  let workerOwner: ShikiWorkerOwner
  const requestsObserved = vi.fn<(payload: ShikiWorkerRequestPayload) => void>()
  const actualWorkers: Worker[] = []
  const nativePosts = new Map<Worker, (request: ShikiWorkerRequest) => void>()
  function observedOwner(options: Parameters<typeof createShikiWorkerOwner>[0] = {}) {
    return createShikiWorkerOwner({
      ...options,
      workerFactory: () => {
        const worker =
          options.workerFactory?.() ??
          new Worker(new URL('../../src/shiki/shiki.worker.ts', import.meta.url), {
            type: 'module',
          })
        actualWorkers.push(worker)
        const post = worker.postMessage.bind(worker)
        nativePosts.set(worker, post)
        vi.spyOn(worker, 'postMessage').mockImplementation((request: ShikiWorkerRequest) => {
          if (['open', 'edit', 'recolor'].includes(request.payload.type))
            requestsObserved(request.payload)
          post(request)
        })
        return worker
      },
    })
  }

  /** What a session opened directly on `text` reports, to compare a spliced answer against. */
  async function fullTokens(text: string) {
    const fresh = createHighlighterDocument(workerOwner, {
      documentId: 'fresh.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(text), text)),
    })
    const result = await fresh!.run()
    fresh!.dispose()
    return result.tokens.toTokens()
  }

  beforeEach(() => {
    requestsObserved.mockClear()
    actualWorkers.length = 0
    nativePosts.clear()
    workerOwner = observedOwner()
  })

  afterEach(async () => {
    await workerOwner.dispose()
  })

  it('recolors the same worker document and keeps subsequent edits incremental', async () => {
    const dark = await resolveRegistrations()
    const lightTheme = (await import('@shikijs/themes/github-light')).default
    const light = { ...dark, themeRegistration: { ...lightTheme, name: 'github-light' } }
    let selected = { theme: 'github-dark', registrations: dark }
    const text = 'const value = `hello ${42}`;'
    const snapshot = createPieceTableSnapshot(text)
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'recolor.ts',
      lang: 'typescript',
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot, text)),
      ...selected,
      resolveTheme: () => selected,
    })!
    const requests = requestsObserved
    requests.mockClear()
    const initial = (await session.run()).tokens.toTokens()
    selected = { theme: 'github-light', registrations: light }
    const recolored = (await session.run()).tokens.toTokens()
    expect(recolored).not.toEqual(initial)
    const editedText = text.replace('42', 'value')
    const edited = await session.edit(
      createChange(editedText, {
        from: text.indexOf('42'),
        to: text.indexOf('42') + 2,
        text: 'value',
      }).edits,
    )
    expect(requests.mock.calls.map(([payload]) => payload.type)).toEqual([
      'open',
      'recolor',
      'edit',
      'edit',
    ])
    const fresh = createHighlighterDocument(workerOwner, {
      documentId: 'fresh-light.ts',
      lang: 'typescript',
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(editedText), editedText)),
      ...selected,
    })!
    expect(edited.tokens.toTokens()).toEqual((await fresh.run()).tokens.toTokens())
    selected = { theme: 'github-dark', registrations: dark }
    await session.run()
    expect(requests.mock.calls.slice(-2).map(([payload]) => payload.type)).toEqual([
      'recolor',
      'edit',
    ])
    session.dispose()
    fresh.dispose()
  })

  it('tokenizes code through the real browser Worker', async () => {
    const text = 'const value = 1;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(text), text)),
    })

    expect(session).not.toBeNull()

    const result = await session!.run()

    expect(result.tokens.length).toBeGreaterThan(0)
    expect(
      result.tokens.toTokens().every((token) => token.start >= 0 && token.end <= text.length),
    ).toBe(true)
    session!.dispose()
  })

  it('loads theme colors without a highlighter session', async () => {
    const theme = await workerOwner.loadTheme({
      theme: 'github-dark',
      registrations: resolveRegistrations(),
    })

    expect(theme?.backgroundColor).toBeTruthy()
    expect(theme?.foregroundColor).toBeTruthy()
  })

  it('updates tokens after an incremental edit', async () => {
    const initialText = 'const a = 1;'
    const nextText = 'const answer = 1;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText)),
    })

    expect(session).not.toBeNull()

    await session!.run()
    const result = await session!.edit(
      createChange(nextText, { from: 6, to: 7, text: 'answer' }).edits,
    )

    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.tokens.toTokens().some((token) => token.end > initialText.length)).toBe(true)
    // The edit answered with its own lines only; spliced in, they equal a full tokenization.
    expect(result.tokens.toTokens()).toEqual(await fullTokens(nextText))
    session!.dispose()
  })

  it('composes skipped canonical edits before updating worker tokens', async () => {
    const initialText = 'const a = 1;'
    const nextText = 'const answer = 1;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText)),
    })

    expect(session).not.toBeNull()

    await session!.run()
    session.view.applyEdits([{ from: 6, to: 7, text: 'answe' }])
    const result = await session!.edit(
      createChange(nextText, { from: 11, to: 11, text: 'r' }).edits,
    )

    expect(result.tokens.toTokens().some((token) => token.start === 6 && token.end === 12)).toBe(
      true,
    )
    session!.dispose()
  })

  it('catches up and changes history branches without reading or sending whole text', async () => {
    const original = 'const value = "😀";\nconst other = 2;'
    const initial = createPieceTableSnapshot(original)
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'catch-up.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(initial, original)),
    })!
    await session.run()
    const requests = requestsObserved
    requests.mockClear()
    session.view.applyEdits([{ from: 6, to: 11, text: 'answer' }])
    session.view.applyEdits([{ from: 12, to: 12, text: 'X' }])
    const changedText = 'const answerX = "😀";\nconst other = 2;'
    const materialize = vi.spyOn(session.buffer, 'materializeFullText')
    const caughtUp = await session.run()
    session.view.undo()
    const restored = await session.undo()
    const unchanged = await session.run()
    expect(materialize).not.toHaveBeenCalled()
    const payloads = requests.mock.calls.map(([payload]) => payload)
    expect(payloads).toMatchObject([
      { type: 'edit', edits: [{ from: 6, to: 11, text: 'answerX' }] },
      { type: 'edit', edits: [{ from: 6, to: 13, text: 'value' }] },
      { type: 'edit', edits: [] },
    ])
    for (const payload of payloads) {
      expect(Object.keys(payload).toSorted()).toEqual(
        [
          'documentId',
          'edits',
          'lang',
          'runtimeSessionId',
          'theme',
          'type',
          'source',
          'previousPoint',
        ].toSorted(),
      )
    }
    expect(caughtUp.tokens.toTokens()).toEqual(await fullTokens(changedText))
    expect(restored.tokens.toTokens()).toEqual(await fullTokens(original))
    expect(unchanged.tokens.toTokens()).toEqual(restored.tokens.toTokens())
    session.dispose()
  })

  it('opens from the latest snapshot when a change arrives before refresh', async () => {
    const text = 'const value = 1;'
    const nextText = 'const answer = 1;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'unopened.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(text), text)),
    })!
    const result = await session.edit([{ from: 6, to: 11, text: 'answer' }])
    expect(result.tokens.toTokens()).toEqual(await fullTokens(nextText))
    session.dispose()
  })

  it.each(['refresh', 'change'] as const)(
    'reopens after a worker generation changes during %s',
    async (operation) => {
      const workers: Worker[] = []
      workerOwner = observedOwner({
        workerFactory: () => {
          const worker = new Worker(new URL('../../src/shiki/shiki.worker.ts', import.meta.url), {
            type: 'module',
          })
          workers.push(worker)
          return worker
        },
      })
      const text = 'const value = 1;'
      const initial = createPieceTableSnapshot(text)
      const registrations = await resolveRegistrations()
      const session = createHighlighterDocument(workerOwner, {
        documentId: 'restart.ts',
        languageId: 'typescript',
        lang: 'typescript',
        theme: 'github-dark',
        registrations,
        text: readAll(createDocumentTextSnapshot(initial, text)),
      })!
      await session.run()
      workers[0]!.dispatchEvent(new ErrorEvent('error', { message: 'controlled worker loss' }))
      // Another consumer can restart the owner before this session next runs.
      await workerOwner.loadTheme({ theme: 'github-dark', registrations })
      const requests = requestsObserved
      requests.mockClear()
      requests.mockClear()
      const result =
        operation === 'refresh' ? await session.run() : await session.edit(createChange(text).edits)
      expect(requests.mock.calls[0]?.[0]).toMatchObject({
        type: 'open',
        source: { point: { revision: 0 } },
      })
      expect(result.tokens.toTokens()).toEqual(await fullTokens(text))
      session.dispose()
    },
  )

  it('queues catch-up behind a slow request and drops work after disposal', async () => {
    const text = 'const value = 1;'
    const initial = createPieceTableSnapshot(text)
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'queued.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(initial, text)),
    })!
    await session.run()
    const firstEdit = { from: 6, to: 11, text: 'answer' }
    const worker = actualWorkers.at(-1)!
    const post = nativePosts.get(worker)!
    let release: () => void = () => expect.unreachable('The domain request was not held')
    let holding = true
    const requests = requestsObserved
    requests.mockClear()
    vi.spyOn(worker, 'postMessage').mockImplementation((request: ShikiWorkerRequest) => {
      if (request.payload.type === 'edit' && holding) {
        holding = false
        requestsObserved(request.payload)
        release = () => post(request)
        return
      }
      post(request)
    })
    const first = session.edit([firstEdit])
    const next = session.undo()
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1))
    release()
    await first
    expect((await next).tokens.toTokens()).toEqual(await fullTokens(text))
    session.dispose()
    await expect(session.run()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('applies a multi-edit change as one batch of incremental edits', async () => {
    const initialText = 'const a = 1;\nconst b = 2;'
    const nextText = 'const answer = 1;\nconst basis = 2;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText)),
    })

    expect(session).not.toBeNull()

    await session!.run()
    const result = await session!.edit(
      createChange(
        nextText,
        { from: 6, to: 7, text: 'answer' },
        { from: 19, to: 20, text: 'basis' },
      ).edits,
    )

    expect(result.tokens.toTokens().some((token) => token.start === 6 && token.end === 12)).toBe(
      true,
    )
    expect(result.tokens.toTokens().some((token) => token.start === 24 && token.end === 29)).toBe(
      true,
    )
    expect(result.tokens.toTokens()).toEqual(await fullTokens(nextText))
    session!.dispose()
  })

  it('disposes document tokenizer state', async () => {
    const text = 'const value = 1;'
    const session = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(text), text)),
    })

    expect(session).not.toBeNull()

    await session!.run()
    session!.dispose()

    const nextText = 'const nextValue = 1;'
    const nextSession = createHighlighterDocument(workerOwner, {
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(nextText), nextText)),
    })

    expect(nextSession).not.toBeNull()

    const next = await nextSession!.run()

    expect(next.tokens.length).toBeGreaterThan(0)
    nextSession!.dispose()
  })

  it('isolates equal logical documents by runtime session', async () => {
    const firstText = 'const first = 1;'
    const secondText = 'const second = 2;'
    const first = createHighlighterDocument(workerOwner, {
      documentId: 'shared.ts',
      runtimeSessionId: 'runtime-shiki-first',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(firstText), firstText)),
    })
    const second = createHighlighterDocument(workerOwner, {
      documentId: 'shared.ts',
      runtimeSessionId: 'runtime-shiki-second',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(firstText), secondText)),
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    await Promise.all([first!.run(), second!.run()])
    first!.dispose()
    await workerOwner.awaitRuntimeSessionIdle('runtime-shiki-first')

    const nextText = 'const secondValue = 2;'
    const result = await second!.edit(
      createChange(nextText, { from: 6, to: 12, text: 'secondValue' }).edits,
    )

    expect(result.tokens.toTokens().some((token) => token.end > secondText.length)).toBe(true)
    second!.dispose()
  })
})

async function resolveRegistrations(): Promise<ShikiResolvedRegistrations> {
  const [language, theme] = await Promise.all([
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
  ])
  return {
    languageRegistrations: language.default,
    themeRegistration: {
      ...theme.default,
      name: theme.default.name ?? 'github-dark',
    },
    themeRegistrations: [],
  }
}
