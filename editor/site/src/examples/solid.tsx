import { createSignal } from 'solid-js'
import { createEditor } from '@singapore-editor/solid'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const [wordWrap, setWordWrap] = createSignal(false)
  const controller = createEditor({
    document: { documentId: 'example.ts', text: 'const value = 1\n', languageId: 'typescript' },
    wordWrap,
  })
  return (
    <>
      <button onClick={() => setWordWrap(!wordWrap())}>Toggle wrapping</button>
      <div
        ref={controller.element}
        style={{ height: '32rem', display: 'flex', 'flex-direction': 'column' }}
      />
    </>
  )
}
