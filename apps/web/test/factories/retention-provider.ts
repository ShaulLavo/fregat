import { createEmptySyntaxSession, type EditorSyntaxProvider } from '@singapore-editor/core/syntax'

export function retentionProvider(onDispose: () => void): EditorSyntaxProvider {
  return {
    createSession: () => {
      const session = createEmptySyntaxSession()
      return {
        ...session,
        dispose: () => {
          session.dispose()
          onDispose()
        },
      }
    },
  }
}
