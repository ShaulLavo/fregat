import { Editor } from '@singapore-editor/core/editor'
import { waitFor } from '@testing-library/react'

import { createChatInputUltrathinkPlugin } from '@/features/chat/utils/composer-plugins'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { expect, test } from '../../../../../test/fixtures'

test('the word becomes one rainbow span and the prompt text is unchanged', async () => {
  stubEditorViewport({ height: 120, width: 400 })
  const { editor, host } = mountEditor()
  try {
    const disposable = editor.addPlugin(createChatInputUltrathinkPlugin())
    editor.setText('Please ultrathink about ultrathinking.')

    await waitFor(() =>
      expect(
        Array.from(host.querySelectorAll('.rainbow-text'), (span) => span.textContent),
      ).toEqual(['ultrathink']),
    )
    expect(editor.materializeFullText()).toBe('Please ultrathink about ultrathinking.')
    disposable.dispose()
  } finally {
    editor.dispose()
    host.remove()
  }
})

test('a model without the word reverts painted text to plain', async () => {
  stubEditorViewport({ height: 120, width: 400 })
  const { editor, host } = mountEditor()
  try {
    const disposable = editor.addPlugin(createChatInputUltrathinkPlugin())
    editor.setText('ultrathink it')
    await waitFor(() => expect(host.querySelector('.rainbow-text')).not.toBeNull())

    disposable.dispose()
    expect(host.querySelector('.rainbow-text')).toBeNull()
    expect(editor.materializeFullText()).toBe('ultrathink it')
  } finally {
    editor.dispose()
    host.remove()
  }
})

function mountEditor() {
  const host = document.createElement('div')
  host.style.width = '400px'
  host.style.height = '120px'
  document.body.append(host)
  const editor = new Editor(host, {
    scrollMode: 'virtualized',
    scrollPastEnd: false,
    wordWrap: true,
    wordWrapBreak: 'word',
  })
  return { editor, host }
}
