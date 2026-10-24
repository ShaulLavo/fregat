import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { expect, test } from 'vitest'
import { createHighlightingService, type HighlightingThemeSource } from '../src/index'

test.each(['cap only', 'theme only', 'theme then cap', 'cap and theme'] as const)(
  '%s keeps an existing document highlighting',
  async (operation) => {
    let limit = 8
    let foreground = '#eeeeee'
    const listeners = new Set<() => void>()
    const source: HighlightingThemeSource = {
      current: () => ({ format: 'vscode', id: 'review' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const service = createHighlightingService({
      maxTokenizationLineLength: () => limit,
      resolveTheme: async () => ({
        name: 'review',
        type: 'dark',
        colors: { 'editor.foreground': foreground },
        tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: '#ff0000' } }],
      }),
    })
    const text = 'const longer = 1'
    const buffer = createEditorTextBuffer(text)
    const textSnapshot = buffer.getTextSnapshot()
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'review.ts' })
    const session = analysis.borrowHighlighter({
      provider: service.highlighterProvider(source),
      languageId: 'typescript',
    })!
    let unsubscribe: (() => void) | undefined
    try {
      const initial = await session.refresh(textSnapshot)
      expect(initial.tokens.toTokens()).toEqual([
        { start: 0, end: text.length, style: { color: '#EEEEEE' } },
      ])
      expect(service.inspect().shiki?.untokenizedLines).toBe(1)
      if (operation !== 'cap only') {
        const notification = new Promise<void>((resolve) => {
          unsubscribe = session.onDidChangeTheme?.(resolve) ?? undefined
        })
        foreground = '#dddddd'
        if (operation === 'cap and theme') limit = 100
        for (const listener of listeners) listener()
        await notification
        const themeResult = await session.refresh(textSnapshot)
        if (operation !== 'cap and theme')
          expect(themeResult.tokens.toTokens()[0]?.style.color).toBe('#DDDDDD')
      }
      if (operation !== 'theme only') limit = 100
      const result = await session.refresh(textSnapshot)
      const expectedCount = operation === 'theme only' ? 1 : 0
      expect(service.inspect().shiki?.untokenizedLines).toBe(expectedCount)
      if (operation !== 'theme only') expect(result.tokens.length).toBeGreaterThan(1)
    } finally {
      unsubscribe?.()
      session.dispose()
      analysis.dispose()
      await service.dispose()
    }
  },
)
