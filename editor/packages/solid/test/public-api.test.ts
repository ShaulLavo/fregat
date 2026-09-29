import { describe, expect, it } from 'vitest'
import { createEditor, type SolidEditorController } from '@singapore-editor/solid'

describe('public API facade', () => {
  it('exports the Solid editor primitive from the package root', () => {
    const controller = null as SolidEditorController | null

    expect(createEditor).toBeTypeOf('function')
    expect(controller).toBeNull()
  })
})
