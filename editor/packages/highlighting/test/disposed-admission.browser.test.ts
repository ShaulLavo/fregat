import { createTextDiff, type PreparedDiffSyntaxInput } from '@singapore-editor/diff'
import { expect, test } from 'vitest'

import { createHighlightingService, type HighlightingThemeSource } from '../src/index'

const file = () =>
  createTextDiff({
    oldFile: { path: 'd.ts', languageId: 'typescript', text: 'const d = 1\n' },
    newFile: { path: 'd.ts', languageId: 'typescript', text: 'const d = 2\n' },
  })

function recordingView() {
  const shown: PreparedDiffSyntaxInput[] = []
  return {
    shown,
    view: {
      setFile: (_file: unknown, prepared: PreparedDiffSyntaxInput = []) =>
        void shown.push(prepared),
      releasePreparedSyntax: () => [],
    },
  }
}

for (const cached of [true, false]) {
  test(`a disposed service admits no diff or backend for a ${cached ? 'cached' : 'new'} theme source`, async () => {
    const service = createHighlightingService()
    const palette: HighlightingThemeSource = { current: () => ({ format: 'editor' }) }
    if (cached) expect(service.canPrepareDiff(file(), palette)).toBe(true)
    await service.dispose()

    const { shown, view } = recordingView()
    for (const admit of [
      () => service.canPrepareDiff(file(), palette),
      () => service.documentBackend(palette),
      () => service.syntaxProvider(),
      () => service.showDiff(view, file(), 'stacked', palette),
    ]) {
      expect(admit).toThrow(expect.objectContaining({ code: 'disposed' }))
    }
    await expect(service.prepareDiff(file(), palette)).rejects.toMatchObject({ code: 'disposed' })
    expect(shown).toEqual([])
    expect(service.inspect()).toMatchObject({
      disposed: true,
      pendingHighlights: 0,
      snippetSessions: 0,
      diffs: { prepared: 0, running: 0, viewed: 0 },
    })
    // Pure language mapping needs no workers and stays answerable.
    expect(service.grammarFor('ts')).toBe('typescript')
  })
}
