import { vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import type { EditorHighlighterProvider } from '@singapore-editor/core'
import {
  createEmptySyntaxSession,
  EditorTokenStore,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
} from '@singapore-editor/core/syntax'
import * as v from 'valibot'
import { descriptorFor, DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { expect, test } from '../../../../../test/fixtures'
import { memoryLocalStorage } from '../../../../../test/factories/local-storage'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { inactiveAnalysisEntryLimitFromSettings } from '../../utils/inactive-analysis-budget'
import { reconcileInactiveAnalysis } from '../inactive-analysis-policy'

const structural: EditorSyntaxProvider = { createSession: createEmptySyntaxSession }
const highlighter: EditorHighlighterProvider = {
  createSession: () => ({
    refresh: async () => ({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 1, style: { color: 'red' } }]),
    }),
    applyChange: async () => ({ tokens: EditorTokenStore.empty() }),
    dispose: () => undefined,
  }),
}

test('the machine setting accepts every nonnegative safe integer and reads confirmed values', () => {
  const descriptor = descriptorFor('editor.inactiveAnalysisEntryLimit')
  expect(descriptor.scope).toBe('machine')
  expect(descriptor.default).toBe(2)
  for (const value of [0, 2, 10_001, Number.MAX_SAFE_INTEGER]) {
    expect(v.safeParse(descriptor.schema, value).success).toBe(true)
  }
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    expect(v.safeParse(descriptor.schema, value).success).toBe(false)
  }
  vi.stubGlobal('localStorage', memoryLocalStorage())
  try {
    expect(inactiveAnalysisEntryLimitFromSettings()).toBe(2)
    writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'editor.inactiveAnalysisEntryLimit': 0 })
    expect(inactiveAnalysisEntryLimitFromSettings()).toBe(0)
    writeBootMirror({
      ...DEFAULT_SETTING_VALUES,
      'editor.inactiveAnalysisEntryLimit': Number.MAX_SAFE_INTEGER,
    })
    expect(inactiveAnalysisEntryLimitFromSettings()).toBe(Number.MAX_SAFE_INTEGER)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('one global limit covers two environments and repeated visits of the same actual handle', ({
  onTestFinished,
}) => {
  const left = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('left'),
    documentId: 'environment-left/document',
  })
  const right = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('right'),
    documentId: 'environment-right/document',
  })
  onTestFinished(() => {
    left.dispose()
    right.dispose()
  })
  const leases = [
    left.borrowStructural({ provider: structural, languageId: 'typescript' }),
    left.borrowHighlighter({ provider: highlighter, languageId: 'typescript' }),
    right.borrowStructural({ provider: structural, languageId: 'typescript' }),
    right.borrowHighlighter({ provider: highlighter, languageId: 'typescript' }),
  ]
  for (const lease of leases) {
    expect(lease).not.toBeNull()
    lease?.dispose()
  }
  expect(left.inspectRetention().entries).toHaveLength(2)
  expect(right.inspectRetention().entries).toHaveLength(2)
  expect(
    left.inspectRetention().entries.length + right.inspectRetention().entries.length,
  ).toBeGreaterThan(2)
  const result = reconcileInactiveAnalysis({
    enumerate: () => [left, right, left],
    classify: () => 'warm',
    limit: 2,
  })
  expect(result.before).toEqual({
    analysisCount: 2,
    entryCount: 4,
    inactiveEntryCount: 4,
    protectedEntryCount: 0,
  })
  expect(result.after.inactiveEntryCount).toBe(2)
  expect(result.reclaimed.flatMap((receipt) => receipt.runtimeSessionIds)).toHaveLength(2)
})

