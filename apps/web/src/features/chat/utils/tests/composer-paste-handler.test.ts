import type { EditorPasteContext } from '@singapore-editor/core/extensions'
import { describe, vi } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'

import {
  createComposerPasteHandler,
  type ComposerPasteActions,
} from '@/features/chat/utils/composer-paste-handler'

describe('createComposerPasteHandler', () => {
  it('turns pasted files into attachments and inserts nothing', () => {
    const actions = pasteActions('')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })

    const result = createComposerPasteHandler(actions).handlePaste(context({ files: [file] }))

    expect(result).toEqual([''])
    expect(actions.attachFiles).toHaveBeenCalledWith([file])
  })

  it('turns a dropped workspace row into a mention', () => {
    const handler = createComposerPasteHandler(pasteActions('see'))

    const result = handler.handlePaste(
      context({
        source: 'drop',
        text: '/repo/src/app.ts',
        targets: [{ start: 3, end: 3, text: '' }],
      }),
    )

    expect(result).toEqual([' @src/app.ts '])
  })

  it('folds a large paste into a file unless the paste-as-text chord asked for it inline', () => {
    const large = 'x'.repeat(40_000)
    const folding = pasteActions('')
    expect(createComposerPasteHandler(folding).handlePaste(context({ text: large }))).toEqual([''])
    expect(folding.foldText).toHaveBeenCalledWith(large)

    const inline = { ...pasteActions(''), takeInlineRequest: () => true }
    expect(createComposerPasteHandler(inline).handlePaste(context({ text: large }))).toBeNull()
  })

  it('completes the blanks that let a pasted mention become a chip', () => {
    const handler = createComposerPasteHandler(pasteActions('readnow'))

    const result = handler.handlePaste(
      context({ text: '@src/app.ts', targets: [{ start: 4, end: 4, text: '' }] }),
    )

    expect(result).toEqual([' @src/app.ts '])
  })

  it('leaves plain text to the editor', () => {
    expect(createComposerPasteHandler(pasteActions('')).handlePaste(context({}))).toBeNull()
  })
})

function pasteActions(documentText: string) {
  return {
    attachFiles: vi.fn<ComposerPasteActions['attachFiles']>(),
    documentText: () => documentText,
    foldText: vi.fn<ComposerPasteActions['foldText']>(),
    rootPath: () => '/repo',
    takeInlineRequest: () => false,
  }
}

function context(overrides: Partial<EditorPasteContext>): EditorPasteContext {
  const text = overrides.text ?? 'plain'
  return {
    dataTransfer: {
      getData: (format: string) => (format === 'text/plain' ? text : ''),
      types: ['text/plain'],
    } as unknown as DataTransfer,
    files: [],
    internal: false,
    languageId: null,
    source: 'paste',
    targets: [{ end: 0, start: 0, text: '' }],
    text,
    types: ['text/plain'],
    ...overrides,
  }
}
