import { filesystemPath } from '@/lib/documents/utils/identity'
import type { ReactNode } from 'react'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { MessageFileCommit } from '@/features/git/components/message-file-commit'
import { StateContext } from '@/features/git/state/store'

export function GitStoreProvider({
  children,
  rootPath,
}: {
  readonly children: ReactNode
  readonly rootPath: string
}) {
  const runtime = useEditorRuntime()
  const store = runtime.gitStoreForRoot(filesystemPath(rootPath))
  return (
    <StateContext value={store}>
      <MessageFileCommit rootPath={rootPath} />
      {children}
    </StateContext>
  )
}