test('one surviving view and a preparation pin protect entries until their actual release', ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('shared'),
    documentId: 'shared',
  })
  onTestFinished(() => analysis.dispose())
  const request = { provider: structural, languageId: 'typescript' }
  const first = analysis.borrowStructural(request)!
  const second = analysis.borrowStructural(request)!
  const preparation = analysis.borrowHighlighter({
    provider: highlighter,
    languageId: 'typescript',
  })!
  expect(first.runtimeSessionId).toBe(second.runtimeSessionId)
  const reconcile = () =>
    reconcileInactiveAnalysis({ enumerate: () => [analysis], classify: () => 'warm', limit: 0 })
  first.dispose()
  expect(reconcile().after).toMatchObject({ inactiveEntryCount: 0, protectedEntryCount: 2 })
  second.dispose()
  expect(reconcile().after).toMatchObject({ inactiveEntryCount: 0, protectedEntryCount: 1 })
  expect(analysis.inspectRetention().entries[0]?.runtimeSessionId).toBe(
    preparation.runtimeSessionId,
  )
  preparation.dispose()
  expect(reconcile().after.entryCount).toBe(0)
})

test('pending and failed configurations in both families count toward the same limit', async ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('pending and failed'),
    documentId: 'states',
  })
  const pending = Promise.withResolvers<EditorSyntaxResult>()
  const pendingHighlight = Promise.withResolvers<{ tokens: EditorTokenStore }>()
  const pendingStructural: EditorSyntaxProvider = {
    createSession: () => ({ ...createEmptySyntaxSession(), refresh: () => pending.promise }),
  }
  const failedStructural: EditorSyntaxProvider = {
    createSession: () => ({
      ...createEmptySyntaxSession(),
      refresh: async () => {
        throw 'fixture structural failure'
      },
    }),
  }
  const pendingHighlighter: EditorHighlighterProvider = {
    createSession: () => ({
      refresh: () => pendingHighlight.promise,
      applyChange: () => pendingHighlight.promise,
      dispose: () => undefined,
    }),
  }
  const failedHighlighter: EditorHighlighterProvider = {
    createSession: () => ({
      refresh: async () => {
        throw 'fixture highlighter failure'
      },
      applyChange: async () => {
        throw 'fixture highlighter failure'
      },
      dispose: () => undefined,
    }),
  }
  onTestFinished(() => {
    analysis.dispose()
    pending.resolve(createEmptySyntaxSession().getResult())
    pendingHighlight.resolve({ tokens: EditorTokenStore.empty() })
  })
  const leases = [
    analysis.borrowStructural({
      provider: pendingStructural,
      languageId: 'typescript',
      configurationTag: ['one'],
    })!,
    analysis.borrowStructural({
      provider: failedStructural,
      languageId: 'typescript',
      configurationTag: ['two'],
    })!,
    analysis.borrowHighlighter({
      provider: pendingHighlighter,
      languageId: 'typescript',
      configurationTag: ['one'],
    })!,
    analysis.borrowHighlighter({
      provider: failedHighlighter,
      languageId: 'typescript',
      configurationTag: ['two'],
    })!,
  ]
  await expect(leases[1]!.refresh(analysis.buffer.getTextSnapshot())).rejects.toBe(
    'fixture structural failure',
  )
  await expect(leases[3]!.refresh(analysis.buffer.getTextSnapshot())).rejects.toBe(
    'fixture highlighter failure',
  )
  for (const lease of leases) lease.dispose()
  expect(analysis.inspectRetention().entries.map((entry) => [entry.family, entry.status])).toEqual([
    ['structural', 'pending'],
    ['structural', 'failed'],
    ['highlighter', 'pending'],
    ['highlighter', 'failed'],
  ])
  const result = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: 1,
  })
  expect(result.before.inactiveEntryCount).toBe(4)
  expect(result.after.inactiveEntryCount).toBe(1)
})

test('MAX_SAFE_INTEGER preserves all optional configurations and zero reclaims them', ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('versions'),
    documentId: 'versions',
  })
  onTestFinished(() => analysis.dispose())
  for (const version of ['a', 'b', 'c']) {
    analysis
      .borrowStructural({
        provider: structural,
        languageId: 'typescript',
        configurationTag: [version],
      })!
      .dispose()
  }
  const unlimited = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: Number.MAX_SAFE_INTEGER,
  })
  expect(unlimited.after.inactiveEntryCount).toBe(3)
  expect(unlimited.reclaimed).toHaveLength(0)
  const zero = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: 0,
  })
  expect(zero.after.entryCount).toBe(0)
  expect(zero.reclaimed).toHaveLength(3)
})

