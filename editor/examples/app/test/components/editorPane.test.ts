import { describe, expect, it } from 'vitest'

import { createEditorPane } from '../../src/components/editorPane.ts'

describe('createEditorPane', () => {
  it('creates the editor host', () => {
    const pane = createEditorPane()

    expect(pane.element).toBeInstanceOf(HTMLDivElement)
    expect(pane.element.id).toBe('editor-container')
    expect(pane.editorHost.id).toBe('editor-host')
    // The diff host was a permanently hidden div left over from the DiffView era; a diff is a real
    // editor now and mounts into the editor host. Asserted absent so it cannot quietly return.
    expect(pane.element.querySelector('#diff-host')).toBeNull()
  })
})
