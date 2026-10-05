import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { EditorSurfaceLayoutView } from '@/features/workbench/components/editor-surface-layout-view'
import { ChatModeSurfaceView } from '@/features/chat-mode/components/surface-view'
import { KeepAliveProvider } from '@/lib/keep-alive/providers/keep-alive-provider'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { EnvironmentTransportsProvider } from '@/providers/environment-transports-provider'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider'
import type { FilesystemPath } from '@/lib/documents/utils/types'

export function RetentionAcceptanceSurface({ rootPath }: { readonly rootPath: FilesystemPath }) {
  const application = useApplicationRuntime()
  const mode = useEditorWorkspaceState((state) => state.uiMode)
  return (
    <EnvironmentTransportsProvider connections={application.connections}>
      <ChatProviderSignInProvider>
        <KeepAliveProvider>
          {mode === 'chat' ? (
            <ChatModeSurfaceView rootPath={rootPath} />
          ) : (
            <EditorSurfaceLayoutView rootPath={rootPath} />
          )}
        </KeepAliveProvider>
      </ChatProviderSignInProvider>
    </EnvironmentTransportsProvider>
  )
}