test('owner-classified obsolete and abandoned entries precede older warm entries', ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('priority'),
    documentId: 'priority',
  })
  onTestFinished(() => analysis.dispose())
  const warm = analysis.borrowStructural({
    provider: structural,
    languageId: 'typescript',
    configurationTag: ['warm'],
  })!
  const obsolete = analysis.borrowStructural({
    provider: structural,
    languageId: 'typescript',
    configurationTag: ['obsolete'],
  })!
  const abandoned = analysis.borrowHighlighter({ provider: highlighter, languageId: 'typescript' })!
  const clock = vi.spyOn(Date, 'now')
  try {
    clock.mockReturnValue(100)
    warm.dispose()
    clock.mockReturnValue(200)
    obsolete.dispose()
    clock.mockReturnValue(300)
    abandoned.dispose()
  } finally {
    clock.mockRestore()
  }
  const result = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: (_, entry) => {
      if (entry.runtimeSessionId === obsolete.runtimeSessionId) return 'obsolete'
      if (entry.runtimeSessionId === abandoned.runtimeSessionId) return 'abandoned'
      return 'warm'
    },
    limit: 1,
  })
  expect(result.reclaimed).toMatchObject([
    { reason: 'inactive-budget', runtimeSessionIds: [obsolete.runtimeSessionId] },
    { reason: 'speculative-abandoned', runtimeSessionIds: [abandoned.runtimeSessionId] },
  ])
  expect(analysis.inspectRetention().entries[0]?.runtimeSessionId).toBe(warm.runtimeSessionId)
})

test('LRU uses actual release time and breaks ties by current owner enumeration', ({
  onTestFinished,
}) => {
  const first = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('first'),
    documentId: 'first',
  })
  const second = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('second'),
    documentId: 'second',
  })
  onTestFinished(() => {
    first.dispose()
    second.dispose()
  })
  const early = first.borrowStructural({ provider: structural, languageId: 'typescript' })!
  const tied = second.borrowStructural({ provider: structural, languageId: 'typescript' })!
  const recent = first.borrowHighlighter({ provider: highlighter, languageId: 'typescript' })!
  const clock = vi.spyOn(Date, 'now')
  try {
    clock.mockReturnValue(100)
    early.dispose()
    tied.dispose()
    clock.mockReturnValue(200)
    recent.dispose()
  } finally {
    clock.mockRestore()
  }
  const result = reconcileInactiveAnalysis({
    enumerate: () => [second, first, second],
    classify: () => 'warm',
    limit: 1,
  })
  expect(result.reclaimed.flatMap((receipt) => receipt.runtimeSessionIds)).toEqual([
    tied.runtimeSessionId,
    early.runtimeSessionId,
  ])
  expect(first.inspectRetention().entries[0]?.runtimeSessionId).toBe(recent.runtimeSessionId)
})

