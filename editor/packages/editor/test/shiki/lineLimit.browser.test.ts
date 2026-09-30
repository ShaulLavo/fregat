import { describe, expect, it, vi } from 'vitest'
import { createDocumentTextSnapshot, createPieceTableSnapshot } from '../../src'
import { createShikiWorkerOwner, type ShikiResolvedRegistrations } from '../../src/shiki'
import { generateFixture } from '../../../../examples/stress/src/fixtures.ts'

// The frozen calibration fixture: one 1,048,594-unit line that never finished tokenizing uncapped.
const longLineSha256 = '467fa816efc5aa5c082ed44ea4dc10bbbb41da16faf4d4822aa3d122edc628f7'

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function openSession(
  owner: ReturnType<typeof createShikiWorkerOwner>,
  text: string,
  registrations: Promise<ShikiResolvedRegistrations>,
) {
  const snapshot = createPieceTableSnapshot(text)
  const session = owner.createSession({
    documentId: 'line-limit.ts',
    languageId: 'typescript',
    lang: 'typescript',
    theme: 'github-dark',
    registrations,
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot, text),
  })!
  return { session, textSnapshot: createDocumentTextSnapshot(snapshot, text) }
}

describe.skipIf(typeof Worker === 'undefined')('Shiki line limit in the worker', () => {
  it('settles the original 1 MB line as one plain token and terminates the worker', async () => {
    const text = generateFixture('long-line')
    expect(await sha256(text)).toBe(longLineSha256)
    const workers: Worker[] = []
    const owner = createShikiWorkerOwner({
      workerFactory: () => {
        const worker = new Worker(new URL('../../src/shiki/shiki.worker.ts', import.meta.url), {
          type: 'module',
        })
        workers.push(worker)
        return worker
      },
    })
    const terminate = vi.fn()
    const { session, textSnapshot } = openSession(owner, text, resolveRegistrations())

    const startedAt = performance.now()
    const result = await session.refresh(textSnapshot)
    await owner.awaitIdleFence()
    console.info(`1 MB line settled in ${Math.round(performance.now() - startedAt)} ms`)

    const tokens = result.tokens.toTokens()
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ start: 0, end: text.length })
    expect(tokens[0]!.style.color?.toLowerCase()).toBe(result.theme?.foregroundColor?.toLowerCase())
    expect(owner.inspect()).toMatchObject({
      pendingRequests: 0,
      untokenizedLines: 1,
      maxTokenizationLineLength: 20_000,
      lastError: null,
    })

    for (const worker of workers) worker.terminate = terminate.mockImplementation(worker.terminate)
    session.dispose()
    await owner.dispose()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', untokenizedLines: 0 })
    expect(terminate).toHaveBeenCalledTimes(workers.length)
  }, 60_000)

  it('reopens a document under a changed limit on its next request', async () => {
    let limit = 10
    const owner = createShikiWorkerOwner({ maxTokenizationLineLength: () => limit })
    const text = 'const value = 1\nlet x'
    const { session, textSnapshot } = openSession(owner, text, resolveRegistrations())

    await session.refresh(textSnapshot)
    expect(owner.inspect().untokenizedLines).toBe(1)

    const requests = vi.spyOn(owner, 'request')
    limit = 100
    const reopened = await session.refresh(textSnapshot)
    expect(requests.mock.calls.map(([payload]) => payload.type)).toEqual(['open'])
    expect(requests.mock.calls[0]![0]).toMatchObject({ maxLineLength: 100 })
    expect(owner.inspect().untokenizedLines).toBe(0)
    expect(reopened.tokens.toTokens().length).toBeGreaterThan(2)

    requests.mockClear()
    await session.refresh(textSnapshot)
    expect(requests).not.toHaveBeenCalled()

    session.dispose()
    await owner.dispose()
  })
})

async function resolveRegistrations(): Promise<ShikiResolvedRegistrations> {
  const [language, theme] = await Promise.all([
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
  ])
  return {
    languageRegistrations: language.default,
    themeRegistration: { ...theme.default, name: theme.default.name ?? 'github-dark' },
    themeRegistrations: [],
  }
}
