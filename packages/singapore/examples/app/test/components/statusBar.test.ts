import { describe, expect, it } from 'vitest'

import type { EditorState } from '@singapore-editor/core/editor'
import { createStatusBar } from '../../src/components/statusBar.ts'

describe('createStatusBar', () => {
  it('renders document state and clears when no document is open', () => {
    const statusBar = createStatusBar()

    statusBar.update('src/main.ts', editorState({ documentId: 'src/main.ts' }))
    expect(statusBar.element.querySelector('#status-file')?.textContent).toBe('src/main.ts')
    expect(statusBar.element.querySelector('#status-cursor')?.textContent).toBe('Ln 2, Col 4')
    expect(statusBar.element.querySelector('#status-length')?.textContent).toBe('12 chars')
    expect(statusBar.element.querySelector('#status-syntax')?.textContent).toBe('typescript ready')
    expect(statusBar.element.querySelector('#status-history')?.textContent).toBe('Undo / No redo')

    statusBar.update(undefined, editorState({ documentId: null }))
    expect(statusBar.element.querySelector('#status-file')?.textContent).toBe('No file')
    expect(statusBar.element.querySelector('#status-cursor')?.textContent).toBe('')
  })
})

function editorState(overrides: Partial<EditorState>): EditorState {
  return {
    documentId: 'doc',
    length: 12,
    cursor: { row: 1, column: 3 },
    languageId: 'typescript',
    syntaxStatus: 'ready',
    canUndo: true,
    canRedo: false,
    ...overrides,
  }
}