test('default two keeps both actual prior resources warm on A to B to A', async ({
  onTestFinished,
}) => {
  const bufferA = createEditorTextBuffer('alpha')
  const bufferB = createEditorTextBuffer('bravo')
  const a = createEditorDocumentAnalysis({ buffer: bufferA, documentId: 'A' })
  const b = createEditorDocumentAnalysis({ buffer: bufferB, documentId: 'B' })
  onTestFinished(() => {
    a.dispose()
    b.dispose()
  })
  const syntaxRequest = { provider: structural, languageId: 'typescript' }
  const highlightRequest = { provider: highlighter, languageId: 'typescript' }
  const firstSyntax = a.borrowStructural(syntaxRequest)!
  const firstHighlight = a.borrowHighlighter(highlightRequest)!
  const syntaxResult = await firstSyntax.refresh(bufferA.getTextSnapshot())
  const highlightResult = await firstHighlight.refresh(bufferA.getTextSnapshot())
  expect(highlightResult.tokens.length).toBe(1)
  const bSyntax = b.borrowStructural(syntaxRequest)!
  const bHighlight = b.borrowHighlighter(highlightRequest)!
  await bSyntax.refresh(bufferB.getTextSnapshot())
  await bHighlight.refresh(bufferB.getTextSnapshot())
  firstSyntax.dispose()
  firstHighlight.dispose()
  const result = reconcileInactiveAnalysis({
    enumerate: () => [a, b],
    classify: () => 'warm',
    limit: descriptorFor('editor.inactiveAnalysisEntryLimit').default,
  })
  expect(result.after).toMatchObject({ inactiveEntryCount: 2, protectedEntryCount: 2 })
  expect(result.reclaimed).toHaveLength(0)
  const createSyntax = vi.spyOn(structural, 'createSession')
  const createHighlight = vi.spyOn(highlighter, 'createSession')
  const fullTextRead = vi.spyOn(bufferA.getTextSnapshot(), 'materializeFullText')
  try {
    const revisitSyntax = a.borrowStructural(syntaxRequest)!
    const revisitHighlight = a.borrowHighlighter(highlightRequest)!
    expect(revisitSyntax.runtimeSessionId).toBe(firstSyntax.runtimeSessionId)
    expect(revisitHighlight.runtimeSessionId).toBe(firstHighlight.runtimeSessionId)
    const syntaxRead = revisitSyntax.read()
    const highlightRead = revisitHighlight.read()
    if (syntaxRead.kind !== 'ready' || highlightRead.kind !== 'ready')
      return expect.fail('A must synchronously reuse its retained ready resources')
    expect(syntaxRead.result).toBe(syntaxResult)
    expect(highlightRead.result).toBe(highlightResult)
    expect(createSyntax).not.toHaveBeenCalled()
    expect(createHighlight).not.toHaveBeenCalled()
    expect(fullTextRead).not.toHaveBeenCalled()
    revisitSyntax.dispose()
    revisitHighlight.dispose()
  } finally {
    createSyntax.mockRestore()
    createHighlight.mockRestore()
    fullTextRead.mockRestore()
  }
  bSyntax.dispose()
  bHighlight.dispose()
})

test('nonterminal reclamation preserves the authoritative buffer and Undo with a cold reborrow', async ({
  onTestFinished,
}) => {
  const buffer = createEditorTextBuffer('alpha')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'dirty' })
  onTestFinished(() => analysis.dispose())
  view.setSelection(5)
  view.applyText('!')
  const request = { provider: highlighter, languageId: 'typescript' }
  const original = analysis.borrowHighlighter(request)!
  await original.refresh(buffer.getTextSnapshot())
  original.dispose()
  const snapshot = buffer.getTextSnapshot()
  const history = buffer.serializeHistory()
  const result = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: 0,
  })
  expect(result.after.entryCount).toBe(0)
  expect(analysis.buffer).toBe(buffer)
  expect(buffer.getTextSnapshot()).toBe(snapshot)
  expect(buffer.serializeHistory()).toEqual(history)
  expect(buffer.isDirty()).toBe(true)
  expect(buffer.materializeFullText()).toBe('alpha!')
  view.undo()
  expect(buffer.materializeFullText()).toBe('alpha')
  view.redo()
  expect(buffer.materializeFullText()).toBe('alpha!')
  const reborrow = analysis.borrowHighlighter(request)!
  expect(reborrow.runtimeSessionId).not.toBe(original.runtimeSessionId)
  await reborrow.refresh(buffer.getTextSnapshot())
  expect(reborrow.read()).toMatchObject({ kind: 'ready', revision: buffer.getRevision() })
  reborrow.dispose()
})

