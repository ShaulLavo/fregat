import { describe, expect, it } from 'vitest'
import {
  EditorHost,
  useEditor,
  useEditorSelector,
  type ReactEditorController,
} from '@singapore-editor/react'

describe('public API facade', () => {
  it('exports the React editor adapter from the package root', () => {
    const controller = null as ReactEditorController | null

    expect(EditorHost).toBeTypeOf('function')
    expect(useEditor).toBeTypeOf('function')
    expect(useEditorSelector).toBeTypeOf('function')
    expect(controller).toBeNull()
  })
})
