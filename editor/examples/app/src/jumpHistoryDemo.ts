import { Editor } from '@singapore-editor/core'
import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorFindPlugin } from '@singapore-editor/find'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'
import './jumpHistoryDemo.css'

const buffer = createEditorTextBuffer(
  Array.from({ length: 100 }, (_, index) => `Line ${index + 1}: a navigation destination`).join(
    '\n',
  ),
)
const description = document.createElement('p')
description.textContent =
  'Each view keeps its jump trail through edits. Find or go to a line, insert text above it, then go back. Alt+Left / Alt+Right; on Mac, Control+Minus / Control+Shift+Minus.'
document.body.append(description)

for (const name of ['First view', 'Second view']) {
  const session = createEditorBufferSession(buffer)
  const pane = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = name
  const toolbar = document.createElement('div')
  const host = document.createElement('div')
  host.className = 'jump-demo-editor'
  pane.append(heading, toolbar, host)
  document.body.append(pane)
  const editor = new Editor(host, { plugins: [createEditorFindPlugin()] })
  editor.attachSession(session)
  addAction(toolbar, 'Back', () => editor.jumpBack())
  addAction(toolbar, 'Forward', () => editor.jumpForward())
  addAction(toolbar, 'Find', () => editor.openFind())
  const line = document.createElement('input')
  line.type = 'number'
  line.min = '1'
  line.value = '50'
  line.setAttribute('aria-label', 'Line number')
  toolbar.append(line)
  addAction(toolbar, 'Go to line', () => {
    const row = Math.max(
      0,
      Math.min(session.getTextSnapshot().lineCount - 1, Number(line.value) - 1),
    )
    editor.jumpTo(session.getTextSnapshot().lineStart(row), undefined, 'go-to-line')
    editor.focus()
  })
  addAction(toolbar, 'Insert line at start', () =>
    editor.edit({ from: 0, to: 0, text: 'Inserted line\n' }),
  )
  window.addEventListener('pagehide', () => editor.dispose(), { once: true })
}

function addAction(parent: HTMLElement, label: string, run: () => unknown): void {
  const button = document.createElement('button')
  button.textContent = label
  button.addEventListener('click', run)
  parent.append(button)
}
