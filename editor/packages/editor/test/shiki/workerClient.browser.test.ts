import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyBatchToPieceTable,
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  type DocumentSessionChange,
  type PieceTableSnapshot,
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

  /** What a session opened directly on `text` reports, to compare a spliced answer against. */
  async function fullTokens(text: string) {
    const fresh = workerOwner.createSession({
      documentId: 'fresh.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })
    const result = await fresh!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
    )
    fresh!.dispose()
    return result.tokens.toTokens()
  }

  beforeEach(() => {
    workerOwner = createShikiWorkerOwner()
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
    const session = workerOwner.createSession({
      documentId: 'recolor.ts',
      lang: 'typescript',
      languageId: 'typescript',
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, text),
      ...selected,
      resolveTheme: () => selected,
    })!
    const requests = vi.spyOn(workerOwner, 'request')
    const initial = (await session.refresh(createDocumentTextSnapshot(snapshot))).tokens.toTokens()
    selected = { theme: 'github-light', registrations: light }
    const recolored = (
      await session.refresh(createDocumentTextSnapshot(snapshot))
    ).tokens.toTokens()
    expect(recolored).not.toEqual(initial)
    const editedText = text.replace('42', 'value')
    const edited = await session.applyChange(
      createChange(editedText, {
        from: text.indexOf('42'),
        to: text.indexOf('42') + 2,
        text: 'value',
      }),
    )
    expect(requests.mock.calls.map(([payload]) => payload.type)).toEqual([
      'open',
      'recolor',
      'edit',
    ])
    const fresh = workerOwner.createSession({
      documentId: 'fresh-light.ts',
      lang: 'typescript',
      languageId: 'typescript',
      snapshot: createPieceTableSnapshot(editedText),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(editedText), editedText),
      ...selected,
    })!
    expect(edited.tokens.toTokens()).toEqual(
      (
        await fresh.refresh(createDocumentTextSnapshot(createPieceTableSnapshot(editedText)))
      ).tokens.toTokens(),
    )
    selected = { theme: 'github-dark', registrations: dark }
    await session.refresh(createDocumentTextSnapshot(createPieceTableSnapshot(editedText)))
    expect(requests.mock.calls.at(-1)?.[0].type).toBe('recolor')
    session.dispose()
    fresh.dispose()
  })

  it('tokenizes code through the real browser Worker', async () => {
    const text = 'const value = 1;'
    const session = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(session).not.toBeNull()

    const result = await session!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
    )

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
    const session = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
      snapshot: createPieceTableSnapshot(initialText),
    })

    expect(session).not.toBeNull()

    await session!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
    )
    const result = await session!.applyChange(
      createChange(nextText, { from: 6, to: 7, text: 'answer' }),
    )

    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.tokens.toTokens().some((token) => token.end > initialText.length)).toBe(true)
    // The edit answered with its own lines only; spliced in, they equal a full tokenization.
    expect(result.tokens.toTokens()).toEqual(await fullTokens(nextText))
    session!.dispose()
  })

  it('diffs from cached worker text when earlier UI edits were skipped', async () => {
    const initialText = 'const a = 1;'
    const nextText = 'const answer = 1;'
    const session = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
      snapshot: createPieceTableSnapshot(initialText),
    })

    expect(session).not.toBeNull()

    await session!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
    )
    const result = await session!.applyChange(
      createChange(nextText, { from: 11, to: 11, text: 'r' }),
    )

    expect(result.tokens.toTokens().some((token) => token.start === 6 && token.end === 12)).toBe(
      true,
    )
    session!.dispose()
  })

  it('catches up and changes history branches without reading or sending whole text', async () => {
    const original = 'const value = "😀";\nconst other = 2;'
    const initial = createPieceTableSnapshot(original)
    const session = workerOwner.createSession({
      documentId: 'catch-up.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      snapshot: initial,
      textSnapshot: createDocumentTextSnapshot(initial, original),
    })!
    await session.refresh(createDocumentTextSnapshot(initial, original))
    const requests = vi.spyOn(workerOwner, 'request')
    const intermediate = applyBatchToPieceTable(initial, [{ from: 6, to: 11, text: 'answer' }])
    const next = applyBatchToPieceTable(intermediate, [{ from: 12, to: 12, text: 'X' }])
    const changedText = 'const answerX = "😀";\nconst other = 2;'
    const skipped = changeWithoutFullRead(next, [{ from: 12, to: 12, text: 'X' }])
    const caughtUp = await session.applyChange(skipped)
    const restored = await session.applyChange(changeWithoutFullRead(initial, []))
    const unchanged = await session.applyChange(changeWithoutFullRead(initial, []))
    const payloads = requests.mock.calls.map(([payload]) => payload)
    expect(payloads).toMatchObject([
      { type: 'edit', edits: [{ from: 6, to: 11, text: 'answerX' }] },
      { type: 'edit', edits: [{ from: 6, to: 13, text: 'value' }] },
      { type: 'edit', edits: [] },
    ])
    for (const payload of payloads) {
      expect(Object.keys(payload).toSorted()).toEqual(
        ['documentId', 'edits', 'lang', 'runtimeSessionId', 'theme', 'type'].toSorted(),
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
    const session = workerOwner.createSession({
      documentId: 'unopened.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      snapshot: createPieceTableSnapshot(text),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
    })!
    const result = await session.applyChange(createChange(nextText))
    expect(result.tokens.toTokens()).toEqual(await fullTokens(nextText))
    session.dispose()
  })

  it.each(['refresh', 'change'] as const)(
    'reopens after a worker generation changes during %s',
    async (operation) => {
      const workers: Worker[] = []
      workerOwner = createShikiWorkerOwner({
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
      const session = workerOwner.createSession({
        documentId: 'restart.ts',
        languageId: 'typescript',
        lang: 'typescript',
        theme: 'github-dark',
        registrations,
        snapshot: initial,
        textSnapshot: createDocumentTextSnapshot(initial, text),
      })!
      await session.refresh(createDocumentTextSnapshot(initial, text))
      workers[0]!.dispatchEvent(new ErrorEvent('error', { message: 'controlled worker loss' }))
      // Another consumer can restart the owner before this session next runs.
      await workerOwner.loadTheme({ theme: 'github-dark', registrations })
      const requests = vi.spyOn(workerOwner, 'request')
      const result =
        operation === 'refresh'
          ? await session.refresh(createDocumentTextSnapshot(initial))
          : await session.applyChange(createChange(text))
      expect(requests.mock.calls[0]?.[0]).toMatchObject({ type: 'open', text })
      expect(result.tokens.toTokens()).toEqual(await fullTokens(text))
      session.dispose()
    },
  )

  it('queues catch-up behind a slow request and drops work after disposal', async () => {
    const text = 'const value = 1;'
    const initial = createPieceTableSnapshot(text)
    const session = workerOwner.createSession({
      documentId: 'queued.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      snapshot: initial,
      textSnapshot: createDocumentTextSnapshot(initial, text),
    })!
    await session.refresh(createDocumentTextSnapshot(initial, text))
    const firstEdit = { from: 6, to: 11, text: 'answer' }
    const firstSnapshot = applyBatchToPieceTable(initial, [firstEdit])
    const request = workerOwner.request.bind(workerOwner)
    let release: () => void = () => expect.unreachable('Gate was not initialized')
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests = vi.spyOn(workerOwner, 'request').mockImplementationOnce(async (payload) => {
      await gate
      return request(payload)
    })
    const first = session.applyChange(changeWithoutFullRead(firstSnapshot, [firstEdit]))
    const next = session.applyChange(changeWithoutFullRead(initial, []))
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1))
    release()
    await first
    expect((await next).tokens.toTokens()).toEqual(await fullTokens(text))
    session.dispose()
    expect(
      (await session.applyChange(changeWithoutFullRead(firstSnapshot, []))).tokens.length,
    ).toBe(0)
  })

  it('applies a multi-edit change as one batch of incremental edits', async () => {
    const initialText = 'const a = 1;\nconst b = 2;'
    const nextText = 'const answer = 1;\nconst basis = 2;'
    const session = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
      snapshot: createPieceTableSnapshot(initialText),
    })

    expect(session).not.toBeNull()

    await session!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(initialText), initialText),
    )
    const result = await session!.applyChange(
      createChange(
        nextText,
        { from: 6, to: 7, text: 'answer' },
        { from: 19, to: 20, text: 'basis' },
      ),
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
    const session = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(session).not.toBeNull()

    await session!.refresh(createDocumentTextSnapshot(createPieceTableSnapshot(text), text))
    session!.dispose()

    const nextText = 'const nextValue = 1;'
    const nextSession = workerOwner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(nextText), nextText),
      snapshot: createPieceTableSnapshot(nextText),
    })

    expect(nextSession).not.toBeNull()

    const next = await nextSession!.refresh(
      createDocumentTextSnapshot(createPieceTableSnapshot(nextText), nextText),
    )

    expect(next.tokens.length).toBeGreaterThan(0)
    nextSession!.dispose()
  })

  it('isolates equal logical documents by runtime session', async () => {
    const firstText = 'const first = 1;'
    const secondText = 'const second = 2;'
    const first = workerOwner.createSession({
      documentId: 'shared.ts',
      runtimeSessionId: 'runtime-shiki-first',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(firstText), firstText),
      snapshot: createPieceTableSnapshot(firstText),
    })
    const second = workerOwner.createSession({
      documentId: 'shared.ts',
      runtimeSessionId: 'runtime-shiki-second',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolveRegistrations(),
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(firstText), secondText),
      snapshot: createPieceTableSnapshot(secondText),
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    await Promise.all([
      first!.refresh(createDocumentTextSnapshot(createPieceTableSnapshot(firstText), firstText)),
      second!.refresh(createDocumentTextSnapshot(createPieceTableSnapshot(secondText), secondText)),
    ])
    first!.dispose()
    await workerOwner.awaitRuntimeSessionIdle('runtime-shiki-first')

    const nextText = 'const secondValue = 2;'
    const result = await second!.applyChange(
      createChange(nextText, { from: 6, to: 12, text: 'secondValue' }),
    )

    expect(result.tokens.toTokens().some((token) => token.end > secondText.length)).toBe(true)
    second!.dispose()
  })
})

function changeWithoutFullRead(
  snapshot: PieceTableSnapshot,
  edits: DocumentSessionChange['edits'],
): DocumentSessionChange {
  const textSnapshot = createDocumentTextSnapshot(snapshot)
  vi.spyOn(textSnapshot, 'materializeFullText').mockImplementation(() =>
    expect.unreachable('Unexpected full-document read'),
  )
  return { ...createChange(''), snapshot, textSnapshot, edits }
}

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
