import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
} from '@singapore-editor/core/document'
import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import { createTextDiff, type PreparedDiffSyntaxSource } from '@singapore-editor/diff'
import { expect, test, vi } from 'vitest'
import { createHighlightingService, type HighlightingThemeSource } from '../src/index'

function theme(color: string): VscodeThemeRegistration {
  return {
    name: 'mine',
    type: 'dark',
    tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: color } }],
  }
}

async function fixture() {
  let current = theme('#ff0000')
  let holdBlue = false
  const blue = Promise.withResolvers<VscodeThemeRegistration>()
  const held = Promise.withResolvers<void>()
  const reads: string[] = []
  const listeners = new Set<() => void>()
  const source: HighlightingThemeSource = {
    current: () => ({ format: 'vscode', id: 'mine' }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const highlighting = createHighlightingService({
    resolveTheme: async () => {
      const captured = current
      const color = captured.tokenColors![0]!.settings!.foreground!
      reads.push(color)
      if (holdBlue && color === '#0000ff') {
        held.resolve()
        return blue.promise
      }
      return captured
    },
  })
  const text = 'const a = 1'
  const snapshot = createPieceTableSnapshot(text)
  const textSnapshot = createDocumentTextSnapshot(snapshot, text)
  const session = highlighting
    .highlighterProvider(source)
    .createSession({ documentId: 'doc.ts', languageId: 'typescript', snapshot, textSnapshot })!
  let events = 0
  const unsubscribe = session.onDidChangeTheme?.(() => events++)
  const documentColor = async () =>
    (await session.refresh(textSnapshot)).tokens
      .toTokens()
      .find((token) => token.start === 0)
      ?.style.color?.toLowerCase()
  expect(await documentColor()).toBe('#ff0000')
  const file = createTextDiff({
    oldFile: { path: 'p.ts', languageId: 'typescript', text: 'const p = 1\n' },
    newFile: { path: 'p.ts', languageId: 'typescript', text: 'const p = 2\n' },
  })
  expect(await highlighting.prepareDiff(file, source)).toBe(true)
  let sources: readonly PreparedDiffSyntaxSource[] = []
  const shown = highlighting.showDiff(
    {
      setFile: (_file, prepared = []) => {
        void Promise.resolve(prepared).then((s) => (sources = s))
      },
      releasePreparedSyntax: () => sources,
    },
    file,
    'new',
    source,
  )
  await Promise.resolve()
  const diffColor = () =>
    sources[0]?.tokens
      .toTokens()
      .find((token) => token.start === 0)
      ?.style.color?.toLowerCase()
  expect(diffColor()).toBe('#ff0000')
  const notify = (color: string) => {
    current = theme(color)
    for (const listener of listeners) listener()
  }
  return {
    highlighting,
    reads,
    notify,
    documentColor,
    diffColor,
    events: () => events,
    holdBlue: () => (holdBlue = true),
    held: held.promise,
    releaseBlue: () => {
      holdBlue = false
      blue.resolve(theme('#0000ff'))
    },
    close: async () => {
      holdBlue = false
      blue.resolve(theme('#0000ff'))
      shown.dispose()
      unsubscribe?.()
      session.dispose()
      await highlighting.dispose()
    },
  }
}

for (const target of ['document', 'diff'] as const) {
  test(`synchronous blue then green and later blue preserves ${target} colors`, async () => {
    const f = await fixture()
    try {
      f.notify('#0000ff')
      f.notify('#00ff00')
      await vi.waitFor(() => expect(f.events()).toBe(2))
      expect(await f.documentColor()).toBe('#00ff00')
      await f.highlighting.awaitIdle()
      await vi.waitFor(() => expect(f.diffColor()).toBe('#00ff00'))
      f.notify('#0000ff')
      await vi.waitFor(() => expect(f.events()).toBe(3))
      const document = await f.documentColor()
      await f.highlighting.awaitIdle()
      await vi.waitFor(() => expect(f.diffColor()).toBe('#0000ff'))
      console.info('SYNCHRONOUS_REVISION_PROOF', {
        target,
        document,
        diff: f.diffColor(),
        reads: f.reads,
      })
      expect(target === 'document' ? document : f.diffColor()).toBe('#0000ff')
    } finally {
      await f.close()
    }
  })
  test(`late blue acquisition cannot poison the later blue ${target} registration`, async () => {
    const f = await fixture()
    try {
      f.holdBlue()
      f.notify('#0000ff')
      await f.held
      f.notify('#00ff00')
      await vi.waitFor(() => expect(f.events()).toBe(1))
      expect(await f.documentColor()).toBe('#00ff00')
      await f.highlighting.awaitIdle()
      await vi.waitFor(() => expect(f.diffColor()).toBe('#00ff00'))
      f.releaseBlue()
      await vi.waitFor(() => expect(f.events()).toBe(2))
      const poisonedDocument = await f.documentColor()
      await f.highlighting.awaitIdle()
      console.info('LATE_ACQUISITION_WHILE_GREEN', {
        target,
        document: poisonedDocument,
        diff: f.diffColor(),
        reads: f.reads.slice(),
      })
      f.notify('#0000ff')
      await vi.waitFor(() => expect(f.events()).toBe(3))
      const document = await f.documentColor()
      await f.highlighting.awaitIdle()
      console.info('OUT_OF_ORDER_REVISION_PROOF', {
        target,
        expected: '#0000ff',
        document,
        diff: f.diffColor(),
        reads: f.reads,
      })
      expect(target === 'document' ? document : f.diffColor()).toBe('#0000ff')
    } finally {
      await f.close()
    }
  })
}
