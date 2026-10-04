import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentTextSnapshot } from '../../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createShikiWorkerOwner, type ShikiWorkerOwner } from '../../src/shiki/workerClient'

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

describe('real Shiki worker retention', () => {
  it('fences documents and keeps shared resources distinct through disposal and recreation', async () => {
    const owner = createShikiWorkerOwner()
    owners.add(owner)
    expect(await owner.inspectRetention()).toBeNull()
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

    const releaseRegistrations: ((value: typeof resolved) => void)[] = []
    const pendingRegistrations = new Promise<typeof resolved>((resolve) => {
      releaseRegistrations.push(resolve)
    })
    const pendingSnapshot = createPieceTableSnapshot(firstText)
    const pendingSession = owner.createSession({
      documentId: 'pending.ts',
      runtimeSessionId: 'retention-pending',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: pendingRegistrations,
      snapshot: pendingSnapshot,
    })!
    const pendingRefresh = pendingSession.refresh(createDocumentTextSnapshot(pendingSnapshot))
    pendingSession.dispose()
    const pendingFence = owner.inspectRetention()
    for (const release of releaseRegistrations) release(resolved)
    expect((await pendingRefresh).tokens.length).toBe(0)
    expect((await pendingFence)?.documents).toEqual(surviving?.documents)

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
})