test('a reentrant disposer can borrow a later candidate and the refreshed census protects it', ({
  onTestFinished,
}) => {
  const first = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('first'),
    documentId: 'first',
  })
  const second = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('second'),
    documentId: 'second',
  })
  onTestFinished(() => {
    first.dispose()
    second.dispose()
  })
  const request = { provider: structural, languageId: 'typescript' }
  const survivor: { lease: ReturnType<typeof second.borrowStructural> } = { lease: null }
  const disposer: EditorSyntaxProvider = {
    createSession: () => ({
      ...createEmptySyntaxSession(),
      dispose: () => {
        survivor.lease = second.borrowStructural(request)
      },
    }),
  }
  first.borrowStructural({ provider: disposer, languageId: 'typescript' })!.dispose()
  const later = second.borrowStructural(request)!
  later.dispose()
  const result = reconcileInactiveAnalysis({
    enumerate: () => [first, second],
    classify: () => 'warm',
    limit: 0,
  })
  expect(result.reclaimed.flatMap((receipt) => receipt.runtimeSessionIds)).toHaveLength(1)
  expect(result.after).toMatchObject({ inactiveEntryCount: 0, protectedEntryCount: 1 })
  expect(second.inspectRetention().entries[0]?.runtimeSessionId).toBe(later.runtimeSessionId)
  survivor.lease?.dispose()
})

test('reentrant owner disposal changes membership before the next count is reported', ({
  onTestFinished,
}) => {
  const first = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('first'),
    documentId: 'first',
  })
  const second = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('second'),
    documentId: 'second',
  })
  const owners = new Set([first, second])
  onTestFinished(() => {
    first.dispose()
    second.dispose()
  })
  const disposer: EditorSyntaxProvider = {
    createSession: () => ({
      ...createEmptySyntaxSession(),
      dispose: () => {
        owners.delete(second)
        second.dispose()
      },
    }),
  }
  first.borrowStructural({ provider: disposer, languageId: 'typescript' })!.dispose()
  second.borrowHighlighter({ provider: highlighter, languageId: 'typescript' })!.dispose()
  const result = reconcileInactiveAnalysis({
    enumerate: () => owners,
    classify: () => 'warm',
    limit: 0,
  })
  expect(result.after).toEqual({
    analysisCount: 1,
    entryCount: 0,
    inactiveEntryCount: 0,
    protectedEntryCount: 0,
  })
})

test('a borrow during owner classification is protected by the core lease check', ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('borrow'),
    documentId: 'borrow',
  })
  onTestFinished(() => analysis.dispose())
  const request = { provider: structural, languageId: 'typescript' }
  const original = analysis.borrowStructural(request)!
  original.dispose()
  const survivor: { lease: ReturnType<typeof analysis.borrowStructural> } = { lease: null }
  const result = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => {
      survivor.lease = analysis.borrowStructural(request)
      return 'obsolete'
    },
    limit: 0,
  })
  expect(result.reclaimed).toHaveLength(0)
  expect(result.after).toMatchObject({ inactiveEntryCount: 0, protectedEntryCount: 1 })
  expect(analysis.inspectRetention().entries[0]?.runtimeSessionId).toBe(original.runtimeSessionId)
  survivor.lease?.dispose()
})

test('entries created by disposal appear in truthful final counts and keep the pass finite', ({
  onTestFinished,
}) => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('replacement'),
    documentId: 'replacement',
  })
  onTestFinished(() => analysis.dispose())
  let disposed = 0
  const provider: EditorSyntaxProvider = {
    createSession: () => ({
      ...createEmptySyntaxSession(),
      dispose: () => {
        disposed++
        if (disposed > 1) return
        analysis.borrowHighlighter({ provider: highlighter, languageId: 'typescript' })!.dispose()
      },
    }),
  }
  analysis.borrowStructural({ provider, languageId: 'typescript' })!.dispose()
  const result = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: 0,
  })
  expect(disposed).toBe(1)
  expect(result.before.inactiveEntryCount).toBe(1)
  expect(result.after.inactiveEntryCount).toBe(1)
  expect(analysis.inspectRetention().entries[0]?.family).toBe('highlighter')
  const scheduled = reconcileInactiveAnalysis({
    enumerate: () => [analysis],
    classify: () => 'warm',
    limit: 0,
  })
  expect(scheduled.after.inactiveEntryCount).toBe(0)
})
