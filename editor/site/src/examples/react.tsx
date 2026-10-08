import { EditorHost, useEditor } from '@singapore-editor/react'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const controller = useEditor({
    document: {
      documentId: 'example.ts',
      text: 'const value = 1\n',
      languageId: 'typescript',
    },
  })
  return (
    <EditorHost
      controller={controller}
      style={{ height: '32rem', display: 'flex', flexDirection: 'column' }}
    />
  )
}
